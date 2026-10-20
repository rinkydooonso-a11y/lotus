import type { Pool } from 'pg';
import { getPool, withTx } from './db';
import { PingSchema, WalletLoginSchema } from './schemas';
import type { PingInput, PlayerSummary, WalletType } from './types';

/** Finds the player that owns this wallet, or creates a player + wallet. */
export async function upsertPlayerByWallet(
  input: { address: string; type: WalletType },
  db: Pool = getPool(),
): Promise<{ playerId: string; created: boolean }> {
  const { address, type } = WalletLoginSchema.parse(input);
  const existing = await db.query<{ player_id: string }>('SELECT player_id FROM wallets WHERE address = $1', [address]);
  if (existing.rows[0]) return { playerId: existing.rows[0].player_id, created: false };

  return withTx(db, async (c) => {
    const p = await c.query<{ id: string }>('INSERT INTO players DEFAULT VALUES RETURNING id');
    const playerId = p.rows[0]!.id;
    const w = await c.query<{ player_id: string }>(
      `INSERT INTO wallets (player_id, address, type, is_primary) VALUES ($1, $2, $3, true)
       ON CONFLICT (address) DO NOTHING RETURNING player_id`,
      [playerId, address, type],
    );
    if (w.rows[0]) return { playerId, created: true };
    // Lost a race with a concurrent login for the same wallet: drop our player row.
    await c.query('DELETE FROM players WHERE id = $1', [playerId]);
    const again = await c.query<{ player_id: string }>('SELECT player_id FROM wallets WHERE address = $1', [address]);
    return { playerId: again.rows[0]!.player_id, created: false };
  });
}

export async function getPlayer(playerId: string, db: Pool = getPool()): Promise<PlayerSummary | null> {
  const r = await db.query(
    `SELECT p.id, p.status, p.shards, p.tickets, p.created_at,
            coalesce(json_agg(json_build_object('address', w.address, 'type', w.type, 'isPrimary', w.is_primary))
                     FILTER (WHERE w.id IS NOT NULL), '[]') AS wallets
       FROM players p LEFT JOIN wallets w ON w.player_id = p.id
      WHERE p.id = $1 GROUP BY p.id`,
    [playerId],
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    shards: row.shards,
    tickets: row.tickets,
    createdAt: new Date(row.created_at).toISOString(),
    wallets: row.wallets,
  };
}

export async function recordLocationPing(input: PingInput, db: Pool = getPool()): Promise<void> {
  const p = PingSchema.parse(input);
  await db.query(
    `INSERT INTO location_pings (player_id, location, accuracy_m, client_ts, device_id, ip)
     VALUES ($1, ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography, $4, to_timestamp($5 / 1000.0), $6, $7)`,
    [p.playerId, p.lat, p.lng, p.accuracyM, p.clientTs, p.deviceId, p.ip ?? null],
  );
}
