import { GAME } from './config';

/**
 * Adds shards and converts every GAME.shardsPerTicket into a ticket while tickets < max.
 * Leftover shards stay and convert after a ticket is spent (see convertShards).
 */
export function applyShards(shards: number, tickets: number, add: number) {
  return convertShards(shards + add, tickets);
}

export function convertShards(shards: number, tickets: number) {
  const room = Math.max(0, GAME.maxTickets - tickets);
  const ticketsAwarded = Math.min(room, Math.floor(shards / GAME.shardsPerTicket));
  return {
    shards: shards - ticketsAwarded * GAME.shardsPerTicket,
    tickets: tickets + ticketsAwarded,
    ticketsAwarded,
  };
}
