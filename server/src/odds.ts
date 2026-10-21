import type { Pool, PoolClient } from 'pg';
import { GAME } from './config';
import { getPool, UTC_DAY, withTx } from './db';
import type { Rng } from './rng';
import { OddsWeightsSchema } from './schemas';
import { CARD_TIERS, ROLL_TIERS, type CardTier, type CrateKind, type OddsView, type RollTier } from './types';

export type Weights = Record<RollTier, number>;
type Q = Pool | PoolClient;

export async function loadOdds(kind: CrateKind, db: Q): Promise<Weights> {
  const r = await db.query<{ tier: RollTier; weight: number }>(
    'SELECT tier, weight FROM odds_config WHERE crate_kind = $1',
    [kind],
  );
  const w: Weights = { grail: 0, rare: 0, uncommon: 0, common: 0, shards: 0 };
  for (const row of r.rows) w[row.tier] = row.weight;
  return w;
}

export async function availableByTier(db: Q): Promise<Record<CardTier, number>> {
  const r = await db.query<{ tier: CardTier; n: number }>(
    `SELECT tier, count(*)::int AS n FROM inventory_items WHERE status = 'available' GROUP BY tier`,
  );
  const out: Record<CardTier, number> = { common: 0, uncommon: 0, rare: 0, grail: 0 };
  for (const row of r.rows) out[row.tier] = row.n;
  return out;
}

/**
 * Tiers with no available cards get weight 0; shards absorbs the rest so the total stays
 * GAME.oddsTotal. With cardsBlocked (the day's prize budget is spent) every card tier is 0, so the
 * roll can only pay shards and the published odds say so.
 */
export function effectiveWeights(
  base: Weights,
  available: Record<CardTier, number>,
  opts: { cardsBlocked?: boolean } = {},
): Weights {
  const w: Weights = { ...base };
  let cards = 0;
  for (const t of CARD_TIERS) {
    if (opts.cardsBlocked || available[t] <= 0) w[t] = 0;
    cards += w[t];
  }
  w.shards = Math.max(0, GAME.oddsTotal - cards);
  return w;
}

/** One CSPRNG draw in [0, oddsTotal) mapped onto cumulative weights, rarest first. */
export function rollTier(weights: Weights, rng: Rng): RollTier {
  const r = rng(0, GAME.oddsTotal);
  let acc = 0;
  for (const t of ROLL_TIERS) {
    acc += weights[t];
    if (r < acc) return t;
  }
  return 'shards';
}

// Daily prize budget ----------------------------------------------------------------------

export interface BudgetCaps {
  maxCards?: number;
  maxValueUsd?: number;
}

export interface DailyBudget {
  cardsAwarded: number;
  valueAwardedUsd: number;
  cardsLeft: number;
  valueLeftUsd: number;
  /** No card may be awarded for the rest of the UTC day. */
  exhausted: boolean;
}

const caps = (c: BudgetCaps = {}) => ({
  maxCards: c.maxCards ?? GAME.maxCardsPerDay,
  maxValueUsd: c.maxValueUsd ?? GAME.maxCardValueUsdPerDay,
});

/** What today's prize budget has left. A single-row lookup, cheap enough to run on every open. */
export async function dailyBudget(db: Q = getPool(), c: BudgetCaps = {}): Promise<DailyBudget> {
  const { maxCards, maxValueUsd } = caps(c);
  const r = await db.query<{ cards_awarded: number; value_awarded_usd: string }>(
    `SELECT cards_awarded, value_awarded_usd FROM prize_budget_days WHERE budget_day = ${UTC_DAY}`,
  );
  const cardsAwarded = r.rows[0]?.cards_awarded ?? 0;
  const valueAwardedUsd = Number(r.rows[0]?.value_awarded_usd ?? 0);
  const cardsLeft = Math.max(0, maxCards - cardsAwarded);
  const valueLeftUsd = Math.max(0, maxValueUsd - valueAwardedUsd);
  return { cardsAwarded, valueAwardedUsd, cardsLeft, valueLeftUsd, exhausted: cardsLeft <= 0 || valueLeftUsd <= 0 };
}

/**
 * Books one card of `valueUsd` against today's budget. Returns false when it would go over either
 * ceiling, in which case the caller must not award the card. Must run inside the open transaction:
 * the conditional UPDATE is what makes the day's ceiling exact under concurrent wins.
 */
export async function claimBudgetSlot(c: PoolClient, valueUsd: number, b: BudgetCaps = {}): Promise<boolean> {
  const { maxCards, maxValueUsd } = caps(b);
  const r = await c.query(
    // The SELECT ... WHERE guards the first card of a new day; the ON CONFLICT WHERE guards the rest.
    `INSERT INTO prize_budget_days (budget_day, cards_awarded, value_awarded_usd)
     SELECT ${UTC_DAY}, 1, $3::numeric WHERE 1 <= $1::int AND $3::numeric <= $2::numeric
     ON CONFLICT (budget_day) DO UPDATE
        SET cards_awarded = prize_budget_days.cards_awarded + 1,
            value_awarded_usd = prize_budget_days.value_awarded_usd + $3::numeric,
            updated_at = now()
      WHERE prize_budget_days.cards_awarded + 1 <= $1::int
        AND prize_budget_days.value_awarded_usd + $3::numeric <= $2::numeric
     RETURNING cards_awarded`,
    [maxCards, maxValueUsd, valueUsd],
  );
  return (r.rowCount ?? 0) === 1;
}

export async function getPublicOdds(kind: CrateKind = 'standard', db: Pool = getPool()): Promise<OddsView[]> {
  const [base, avail, budget] = await Promise.all([loadOdds(kind, db), availableByTier(db), dailyBudget(db)]);
  const eff = effectiveWeights(base, avail, { cardsBlocked: budget.exhausted });
  return ROLL_TIERS.map((tier) => ({ tier, baseWeight: base[tier], probability: eff[tier] / GAME.oddsTotal }));
}

export async function setOdds(kind: CrateKind, weights: Weights, db: Pool = getPool()): Promise<void> {
  const w = OddsWeightsSchema.parse(weights);
  const sum = ROLL_TIERS.reduce((s, t) => s + w[t], 0);
  if (sum !== GAME.oddsTotal) throw new Error(`odds must sum to ${GAME.oddsTotal}, got ${sum}`);
  await withTx(db, async (c) => {
    for (const t of ROLL_TIERS) {
      await c.query(
        `INSERT INTO odds_config (crate_kind, tier, weight, updated_at) VALUES ($1, $2, $3, now())
         ON CONFLICT (crate_kind, tier) DO UPDATE SET weight = EXCLUDED.weight, updated_at = now()`,
        [kind, t, w[t]],
      );
    }
  });
}
