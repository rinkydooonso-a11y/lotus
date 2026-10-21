/**
 * The game rules, mirrored for copy that is rendered before (or without) a player's balances.
 *
 * These must match `GAME` in server/src/config.ts. Anywhere a player's own `Balances` is in hand,
 * prefer `balances.freeOpensPerDay` / `balances.shardsPerTicket`: those come from the server and
 * follow the LOTUS_* env overrides, which these constants cannot see.
 */
export const FREE_OPENS_PER_DAY = 10;
export const SHARDS_PER_TICKET = 25;
export const MAX_TICKETS = 5;
/** Chance a street crate pays a card. See db/migrations/0008 and docs/odds.md. */
export const CARD_RATE = 0.01;
export const TICKET_CARD_RATE = 0.05;
