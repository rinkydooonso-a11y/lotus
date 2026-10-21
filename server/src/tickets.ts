import type { Pool, PoolClient } from 'pg';
import { GAME } from './config';
import { getPool, UTC_DAY } from './db';
import type { PlayerAllowance } from './types';

/**
 * What a player may open right now: GAME.freeOpensPerDay free opens per UTC day, then one more open
 * per banked ticket.
 *
 * Tickets are no longer spent on a button of their own — nothing spawns a private crate any more.
 * They are spent at the moment of opening (see openCrate.ts), so a ticket can never be wasted on a
 * crate the player doesn't reach. This is a read: the allowance is claimed inside the open
 * transaction, never here.
 */
export async function getAllowance(playerId: string, db: Pool | PoolClient = getPool()): Promise<PlayerAllowance> {
  const r = await db.query<{ tickets: number; free_used: number; opens_used: number }>(
    `SELECT p.tickets, coalesce(d.free_used, 0) AS free_used, coalesce(d.opens_used, 0) AS opens_used
       FROM players p
       LEFT JOIN player_open_days d ON d.player_id = p.id AND d.open_day = ${UTC_DAY}
      WHERE p.id = $1`,
    [playerId],
  );
  const row = r.rows[0];
  const tickets = row?.tickets ?? 0;
  const freeOpensLeft = Math.max(0, GAME.freeOpensPerDay - (row?.free_used ?? 0));
  return {
    freeOpensLeft,
    tickets,
    opensUsedToday: row?.opens_used ?? 0,
    /** True when the next open will spend a ticket, so the UI can say so before they tap. */
    nextOpenCostsTicket: freeOpensLeft === 0,
    opensLeft: freeOpensLeft + tickets,
    freeOpensPerDay: GAME.freeOpensPerDay,
    shardsPerTicket: GAME.shardsPerTicket,
  };
}
