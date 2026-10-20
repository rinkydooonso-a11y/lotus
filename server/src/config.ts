import type { CardTier } from './types';

/** Game tuning. Change here; see docs/decisions.md. */
export const GAME = {
  openRadiusM: 40,
  crateTtlMs: 30 * 60 * 1000,
  maxActiveCratesPerPlayer: 3,
  maxSpawnsPerPlayerPerDay: 40,
  spawnMinDistanceM: 40,
  spawnMaxDistanceM: 250,
  shardsPerEmptyMin: 1,
  shardsPerEmptyMax: 3,
  shardsPerTicket: 10,
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
