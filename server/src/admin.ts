import type { Pool } from 'pg';
import { tierForValue } from './config';
import { getPool, withTx } from './db';
import { NewInventoryItemSchema, NewTreasuryEventSchema } from './schemas';
import type { FlaggedPlayer, NewInventoryItem, NewTreasuryEvent } from './types';

export async function addInventoryItem(input: NewInventoryItem, db: Pool = getPool()): Promise<{ id: string }> {
  const i = NewInventoryItemSchema.parse(input);
  const r = await db.query<{ id: string }>(
    `INSERT INTO inventory_items (nft_mint, card_name, grade, value_usd, tier, image_url, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [i.nftMint, i.cardName, i.grade ?? null, i.valueUsd, i.tier ?? tierForValue(i.valueUsd), i.imageUrl ?? null, JSON.stringify(i.metadata ?? {})],
  );
  return r.rows[0]!;
}

/** Pull a card from (or return it to) the prize pool. Reserved and sent cards are owed or gone, so they're untouchable. */
export async function setInventoryStatus(
  id: string,
  status: 'available' | 'withheld' | 'removed',
  db: Pool = getPool(),
): Promise<void> {
  const r = await db.query(
    `UPDATE inventory_items SET status = $2 WHERE id = $1 AND status IN ('available', 'withheld', 'removed')`,
    [id, status],
  );
  if (r.rowCount !== 1) throw new Error(`inventory item ${id} not found or reserved/sent`);
}

/** Freezes the player and withholds their unsent prizes (handoff doc §6). */
export async function freezePlayer(playerId: string, reason: string, db: Pool = getPool()): Promise<void> {
  await withTx(db, async (c) => {
    await c.query(`UPDATE players SET status = 'frozen', frozen_reason = $2 WHERE id = $1`, [playerId, reason]);
    const held = await c.query<{ opening_id: string }>(
      `UPDATE prize_sends SET status = 'withheld', updated_at = now()
        WHERE player_id = $1 AND status IN ('queued', 'failed') RETURNING opening_id`,
      [playerId],
    );
    if (held.rows.length) {
      await c.query(`UPDATE crate_openings SET status = 'withheld' WHERE id = ANY($1)`, [held.rows.map((r) => r.opening_id)]);
    }
    await c.query(
      `INSERT INTO player_flags (player_id, source, reason) VALUES ($1, 'admin', $2)`,
      [playerId, `frozen: ${reason}`],
    );
  });
}

export async function unfreezePlayer(playerId: string, db: Pool = getPool()): Promise<void> {
  await withTx(db, async (c) => {
    await c.query(`UPDATE players SET status = 'active', frozen_reason = NULL WHERE id = $1`, [playerId]);
    const released = await c.query<{ opening_id: string }>(
      `UPDATE prize_sends SET status = 'queued', attempts = 0, updated_at = now()
        WHERE player_id = $1 AND status = 'withheld' RETURNING opening_id`,
      [playerId],
    );
    if (released.rows.length) {
      await c.query(`UPDATE crate_openings SET status = 'pending' WHERE id = ANY($1)`, [released.rows.map((r) => r.opening_id)]);
    }
    await c.query(`UPDATE player_flags SET resolved_at = now() WHERE player_id = $1 AND resolved_at IS NULL`, [playerId]);
  });
}

export async function listFlaggedPlayers(db: Pool = getPool()): Promise<FlaggedPlayer[]> {
  const r = await db.query(
    `SELECT p.id, p.status,
            count(f.id) FILTER (WHERE f.resolved_at IS NULL)::int AS open_flags,
            max(f.created_at) AS last_at,
            (array_agg(f.reason ORDER BY f.created_at DESC))[1] AS last_reason,
            (SELECT array_agg(address) FROM wallets w WHERE w.player_id = p.id) AS wallets
       FROM players p JOIN player_flags f ON f.player_id = p.id
      GROUP BY p.id
     HAVING count(f.id) FILTER (WHERE f.resolved_at IS NULL) > 0 OR p.status = 'frozen'
      ORDER BY max(f.created_at) DESC LIMIT 500`,
  );
  return r.rows.map((x) => ({
    playerId: x.id,
    status: x.status,
    openFlags: x.open_flags,
    lastFlagAt: new Date(x.last_at).toISOString(),
    lastReason: x.last_reason,
    wallets: x.wallets ?? [],
  }));
}

export async function recordTreasuryEvent(input: NewTreasuryEvent, db: Pool = getPool()): Promise<{ id: string }> {
  const e = NewTreasuryEventSchema.parse(input);
  const r = await db.query<{ id: string }>(
    `INSERT INTO treasury_events (kind, amount, asset, usd_value, tx_signature, note) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [e.kind, e.amount ?? null, e.asset ?? null, e.usdValue ?? null, e.txSignature ?? null, e.note ?? null],
  );
  return r.rows[0]!;
}
