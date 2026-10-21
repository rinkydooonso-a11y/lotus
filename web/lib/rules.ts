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
/** Most card value (USD) the game awards across all players per UTC day. Mirrors LOTUS_MAX_CARD_VALUE_PER_DAY. */
export const DAILY_PRIZE_CAP_USD = 400;
/** USD of the coin a wallet must hold to open a crate. Mirrors LOTUS_HOLD_REQUIRED_USD. */
export const COIN_HOLD_USD = 25;
