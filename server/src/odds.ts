import type { Pool, PoolClient } from 'pg';
import { GAME } from './config';
import { getPool, withTx } from './db';
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

/** Tiers with no available cards get weight 0; shards absorbs the rest so the total stays GAME.oddsTotal. */
export function effectiveWeights(base: Weights, available: Record<CardTier, number>): Weights {
  const w: Weights = { ...base };
  let cards = 0;
  for (const t of CARD_TIERS) {
    if (available[t] <= 0) w[t] = 0;
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

export async function getPublicOdds(kind: CrateKind = 'standard', db: Pool = getPool()): Promise<OddsView[]> {
  const [base, avail] = await Promise.all([loadOdds(kind, db), availableByTier(db)]);
  const eff = effectiveWeights(base, avail);
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
