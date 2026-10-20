import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { GAME } from './config';
import { getPool, withTx } from './db';
import { availableByTier, effectiveWeights, loadOdds, rollTier } from './odds';
import { enqueuePrizeSend } from './prizeQueue';
import { secureRng, type Rng } from './rng';
import { OpenCrateInputSchema, type OpenCrateInput } from './schemas';
import { applyShards } from './shards';
import type { CardTier, CrateKind, OpenCrateResult, OpenRejectCode, PrizeItemView, ValidateOpen } from './types';

export interface OpenCrateDeps {
  validateOpen: ValidateOpen;
  db?: Pool;
  /** Tests only. */
  rng?: Rng;
}

interface CrateRow {
  id: string;
  spawned_for_player_id: string;
  kind: CrateKind;
  status: 'active' | 'opened' | 'expired';
  spawned_at: Date;
  expires_at: Date;
  lat: number;
  lng: number;
  distance_m: number;
  expired: boolean;
}

const reject = (code: OpenRejectCode, message: string): OpenCrateResult => ({ ok: false, code, message });

const CRATE_SQL = `SELECT id, spawned_for_player_id, kind, status, spawned_at, expires_at,
       ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng,
       ST_Distance(location, ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography) AS distance_m,
       expires_at <= now() AS expired
  FROM crates WHERE id = $1`;

function toItem(r: any): PrizeItemView {
  return {
    id: r.item_id,
    nftMint: r.nft_mint,
    cardName: r.card_name,
    grade: r.grade,
    valueUsd: Number(r.value_usd),
    tier: r.tier as CardTier,
    imageUrl: r.image_url,
  };
}

/** Rebuilds the result of an opening that already happened (idempotent retries). */
async function replay(db: Pool | PoolClient, crateId: string, playerId: string): Promise<OpenCrateResult | null> {
  const r = await db.query(
    `SELECT o.id, o.player_id, o.result, o.downgraded, o.shards_awarded, o.tickets_awarded, o.status,
            p.shards, p.tickets,
            i.id AS item_id, i.nft_mint, i.card_name, i.grade, i.value_usd, i.tier, i.image_url
       FROM crate_openings o JOIN players p ON p.id = o.player_id
       LEFT JOIN inventory_items i ON i.id = o.inventory_item_id
      WHERE o.crate_id = $1`,
    [crateId],
  );
  const o = r.rows[0];
  if (!o || o.player_id !== playerId) return null;
  if (o.result === 'card') {
    return { ok: true, openingId: o.id, replayed: true, outcome: 'card', item: toItem(o), prizeStatus: o.status };
  }
  return {
    ok: true,
    openingId: o.id,
    replayed: true,
    outcome: 'shards',
    shardsAwarded: o.shards_awarded,
    ticketsAwarded: o.tickets_awarded,
    shards: o.shards,
    tickets: o.tickets,
    downgraded: o.downgraded,
  };
}

/**
 * Validates and opens a crate (handoff doc §7). playerId and walletAddress must come from the
 * authenticated session. Never awards a card the vault doesn't hold: the card is reserved with
 * FOR UPDATE SKIP LOCKED in the same transaction as the opening, else the result downgrades to shards.
 */
export async function openCrate(input: OpenCrateInput, deps: OpenCrateDeps): Promise<OpenCrateResult> {
  const parsed = OpenCrateInputSchema.safeParse(input);
  if (!parsed.success) return reject('invalid_input', parsed.error.issues.map((i) => i.message).join('; '));
  const inp = parsed.data;
  const db = deps.db ?? getPool();
  const rng = deps.rng ?? secureRng;
  const ip = inp.ip ?? null;

  // 1. Cheap checks without locks.
  const pre = await db.query<CrateRow>(CRATE_SQL, [inp.crateId, inp.lat, inp.lng]);
  const crate = pre.rows[0];
  if (!crate) return reject('not_found', 'Crate not found');
  if (crate.spawned_for_player_id !== inp.playerId) return reject('not_yours', 'This crate belongs to another player');
  if (crate.status === 'opened') {
    return (await replay(db, crate.id, inp.playerId)) ?? reject('already_opened', 'Crate already opened');
  }
  if (crate.status === 'expired' || crate.expired) return reject('expired', 'Crate expired');

  const owner = await db.query<{ status: string }>(
    `SELECT p.status FROM players p JOIN wallets w ON w.player_id = p.id WHERE p.id = $1 AND w.address = $2`,
    [inp.playerId, inp.walletAddress],
  );
  if (!owner.rows[0]) return reject('invalid_input', 'Wallet does not belong to player');
  if (owner.rows[0].status !== 'active') return reject('frozen', 'Account is under review');

  // 2. Distance (core-owned).
  if (crate.distance_m > GAME.openRadiusM) {
    return reject('too_far', `You are ${Math.round(crate.distance_m)} m away; get within ${GAME.openRadiusM} m`);
  }

  // 3. Anti-cheat hook. Throws propagate: fail closed.
  const verdict = await deps.validateOpen({
    db,
    now: new Date(),
    playerId: inp.playerId,
    walletAddress: inp.walletAddress,
    deviceId: inp.deviceId,
    ip,
    client: { lat: inp.lat, lng: inp.lng, accuracyM: inp.accuracyM, clientTs: inp.clientTs },
    crate: {
      id: crate.id,
      lat: crate.lat,
      lng: crate.lng,
      kind: crate.kind,
      spawnedAt: new Date(crate.spawned_at),
      expiresAt: new Date(crate.expires_at),
    },
    distanceM: crate.distance_m,
  });
  if (!verdict.ok) {
    if (verdict.flag) {
      await db.query(
        `INSERT INTO player_flags (player_id, source, reason, details) VALUES ($1, 'anticheat', $2, $3)`,
        [inp.playerId, verdict.flag.reason, JSON.stringify(verdict.flag.details ?? {})],
      );
    }
    return reject('anticheat', verdict.reason);
  }

  // 4. The atomic part.
  const result = await withTx(db, async (c): Promise<OpenCrateResult | 'raced'> => {
    const p = await c.query<{ status: string; shards: number; tickets: number }>(
      'SELECT status, shards, tickets FROM players WHERE id = $1 FOR UPDATE',
      [inp.playerId],
    );
    const player = p.rows[0]!;
    if (player.status !== 'active') return reject('frozen', 'Account is under review');

    const locked = await c.query<CrateRow>(`${CRATE_SQL} FOR UPDATE`, [inp.crateId, inp.lat, inp.lng]);
    const lc = locked.rows[0]!;
    if (lc.status === 'opened') return 'raced';
    if (lc.status !== 'active' || lc.expired) return reject('expired', 'Crate expired');
    const near = await c.query<{ ok: boolean }>(
      `SELECT ST_DWithin(location, ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography, $4) AS ok FROM crates WHERE id = $1`,
      [inp.crateId, inp.lat, inp.lng, GAME.openRadiusM],
    );
    if (!near.rows[0]?.ok) return reject('too_far', `Get within ${GAME.openRadiusM} m`);

    const weights = effectiveWeights(await loadOdds(lc.kind, c), await availableByTier(c));
    const rolled = rollTier(weights, rng);
    const openingId = randomUUID();

    let item: any = null;
    if (rolled !== 'shards') {
      const res = await c.query(
        `UPDATE inventory_items SET status = 'reserved', reserved_by_opening_id = $1, reserved_at = now()
          WHERE status = 'available' AND id = (
            SELECT id FROM inventory_items WHERE status = 'available' AND tier = $2
             ORDER BY acquired_at, id LIMIT 1 FOR UPDATE SKIP LOCKED)
          RETURNING id AS item_id, nft_mint, card_name, grade, value_usd, tier, image_url`,
        [openingId, rolled],
      );
      item = res.rows[0] ?? null;
    }

    const common = [openingId, lc.id, inp.playerId, inp.walletAddress, rolled, inp.lat, inp.lng, inp.accuracyM, lc.distance_m, inp.deviceId, ip];
    const insertOpening = `INSERT INTO crate_openings
        (id, crate_id, player_id, wallet_address, rolled_tier, client_lat, client_lng, client_accuracy_m, distance_m, device_id, ip,
         result, downgraded, shards_awarded, tickets_awarded, inventory_item_id, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`;

    let out: OpenCrateResult;
    if (item) {
      await c.query(insertOpening, [...common, 'card', false, 0, 0, item.item_id, 'pending']);
      await enqueuePrizeSend(c, {
        openingId,
        inventoryItemId: item.item_id,
        playerId: inp.playerId,
        nftMint: item.nft_mint,
        recipientAddress: inp.walletAddress,
      });
      out = { ok: true, openingId, replayed: false, outcome: 'card', item: toItem(item), prizeStatus: 'pending' };
    } else {
      const downgraded = rolled !== 'shards';
      const award = rng(GAME.shardsPerEmptyMin, GAME.shardsPerEmptyMax + 1);
      const bal = applyShards(player.shards, player.tickets, award);
      await c.query('UPDATE players SET shards = $2, tickets = $3 WHERE id = $1', [inp.playerId, bal.shards, bal.tickets]);
      await c.query(insertOpening, [...common, 'shards', downgraded, award, bal.ticketsAwarded, null, 'complete']);
      out = {
        ok: true,
        openingId,
        replayed: false,
        outcome: 'shards',
        shardsAwarded: award,
        ticketsAwarded: bal.ticketsAwarded,
        shards: bal.shards,
        tickets: bal.tickets,
        downgraded,
      };
    }
    await c.query(`UPDATE crates SET status = 'opened', opened_at = now() WHERE id = $1`, [lc.id]);
    return out;
  });

  if (result === 'raced') {
    return (await replay(db, inp.crateId, inp.playerId)) ?? reject('already_opened', 'Crate already opened');
  }
  return result;
}
