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
  /** Fixed dollar ceiling for the day. Tests and the LOTUS_MAX_CARD_VALUE_PER_DAY emergency dial. */
  maxValueUsd?: number;
}

export interface DailyBudget {
  cardsAwarded: number;
  valueAwardedUsd: number;
  cardsLeft: number;
  /** What may still be awarded right now: the hours released so far, minus what has been awarded. */
  valueLeftUsd: number;
  /** The whole day's dollar ceiling. */
  ceilingUsd: number;
  /** No card may be awarded for the rest of the UTC day (or hour, for the dollar part). */
  exhausted: boolean;
}

export interface PrizePool {
  /** Card fund cash: seed money plus the card share of fee claims, minus card purchases. */
  cashUsd: number;
  /** Cards in stock, counted at what they cost us (insured value if the cost is unknown). */
  stockUsd: number;
  poolUsd: number;
}

/**
 * The money the game pays prizes from. Cards count at cost, not insured value, so buying a card
 * listed below its insured value can't make the pool, and so the ceiling, grow.
 */
export async function prizePool(db: Q): Promise<PrizePool> {
  const r = await db.query<{ cash: string; stock: string }>(
    `SELECT (SELECT COALESCE(sum(usd), 0) FROM prize_fund_entries)::text AS cash,
            (SELECT COALESCE(sum(COALESCE(cost_usd, value_usd)), 0) FROM inventory_items WHERE status = 'available')::text AS stock`,
  );
  const cashUsd = Number(r.rows[0]?.cash ?? 0);
  const stockUsd = Number(r.rows[0]?.stock ?? 0);
  return { cashUsd, stockUsd, poolUsd: Math.max(0, cashUsd) + stockUsd };
}

/** A day's dollar ceiling from a pool: one payout-day's share, in whole cents, rounded down. */
export const ceilingFromPool = (poolUsd: number, payoutDays: number = GAME.poolPayoutDays): number =>
  Math.floor((poolUsd / Math.max(1, payoutDays)) * 100) / 100;

interface DayBasis {
  maxCards: number;
  /** Set when a fixed ceiling replaces the pool-based one. */
  fixedUsd: number | null;
  ceilingUsd: number;
  /** Hours of the day released so far, 1 to 24; 24 for a fixed ceiling. */
  hours: number;
  cardsAwarded: number;
  valueAwardedUsd: number;
}

async function dayBasis(db: Q, c: BudgetCaps = {}): Promise<DayBasis> {
  const maxCards = c.maxCards ?? GAME.maxCardsPerDay;
  // An explicit cap (tests, emergency override) is spent in full all day. The configured daily budget is
  // not: it is the day's ceiling like the pool-based one, fixed when the first card is awarded, never
  // above the pool, and released an hour at a time.
  const fixed = c.maxValueUsd ?? null;
  const budgetUsd = GAME.maxCardValueUsdPerDay > 0 ? GAME.maxCardValueUsdPerDay : null;
  const r = await db.query<{ hour: number; cards_awarded: number | null; value_awarded_usd: string | null; ceiling_usd: string | null }>(
    `SELECT extract(hour FROM now() AT TIME ZONE 'UTC')::int AS hour, b.cards_awarded, b.value_awarded_usd, b.ceiling_usd
       FROM (SELECT 1) x LEFT JOIN prize_budget_days b ON b.budget_day = ${UTC_DAY}`,
  );
  const row = r.rows[0]!;
  const fromPool = async (): Promise<number> => {
    const { poolUsd } = await prizePool(db);
    return budgetUsd !== null ? Math.floor(Math.min(budgetUsd, poolUsd) * 100) / 100 : ceilingFromPool(poolUsd);
  };
  const ceilingUsd = fixed ?? (row.ceiling_usd !== null ? Number(row.ceiling_usd) : await fromPool());
  return {
    maxCards,
    fixedUsd: fixed,
    ceilingUsd,
    hours: fixed !== null ? 24 : row.hour + 1,
    cardsAwarded: row.cards_awarded ?? 0,
    valueAwardedUsd: Number(row.value_awarded_usd ?? 0),
  };
}

/** What today's prize budget has left. Cheap enough to run on every open. */
export async function dailyBudget(db: Q = getPool(), c: BudgetCaps = {}): Promise<DailyBudget> {
  const b = await dayBasis(db, c);
  const cardsLeft = Math.max(0, b.maxCards - b.cardsAwarded);
  const released = (b.ceilingUsd * b.hours) / 24;
  const valueLeftUsd = Math.max(0, Math.floor((released - b.valueAwardedUsd) * 100) / 100);
  return {
    cardsAwarded: b.cardsAwarded,
    valueAwardedUsd: b.valueAwardedUsd,
    cardsLeft,
    valueLeftUsd,
    ceilingUsd: b.ceilingUsd,
    exhausted: cardsLeft <= 0 || valueLeftUsd <= 0,
  };
}

/**
 * Books one card of `valueUsd` against today's budget. Returns false when it would go over either
 * ceiling, in which case the caller must not award the card. Must run inside the open transaction:
 * the conditional UPDATE is what makes the day's ceiling exact under concurrent wins.
 *
 * The ceiling is stored on the day's row when its first card is booked, so it doesn't move during
 * the day. Only the first `hours` hours of it are spendable, which stops one busy hour taking the
 * whole day; whatever an hour doesn't use carries into the next.
 */
export async function claimBudgetSlot(c: PoolClient, valueUsd: number, b: BudgetCaps = {}): Promise<boolean> {
  const basis = await dayBasis(c, b);
  const r = await c.query(
    // The SELECT ... WHERE guards the first card of a new day; the ON CONFLICT WHERE guards the rest.
    `INSERT INTO prize_budget_days (budget_day, cards_awarded, value_awarded_usd, ceiling_usd)
     SELECT ${UTC_DAY}, 1, $3::numeric, $4::numeric WHERE 1 <= $1::int AND $3::numeric <= $4::numeric * $5::int / 24
     ON CONFLICT (budget_day) DO UPDATE
        SET cards_awarded = prize_budget_days.cards_awarded + 1,
            value_awarded_usd = prize_budget_days.value_awarded_usd + $3::numeric,
            ceiling_usd = COALESCE(prize_budget_days.ceiling_usd, $4::numeric),
            updated_at = now()
      WHERE prize_budget_days.cards_awarded + 1 <= $1::int
        AND prize_budget_days.value_awarded_usd + $3::numeric
              <= COALESCE($2::numeric, prize_budget_days.ceiling_usd, $4::numeric) * $5::int / 24
     RETURNING cards_awarded`,
    [basis.maxCards, basis.fixedUsd, valueUsd, basis.ceilingUsd, basis.hours],
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
