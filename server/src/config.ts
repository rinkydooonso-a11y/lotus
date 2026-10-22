import type { CardTier } from './types';

/** Reads a non-negative number from the environment, falling back when unset or unparseable. */
function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * Game tuning. Change here or with the LOTUS_* env vars; see docs/decisions.md.
 *
 * Crates exist only in the launch cities (see cities.ts), as one shared set per city placed by the
 * seeder worker. Nothing is ever placed because a particular player turned up, so the number of
 * crates in the world does not grow with the number of players.
 *
 * What the game can pay out in a day is bounded twice over:
 *   cratesPerCity x cities        - how many crates exist to be opened at all
 *   maxWorldCratesPerDay          - hard ceiling on crates created per UTC day
 *   the prize pool / poolPayoutDays - the real stop: a day pays out at most that share of the money
 *     that has come in (see odds.ts); past it, card tiers roll 0
 * freeOpensPerDay bounds what one player can take, not what the game spends.
 */
export const GAME = {
  /** How close you must be to a crate to open it. */
  openRadiusM: 40,
  /** How long a world crate stays on the map. The seeder replaces expired ones. */
  crateTtlMs: num('LOTUS_CRATE_TTL_MIN', 12 * 60) * 60_000,
  /** Active crates the seeder keeps alive in each launch city. */
  cratesPerCity: num('LOTUS_CRATES_PER_CITY', 60),
  /** Hard global ceiling on crates created per UTC day, whatever the per-city target says. */
  maxWorldCratesPerDay: num('LOTUS_MAX_CRATES_PER_DAY', 1_500),
  /** No two active crates closer than this, so a cluster can't be cleared from one spot. */
  crateMinSpacingM: num('LOTUS_CRATE_SPACING_M', 120),
  /** How far from the player crates are sent to the map. */
  nearbyRadiusM: num('LOTUS_NEARBY_RADIUS_M', 2_000),
  /** Opens a player gets for free each UTC day. Every further open that day spends a ticket. */
  freeOpensPerDay: num('LOTUS_FREE_OPENS_PER_DAY', 10),
  /**
   * The day's prize ceiling is the prize pool (card fund cash plus the cost of the cards in stock)
   * divided by this many days, fixed when the day's first card is awarded and released evenly over
   * the 24 hours. Every limit scales with the money that has come in, so a flop pays out slowly and
   * a boom pays out more, and nothing is ever owed.
   */
  poolPayoutDays: Math.max(1, num('LOTUS_POOL_PAYOUT_DAYS', 14)),
  /**
   * Sanity stop on the number of cards in a day, for a pool full of cheap cards. High on purpose:
   * the pool, not this, is the limit that binds.
   */
  maxCardsPerDay: num('LOTUS_MAX_CARDS_PER_DAY', 1000),
  /**
   * Optional fixed dollar ceiling that replaces the pool-based one (0 = off). An emergency dial,
   * not a normal setting.
   */
  maxCardValueUsdPerDay: num('LOTUS_MAX_CARD_VALUE_PER_DAY', 0),
  shardsPerEmptyMin: 1,
  shardsPerEmptyMax: 3,
  /**
   * Shards banked for one ticket. At ten opens a day and a 99% miss rate a player banks roughly 20
   * shards a day, so a ticket is a little under a day's walking and tickets stay a bonus rather than
   * the main way people open crates.
   */
  shardsPerTicket: 25,
  maxTickets: 5,
  oddsTotal: 1_000_000,
} as const;

/** Insured value bands (USD). */
export function tierForValue(valueUsd: number): CardTier {
  if (valueUsd >= 300) return 'grail';
  if (valueUsd >= 75) return 'rare';
  if (valueUsd >= 30) return 'uncommon';
  return 'common';
}
