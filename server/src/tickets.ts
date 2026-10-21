import type { Pool } from 'pg';
import { getPool, withTx } from './db';
import { insertCrate } from './crates';
import { PositionSchema } from './schemas';
import { convertShards } from './shards';
import type { CrateView } from './types';

/** Spends one ticket to spawn a better-odds ticket crate at the player's position. */
export async function useTicket(
  input: { playerId: string; lat: number; lng: number },
  db: Pool = getPool(),
): Promise<{ ok: true; crate: CrateView; tickets: number } | { ok: false; code: 'no_tickets' | 'frozen' }> {
  const { playerId, lat, lng } = PositionSchema.parse(input);
  return withTx(db, async (c) => {
    const p = await c.query<{ status: string; shards: number; tickets: number }>(
      'SELECT status, shards, tickets FROM players WHERE id = $1 FOR UPDATE',
      [playerId],
    );
    const player = p.rows[0];
    if (!player || player.status !== 'active') return { ok: false, code: 'frozen' } as const;
    if (player.tickets < 1) return { ok: false, code: 'no_tickets' } as const;

    // Spending a ticket frees room, so banked shards may convert straight away.
    const bal = convertShards(player.shards, player.tickets - 1);
    await c.query('UPDATE players SET shards = $2, tickets = $3 WHERE id = $1', [playerId, bal.shards, bal.tickets]);
    const crate = await insertCrate(c, { playerId, lat, lng, kind: 'ticket' });
    await c.query('INSERT INTO ticket_spends (player_id, crate_id) VALUES ($1, $2)', [playerId, crate.id]);
    return { ok: true, crate, tickets: bal.tickets } as const;
  });
}
