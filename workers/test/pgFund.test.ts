import pg from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PgBuyerStore, PgClaimLog } from '../src/pg.js';
import type { Candidate } from '../src/cardBuyer.js';

// Needs the migrated test database; skipped when there is none.
const url = process.env.DATABASE_URL;
const db = url ? new pg.Pool({ connectionString: url }) : null;

describe.skipIf(!db)('card fund in Postgres', () => {
  beforeEach(async () => {
    await db!.query('TRUNCATE card_purchases, inventory_items, prize_fund_entries, treasury_events CASCADE');
  });
  afterAll(async () => { await db?.end(); });

  const candidate = (mint: string, usd: number, valueUsd: number): Candidate => ({
    listing: {
      mint, seller: 's', priceLamports: BigInt(Math.round((usd / 100) * 1e9)), name: mint, image: null,
      attributes: {}, raw: {},
    },
    tier: 'common', valueUsd, priceUsd: usd, grade: null,
  });

  it('adds the card share of a claim once, however many times it is recorded', async () => {
    const log = new PgClaimLog(db!);
    const claim = { signature: 'sigA', amount: '2', asset: 'SOL', note: 'n', usdValue: '300.00', fundUsd: '210.00' };
    await log.recordClaim(claim);
    await log.recordClaim(claim); // a retry after a crash
    const { rows } = await db!.query(`SELECT usd::text, kind FROM prize_fund_entries`);
    expect(rows).toEqual([{ usd: '210.00', kind: 'fee_share' }]);
  });

  it('charges a purchase to the fund and counts the card in stock at cost', async () => {
    await db!.query(`INSERT INTO prize_fund_entries (kind, usd) VALUES ('seed', 500)`);
    const store = new PgBuyerStore(db!);
    const id = await store.insertPending(candidate('mintA', 20, 45), 'sigBuy', 100);
    await store.markBought(id);
    await store.markBought(id); // a repeated settle changes nothing
    const fund = await store.fund();
    expect(fund.cashUsd).toBeCloseTo(480);
    // Counted at the $20 it cost, not the $45 it is insured for.
    expect(fund.stockUsd.common).toBeCloseTo(20);
  });

  it('counts only available cards in the stock', async () => {
    const store = new PgBuyerStore(db!);
    const id = await store.insertPending(candidate('mintB', 10, 20), 'sigB', 100);
    await store.markBought(id);
    expect((await store.fund()).stockUsd.common).toBeCloseTo(10);
    // A card that has been taken out of play is no longer stock.
    await db!.query(`UPDATE inventory_items SET status = 'removed' WHERE nft_mint = 'mintB'`);
    expect((await store.fund()).stockUsd.common).toBe(0);
  });
});
