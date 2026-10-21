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
 *   maxCardsPerDay / maxCardValueUsdPerDay - the real stop; past either, card tiers roll 0
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
   * Circuit breaker: once either is reached in a UTC day, card tiers roll 0 and opens pay shards.
   *
   * The dollar ceiling is the one to set from fee income; it is meant to be the limit that binds.
   * The card count is a sanity stop for the case where the vault fills with cheap cards, so keep it
   * high enough that an average day's cards cost more than maxCardsPerDay x the average card.
   */
  maxCardsPerDay: num('LOTUS_MAX_CARDS_PER_DAY', 25),
  maxCardValueUsdPerDay: num('LOTUS_MAX_CARD_VALUE_PER_DAY', 400),
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
