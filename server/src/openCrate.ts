import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { GAME } from './config';
import { getPool, UTC_DAY, withTx } from './db';
import { checkCoinHold, type HoldDeps } from './holding';
import {
  availableByTier,
  claimBudgetSlot,
  dailyBudget,
  effectiveWeights,
  loadOdds,
  rollTier,
  type BudgetCaps,
} from './odds';
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
  /** Tests only: override the day's prize budget ceilings. */
  budget?: BudgetCaps;
  /**
   * Coin holder gate. Left out, it reads its own configuration and is off until COIN_MINT is set.
   * Tests pass a config and stub lookups; `{ config: null }` forces it off.
   */
  hold?: HoldDeps;
}

interface CrateRow {
  id: string;
  kind: CrateKind;
  status: 'active' | 'opened' | 'expired';
  city: string | null;
  spawned_at: Date;
  expires_at: Date;
  lat: number;
  lng: number;
  distance_m: number;
  expired: boolean;
}

const reject = (code: OpenRejectCode, message: string): OpenCrateResult => ({ ok: false, code, message });

const TAKEN = 'Another collector got to this crate first';

const CRATE_SQL = `SELECT id, kind, status, city, spawned_at, expires_at,
       ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng,
       ST_Distance(location, ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography) AS distance_m,
       expires_at <= now() AS expired
  FROM crates WHERE id = $1`;

const RESERVE_SQL = `UPDATE inventory_items SET status = 'reserved', reserved_by_opening_id = $1, reserved_at = now()
  WHERE status = 'available' AND id = (
    SELECT id FROM inventory_items WHERE status = 'available' AND tier = $2
     ORDER BY acquired_at, id LIMIT 1 FOR UPDATE SKIP LOCKED)
  RETURNING id AS item_id, nft_mint, card_name, grade, value_usd, tier, image_url`;

const OPENING_COLS = `(id, crate_id, player_id, wallet_address, rolled_tier, client_lat, client_lng,
   client_accuracy_m, distance_m, device_id, ip, roll_kind, ticket_spent,
   result, downgraded, budget_capped, shards_awarded, tickets_awarded, inventory_item_id, status)`;
const OPENING_VALUES = `($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`;

function toItem(r: { item_id: string; nft_mint: string; card_name: string; grade: string | null; value_usd: string | number; tier: string; image_url: string | null }): PrizeItemView {
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

/**
 * Rebuilds the result of an opening that already happened. Returns null when this crate was opened
 * by somebody else, which on a shared crate is the normal way to lose a race.
 */
async function replay(db: Pool | PoolClient, crateId: string, playerId: string): Promise<OpenCrateResult | null> {
  const r = await db.query(
    `SELECT o.id, o.player_id, o.result, o.downgraded, o.budget_capped, o.ticket_spent,
            o.shards_awarded, o.tickets_awarded, o.status,
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
    return {
      ok: true,
      openingId: o.id,
      replayed: true,
      outcome: 'card',
      item: toItem(o),
      prizeStatus: o.status,
      ticketSpent: o.ticket_spent,
    };
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
    budgetCapped: o.budget_capped,
    ticketSpent: o.ticket_spent,
  };
}

/**
 * Validates and opens a world crate. playerId and walletAddress must come from the authenticated
 * session. Crates are shared, so the two things this has to get right under load are:
 *
 *  - One crate, one opening. The crate row is locked FOR UPDATE and crate_openings.crate_id is
 *    UNIQUE, so of two players reaching for the same crate exactly one wins; the loser is told it
 *    was taken and keeps their daily open and their anti-cheat cooldown.
 *  - Never award what we can't pay. A card is reserved with FOR UPDATE SKIP LOCKED and booked
 *    against the day's prize budget in the same transaction as the opening. If either fails the
 *    result downgrades to shards.
 *
 * The coin holder gate runs before the transaction, since it makes network calls. It is off until
 * COIN_MINT is set, and refuses the open when it can't read the chain or the price (holding.ts).
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
  if (crate.status === 'opened') {
    return (await replay(db, crate.id, inp.playerId)) ?? reject('taken', TAKEN);
  }
  if (crate.status === 'expired' || crate.expired) return reject('expired', 'This crate is gone');

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

  // 3. Coin holder gate. Before anti-cheat on purpose: anti-cheat reserves a cooldown, and somebody
  // who simply hasn't bought the coin yet shouldn't burn one. Off entirely until COIN_MINT is set.
  const holding = await checkCoinHold(
    { playerId: inp.playerId, walletAddress: inp.walletAddress },
    { db, ...deps.hold },
  );
  if (!holding.ok) return reject(holding.code, holding.message);

  // 4. Anti-cheat hook. Throws propagate: fail closed.
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
  // Losing a race for a shared crate is not the player's fault, so give their cooldown and daily
  // anti-cheat quota back whenever the open doesn't actually happen.
  const giveBack = async () => {
    try {
      await verdict.release?.();
    } catch {
      /* best effort: the quota expires on its own */
    }
  };

  // 5. The atomic part.
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
    if (lc.status !== 'active' || lc.expired) return reject('expired', 'This crate is gone');
    const near = await c.query<{ ok: boolean }>(
      `SELECT ST_DWithin(location, ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography, $4) AS ok FROM crates WHERE id = $1`,
      [inp.crateId, inp.lat, inp.lng, GAME.openRadiusM],
    );
    if (!near.rows[0]?.ok) return reject('too_far', `Get within ${GAME.openRadiusM} m`);

    // 6. Daily allowance. The first GAME.freeOpensPerDay opens of the UTC day are free; every
    // further open that day spends a ticket and rolls on the better 'ticket' odds. Both claims are
    // conditional writes, so two simultaneous opens can't both take the last free one or the last
    // ticket. Returning a rejection here writes nothing: neither statement changes a row when its
    // condition fails.
    const free = await c.query(
      `INSERT INTO player_open_days (player_id, open_day, opens_used, free_used, tickets_used)
       SELECT $1::uuid, ${UTC_DAY}, 1, 1, 0 WHERE 0 < $2::int
       ON CONFLICT (player_id, open_day) DO UPDATE
          SET opens_used = player_open_days.opens_used + 1,
              free_used = player_open_days.free_used + 1,
              last_open_at = now()
        WHERE player_open_days.free_used < $2::int
       RETURNING free_used`,
      [inp.playerId, GAME.freeOpensPerDay],
    );

    let rollKind: CrateKind = 'standard';
    let ticketSpent = false;
    let tickets = player.tickets;
    if ((free.rowCount ?? 0) !== 1) {
      const t = await c.query<{ tickets: number }>(
        'UPDATE players SET tickets = tickets - 1 WHERE id = $1 AND tickets > 0 RETURNING tickets',
        [inp.playerId],
      );
      if ((t.rowCount ?? 0) !== 1) {
        return reject(
          'daily_limit',
          `That's all ${GAME.freeOpensPerDay} of today's opens. Bank ${GAME.shardsPerTicket} shards for a ticket and you can open another.`,
        );
      }
      tickets = t.rows[0]!.tickets;
      ticketSpent = true;
      rollKind = 'ticket';
      await c.query(
        `INSERT INTO player_open_days (player_id, open_day, opens_used, free_used, tickets_used)
         VALUES ($1, ${UTC_DAY}, 1, 0, 1)
         ON CONFLICT (player_id, open_day) DO UPDATE
            SET opens_used = player_open_days.opens_used + 1,
                tickets_used = player_open_days.tickets_used + 1,
                last_open_at = now()`,
        [inp.playerId],
      );
    }

    // 7. The roll. Card tiers the vault can't cover, or that the day's budget can't pay for, are
    // zeroed before the draw, so the published odds never promise what can't be delivered.
    const budget = await dailyBudget(c, deps.budget);
    const [base, available] = await Promise.all([loadOdds(rollKind, c), availableByTier(c)]);
    const rolled = rollTier(effectiveWeights(base, available, { cardsBlocked: budget.exhausted }), rng);
    const openingId = randomUUID();

    let item: PrizeItemView | null = null;
    let budgetCapped = budget.exhausted;
    if (rolled !== 'shards') {
      // The reservation and the budget booking stand or fall together: if the card would take the
      // day over its ceiling, the savepoint puts it straight back in the pool.
      await c.query('SAVEPOINT award');
      const res = await c.query(RESERVE_SQL, [openingId, rolled]);
      const row = res.rows[0];
      if (row && !(await claimBudgetSlot(c, Number(row.value_usd), deps.budget))) {
        await c.query('ROLLBACK TO SAVEPOINT award');
        budgetCapped = true;
      } else {
        await c.query('RELEASE SAVEPOINT award');
        item = row ? toItem(row) : null;
      }
    }

    const common = [
      openingId, lc.id, inp.playerId, inp.walletAddress, rolled,
      inp.lat, inp.lng, inp.accuracyM, lc.distance_m, inp.deviceId, ip,
      rollKind, ticketSpent,
    ];
    const insertOpening = `INSERT INTO crate_openings ${OPENING_COLS} VALUES ${OPENING_VALUES}`;

    let out: OpenCrateResult;
    if (item) {
      await c.query(insertOpening, [...common, 'card', false, false, 0, 0, item.id, 'pending']);
      await enqueuePrizeSend(c, {
        openingId,
        inventoryItemId: item.id,
        playerId: inp.playerId,
        nftMint: item.nftMint,
        recipientAddress: inp.walletAddress,
      });
      out = { ok: true, openingId, replayed: false, outcome: 'card', item, prizeStatus: 'pending', ticketSpent };
    } else {
      const downgraded = rolled !== 'shards';
      const award = rng(GAME.shardsPerEmptyMin, GAME.shardsPerEmptyMax + 1);
      const bal = applyShards(player.shards, tickets, award);
      await c.query('UPDATE players SET shards = $2, tickets = $3 WHERE id = $1', [inp.playerId, bal.shards, bal.tickets]);
      await c.query(insertOpening, [...common, 'shards', downgraded, budgetCapped, award, bal.ticketsAwarded, null, 'complete']);
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
        budgetCapped,
        ticketSpent,
      };
    }
    if (ticketSpent) {
      await c.query('INSERT INTO ticket_spends (player_id, opening_id) VALUES ($1, $2)', [inp.playerId, openingId]);
    }
    await c.query(
      `UPDATE crates SET status = 'opened', opened_at = now(), claimed_by_player_id = $2 WHERE id = $1`,
      [lc.id, inp.playerId],
    );
    return out;
  });

  if (result === 'raced') {
    await giveBack();
    return (await replay(db, inp.crateId, inp.playerId)) ?? reject('taken', TAKEN);
  }
  if (!result.ok) await giveBack();
  return result;
}
