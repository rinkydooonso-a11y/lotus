/**
 * Adds money to the card fund by hand: the seed, or a fee claim the claimer couldn't price.
 *
 *   cd workers && DATABASE_URL=... npx tsx scripts/fund-entry.ts seed 750 "launch seed"
 *   cd workers && DATABASE_URL=... npx tsx scripts/fund-entry.ts adjust -40 "gas and swap costs"
 *
 * kind is seed (money in, once), fee_share (the card share of a claim, in USD) or adjust (either way).
 * The prize pool the game pays from is this fund's cash plus the cost of the cards in stock, so the
 * seed is what makes day one's prizes possible. Entries are never edited; fix a mistake with an
 * adjust entry of the opposite sign.
 */
import pg from 'pg';
import { pgSsl } from '@lotus/server';

const [kind, amount, ...noteParts] = process.argv.slice(2);
const usd = Number(amount);
if (!['seed', 'fee_share', 'adjust'].includes(kind ?? '') || !Number.isFinite(usd) || usd === 0) {
  throw new Error('usage: fund-entry.ts <seed|fee_share|adjust> <usd> [note]');
}
if (kind !== 'adjust' && usd < 0) throw new Error(`${kind} must be positive; use adjust for a correction`);
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');

const db = new pg.Pool({ connectionString: url, ssl: pgSsl(url) });
try {
  await db.query(`INSERT INTO prize_fund_entries (kind, usd, note) VALUES ($1, $2, $3)`, [kind, usd.toFixed(2), noteParts.join(' ') || null]);
  const { rows } = await db.query(
    `SELECT (SELECT COALESCE(sum(usd), 0) FROM prize_fund_entries)::text AS cash,
            (SELECT COALESCE(sum(COALESCE(cost_usd, value_usd)), 0) FROM inventory_items WHERE status = 'available')::text AS stock`,
  );
  const cash = Number(rows[0].cash);
  const stock = Number(rows[0].stock);
  console.log(`added ${kind} $${usd.toFixed(2)}. Card fund cash $${cash.toFixed(2)}, stock $${stock.toFixed(2)}, pool $${(Math.max(0, cash) + stock).toFixed(2)}`);
} finally {
  await db.end();
}
