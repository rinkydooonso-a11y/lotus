import { describe, expect, it } from 'vitest';
import { ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { createHash } from 'node:crypto';
import {
  classify, planBuys, runBuyTick, shortByTier, sizing, type BuyerGateway, type BuyerStore, type BuyPolicy, type Candidate,
  type FundState, type Listing, type PendingPurchase, type PurchaseState,
} from '../src/cardBuyer.js';
import { checkBuyInstructions, checkNoHotAssetsWritable } from '../src/buyerGateway.js';
import { AccountLayout } from '@solana/spl-token';
import { loadConfig } from '../src/config.js';
import { toListing } from '../src/magicEden.js';
import type { Tier } from '../src/topUp.js';
import { silentLog } from './fakes.js';

const SOL = 1_000_000_000n;
const policy: BuyPolicy = {
  tierMix: { common: 0.45, uncommon: 0.3, rare: 0.2, grail: 0.05 },
  payoutDays: 14,
  stockDays: 3,
  tierMinUsd: { common: 0, uncommon: 50, rare: 150, grail: 500 },
  requiredTraits: { Type: 'Card' },
  valueTrait: 'Insured Value',
  gradeTrait: 'Grade',
  maxPriceToValue: 1,
  maxLamportsPerCard: 2n * SOL,
  maxCardsPerTick: 5,
  maxOverheadBps: 800,
};
const SOL_USD = 100;
const listing = (mint: string, sol: number, value: number, type = 'Card'): Listing => ({
  mint, seller: 'seller', priceLamports: BigInt(Math.round(sol * 1e9)), name: mint, image: null,
  attributes: { Type: type, 'Insured Value': String(value), Grade: '9' }, raw: {},
});
const none: Record<Tier, number> = { common: 0, uncommon: 0, rare: 0, grail: 0 };

describe('classify', () => {
  it('tiers by insured value and keeps the grade', () => {
    expect(classify(listing('a', 0.2, 30), policy, SOL_USD)).toMatchObject({ tier: 'common', valueUsd: 30, grade: '9' });
    expect(classify(listing('b', 0.5, 60), policy, SOL_USD)?.tier).toBe('uncommon');
  });

  it('refuses merch, missing values, overpriced and over-cap listings', () => {
    expect(classify(listing('m', 0.07, 25, 'Merch'), policy, SOL_USD)).toBeNull();
    expect(classify({ ...listing('n', 0.1, 0), attributes: { Type: 'Card' } }, policy, SOL_USD)).toBeNull();
    expect(classify(listing('o', 0.5, 40), policy, SOL_USD)).toBeNull(); // $50 for a $40 card
    expect(classify(listing('p', 3, 1000), policy, SOL_USD)).toBeNull(); // over the 2 SOL per-card cap
  });
});

describe('category filter', () => {
  const pokemonOnly = { ...policy, requiredTraits: { Type: 'Card', Category: 'Pokemon' }, gradeTrait: 'The Grade' };
  const card = (category: string) => ({ ...listing('c', 0.2, 30), attributes: { Type: 'Card', Category: category, 'Insured Value': '30', 'The Grade': 'GEM MINT 10' } });

  it('buys Pokemon and refuses other games', () => {
    expect(classify(card('Pokemon'), pokemonOnly, SOL_USD)).toMatchObject({ tier: 'common', grade: 'GEM MINT 10' });
    expect(classify(card('One Piece'), pokemonOnly, SOL_USD)).toBeNull();
    expect(classify(card('Baseball'), pokemonOnly, SOL_USD)).toBeNull();
    expect(classify({ ...card('Pokemon'), attributes: { Type: 'Card', 'Insured Value': '30' } }, pokemonOnly, SOL_USD)).toBeNull(); // no Category trait at all
  });
});

describe('sizing', () => {
  it('scales everything with the pool and caps a card at one day of release', () => {
    const z = { common: 0, uncommon: 0, rare: 0, grail: 0 };
    const big = sizing({ cashUsd: 1400, stockUsd: z }, policy);
    expect(big).toMatchObject({ poolUsd: 1400, dayReleaseUsd: 100, capUsd: 100 });
    expect(big.targetUsd.common).toBeCloseTo(135); // 3 days of 100, 45%
    expect(big.targetUsd.grail).toBeCloseTo(15);
    // Stock counts toward the pool, so buying a card with cash doesn't change the sizing.
    expect(sizing({ cashUsd: 1000, stockUsd: { ...z, common: 400 } }, policy).poolUsd).toBe(1400);
    // The hard cap still bites on a huge pool; a pool of nothing sizes to nothing.
    expect(sizing({ cashUsd: 1_000_000, stockUsd: z }, { ...policy, maxPriceUsd: 1000 }).capUsd).toBe(1000);
    expect(sizing({ cashUsd: -5, stockUsd: z }, policy)).toMatchObject({ poolUsd: 0, capUsd: 0 });
  });

  it('measures how short each tier is', () => {
    const fund: FundState = { cashUsd: 1400, stockUsd: { common: 200, uncommon: 10, rare: 0, grail: 0 } };
    const short = shortByTier(fund, sizing(fund, policy));
    expect(short.common).toBe(0);
    expect(short.uncommon).toBeGreaterThan(0);
    expect(short.rare).toBeGreaterThan(0);
  });
});

describe('planBuys', () => {
  const need = (o: Partial<Record<Tier, number>>) => ({ ...none, ...o });

  it('picks the cheapest per tier, skips owned mints, and respects the per-tick cap', () => {
    const ls = [listing('c3', 0.3, 40), listing('c1', 0.1, 20), listing('c2', 0.2, 30), listing('u1', 0.5, 60)];
    const mints = (p: ReturnType<typeof planBuys>) => p.picks.map((c) => c.listing.mint);
    expect(mints(planBuys(need({ common: 50, uncommon: 50 }), ls, new Set(['c1']), policy, SOL_USD, 1000))).toEqual(['c2', 'c3', 'u1']);
    expect(mints(planBuys(need({ common: 50 }), ls, new Set(), { ...policy, maxCardsPerTick: 1 }, SOL_USD, 1000))).toEqual(['c1']);
    expect(planBuys(none, ls, new Set(), policy, SOL_USD, 1000).picks).toEqual([]);
  });

  it('passes a tier it cannot use down to the tier below', () => {
    // Nothing rare or grail on the market: their dollars move down to uncommon, then common.
    const ls = [listing('u1', 0.5, 60), listing('c1', 0.1, 20)];
    const plan = planBuys(need({ grail: 20, rare: 30, uncommon: 10, common: 5 }), ls, new Set(), policy, SOL_USD, 1000);
    expect(plan.want.common).toBe(5);
    expect(plan.want.grail).toBe(0);
    expect(plan.want.rare).toBe(0);
    // u1 costs $50, within 1.5 x the $60 need, so uncommon keeps the dollars.
    expect(plan.want.uncommon).toBe(60);
    expect(plan.picks.map((c) => c.listing.mint)).toEqual(['c1', 'u1']);
  });

  it('gives an unaffordable tier to a cheaper one when its cheapest card would overshoot too far', () => {
    const ls = [listing('u1', 0.5, 60), listing('c1', 0.1, 20)];
    const plan = planBuys(need({ uncommon: 10, common: 5 }), ls, new Set(), policy, SOL_USD, 1000);
    expect(plan.want).toEqual({ grail: 0, rare: 0, uncommon: 0, common: 15 });
    expect(plan.picks.map((c) => c.listing.mint)).toEqual(['c1']);
  });

  it('never plans more than the cash it has', () => {
    const ls = [listing('c1', 0.1, 20), listing('c2', 0.2, 30), listing('c3', 0.3, 40)];
    const plan = planBuys(need({ common: 100 }), ls, new Set(), policy, SOL_USD, 25);
    expect(plan.picks.map((c) => c.listing.mint)).toEqual(['c1']);
  });
});

class MemStore implements BuyerStore {
  rows: Array<PendingPurchase & { status: string; c: Candidate }> = [];
  cash = 1000;
  stock = { ...none };
  async pending() { return this.rows.filter((r) => r.status === 'sending'); }
  async fund() { return { cashUsd: this.cash, stockUsd: { ...this.stock } }; }
  async spentSince() {
    return this.rows.filter((r) => r.status !== 'failed').reduce((a, r) => a + r.c.listing.priceLamports, 0n);
  }
  async ownedMints() { return new Set(this.rows.filter((r) => r.status !== 'failed').map((r) => r.mint)); }
  async insertPending(c: Candidate, signature: string) {
    if (this.rows.some((r) => r.mint === c.listing.mint && r.status !== 'failed')) throw new Error('duplicate');
    const id = String(this.rows.length + 1);
    this.rows.push({ id, mint: c.listing.mint, signature, createdAt: new Date(), status: 'sending', c });
    return id;
  }
  async markBought(id: string) {
    const r = this.rows.find((x) => x.id === id)!;
    if (r.status !== 'sending') return;
    r.status = 'bought';
    this.stock[r.c.tier] += r.c.priceUsd;
    this.cash -= r.c.priceUsd;
  }
  async markFailed(id: string) { this.rows.find((x) => x.id === id)!.status = 'failed'; }
}

class FakeGateway implements BuyerGateway {
  hotWallet = 'HOT';
  wallet = 0n;
  limit = 5n * SOL;
  owned = new Set<string>();
  states = new Map<string, PurchaseState>();
  pulls: bigint[] = [];
  refuse = new Set<string>();
  sendFails = false;
  /** On-chain traits that differ from the marketplace's, or 'reject' for a card that fails the check. */
  chainTraits = new Map<string, Record<string, string> | 'reject'>();
  async verifyCard(l: Listing) {
    const t = this.chainTraits.get(l.mint);
    if (t === 'reject') throw new Error('not in the Collector Crypt collection');
    return t ? { ...l, attributes: t } : l;
  }
  async solUsd() { return SOL_USD; }
  async budget() { return { walletLamports: this.wallet, limitRemainingLamports: this.limit }; }
  async pullFromVault(l: bigint) { this.pulls.push(l); this.limit -= l; this.wallet += l; return 'pull'; }
  async prepareBuy(l: Listing, maxSpend: bigint) {
    if (this.refuse.has(l.mint)) throw new Error('failed checks');
    const signature = `sig-${l.mint}`;
    return {
      signature,
      send: async () => {
        if (this.sendFails) throw new Error('timeout');
        expect(l.priceLamports).toBeLessThanOrEqual(maxSpend);
        this.wallet -= l.priceLamports;
        this.owned.add(l.mint);
        this.states.set(signature, 'landed');
      },
    };
  }
  async purchaseState(sig: string) { return this.states.get(sig) ?? 'pending'; }
  async ownsCard(mint: string) { return this.owned.has(mint); }
}

function setup(listings: Listing[], cash = 1000) {
  const store = new MemStore();
  store.cash = cash;
  const gateway = new FakeGateway();
  return { store, gateway, deps: { store, gateway, market: { listings: async () => listings }, policy, gasReserveLamports: SOL / 20n, weeklyMaxLamports: 20n * SOL, log: silentLog } };
}

describe('buy tick', () => {
  it('pulls budget from the vault, buys what is short and records it', async () => {
    const s = setup([listing('c1', 0.1, 20), listing('c2', 0.2, 30), listing('u1', 0.5, 60)]);
    const r = await runBuyTick(s.deps);
    expect(r).toMatchObject({ kind: 'bought', cards: 3 });
    expect(s.store.rows.map((x) => x.status)).toEqual(['bought', 'bought', 'bought']);
    expect(s.gateway.pulls.length).toBeGreaterThan(0);
    // $80 of the fund's $1000 went on cards, and the cards count in the pool, so the sizing is unchanged.
    expect(s.store.cash).toBeCloseTo(920);
    expect(s.store.stock.common + s.store.stock.uncommon).toBeCloseTo(80);
  });

  it('buys nothing when the card fund has no cash, and waits for fees', async () => {
    // All the stock is commons and there is no cash, so the other tiers are short with nothing to spend.
    const s = setup([listing('c1', 0.1, 20)], 0);
    s.store.stock.common = 300;
    expect(await runBuyTick(s.deps)).toEqual({ kind: 'idle', reason: 'fund_empty' });
    expect(s.store.rows).toEqual([]);
  });

  it('is stocked once the stock has reached its share of the pool', async () => {
    const s = setup([listing('c1', 0.1, 20)], 0);
    s.store.stock = { common: 140, uncommon: 100, rare: 70, grail: 20 }; // pool 330: targets 3 days of 23.6
    expect(await runBuyTick(s.deps)).toEqual({ kind: 'idle', reason: 'stocked' });
  });

  it('never pays more than one day of release for a card', async () => {
    // Pool $100: a day's release is $7.14, so a $10 card is out of reach.
    const s = setup([listing('c1', 0.1, 20)], 100);
    expect(await runBuyTick(s.deps)).toEqual({ kind: 'idle', reason: 'no_matching_listings' });
  });

  it('stops buying once the fund cash is spent', async () => {
    // Pool $500: a card may cost up to $35. Only $25 of it is cash, the rest is stock in another tier,
    // so one $20 card is affordable and a second is not.
    const s = setup([listing('c1', 0.2, 30), listing('c2', 0.2, 30)], 25);
    s.store.stock = { common: 0, uncommon: 475, rare: 0, grail: 0 };
    const r = await runBuyTick(s.deps);
    expect(r).toMatchObject({ kind: 'bought', cards: 1 });
    expect(s.store.rows.map((x) => x.mint)).toEqual(['c1']);
    expect(s.store.cash).toBeCloseTo(5);
  });

  it('stops at the weekly budget', async () => {
    const s = setup([listing('c1', 0.1, 20), listing('c2', 0.2, 30)]);
    s.gateway.limit = 0n;
    expect(await runBuyTick(s.deps)).toMatchObject({ kind: 'bought', cards: 0, stopped: 'budget' });
    expect(s.store.rows).toEqual([]);
  });

  it('skips a listing whose transaction fails the checks and buys the next one instead', async () => {
    const s = setup([listing('c1', 0.1, 20), listing('c2', 0.2, 30), listing('c3', 0.3, 40), listing('c4', 0.4, 45)], 500);
    s.gateway.refuse.add('c1');
    await runBuyTick(s.deps);
    expect(s.store.rows.map((x) => x.mint)).toEqual(['c2', 'c3']);
  });

  it('trusts on-chain traits over the marketplace and skips cards that fail the chain check', async () => {
    const s = setup([listing('fake', 0.1, 20), listing('merch', 0.15, 20), listing('c3', 0.3, 40), listing('c4', 0.35, 40)], 500);
    s.gateway.chainTraits.set('fake', 'reject');
    s.gateway.chainTraits.set('merch', { Type: 'Merch', 'Insured Value': '20' });
    await runBuyTick(s.deps);
    expect(s.store.rows.map((x) => x.mint)).toEqual(['c3', 'c4']);
  });

  it('stops at the off-chain weekly backstop even with SOL in the wallet', async () => {
    const s = setup([listing('c1', 0.1, 20), listing('c2', 0.2, 30)]);
    s.gateway.wallet = 10n * SOL;
    await runBuyTick({ ...s.deps, weeklyMaxLamports: SOL / 5n });
    expect(s.store.rows.map((x) => x.mint)).toEqual(['c1']);
  });

  it('leaves an unknown send in flight and buys nothing more until it settles', async () => {
    const s = setup([listing('c1', 0.1, 20), listing('c2', 0.2, 30)]);
    s.gateway.sendFails = true;
    expect(await runBuyTick(s.deps)).toMatchObject({ stopped: 'send_error' });
    expect(await runBuyTick(s.deps)).toMatchObject({ kind: 'waiting', pending: 1 });

    // It actually landed: ownership settles it as bought.
    s.gateway.owned.add('c1');
    s.gateway.states.set('sig-c1', 'landed');
    s.gateway.sendFails = false;
    await runBuyTick(s.deps);
    expect(s.store.rows.find((x) => x.mint === 'c1')!.status).toBe('bought');
  });

  it('marks an expired purchase failed so its card can be tried again', async () => {
    const s = setup([listing('c1', 0.1, 20)]);
    s.gateway.sendFails = true;
    await runBuyTick(s.deps);
    s.gateway.states.set('sig-c1', 'expired');
    s.gateway.sendFails = false;
    await runBuyTick(s.deps);
    expect(s.store.rows.map((x) => x.status)).toEqual(['failed', 'bought']);
  });
});

const disc = (name: string) => createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
const ix = (program: string, data: Buffer) => new TransactionInstruction({ programId: new PublicKey(program), keys: [], data });
const M2 = 'M2mx93ekt1fmXSVkTrUL9xVFHkmME8HTUi5Cyc5aF7K';

describe('checkBuyInstructions', () => {
  const a = Keypair.generate().publicKey;
  it('allows compute budget, a SOL transfer and marketplace buy instructions', () => {
    expect(() => checkBuyInstructions([
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1 }),
      SystemProgram.transfer({ fromPubkey: a, toPubkey: a, lamports: 1 }),
      ix(M2, disc('buy_v2')),
      ix(M2, disc('mip1_execute_sale_v2')),
    ])).not.toThrow();
  });

  it('refuses a listing instruction, an account assign, and unknown programs', () => {
    expect(() => checkBuyInstructions([ix(M2, disc('mip1_sell'))])).toThrow(/don't allow/);
    expect(() => checkBuyInstructions([SystemProgram.assign({ accountPubkey: a, programId: a })])).toThrow(/system/);
    expect(() => checkBuyInstructions([ix('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', Buffer.from([3]))])).toThrow(/program/);
  });
});

describe('toListing', () => {
  it('reads Magic Eden listings and rounds the price to lamports', () => {
    const l = toListing({
      tokenMint: 'mint', tokenAddress: 'ata', seller: 's', price: 0.071464613,
      token: { name: 'Charizard', attributes: [{ trait_type: 'Insured Value', value: 25 }, { trait_type: 'Type', value: 'Card' }] },
    });
    expect(l).toMatchObject({ priceLamports: 71_464_613n, name: 'Charizard', attributes: { 'Insured Value': '25', Type: 'Card' } });
    expect(toListing({ tokenMint: 'm', tokenAddress: 'a', seller: 's', price: 0 })).toBeNull();
  });
});

describe('checkNoHotAssetsWritable', () => {
  const hot = Keypair.generate().publicKey;
  const tokenAccount = (owner: PublicKey) => {
    const data = Buffer.alloc(AccountLayout.span);
    AccountLayout.encode({
      mint: Keypair.generate().publicKey, owner, amount: 1n, delegateOption: 0, delegate: PublicKey.default, state: 1,
      isNativeOption: 0, isNative: 0n, delegatedAmount: 0n, closeAuthorityOption: 0, closeAuthority: PublicKey.default,
    }, data);
    return data;
  };
  const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
  const CORE = 'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d';
  it('allows the new card account and accounts the hot wallet does not own', () => {
    expect(() => checkNoHotAssetsWritable([
      { key: 'card', owner: TOKEN, data: tokenAccount(hot) },
      { key: 'seller', owner: TOKEN, data: tokenAccount(Keypair.generate().publicKey) },
      { key: 'new', owner: null, data: null },
    ], hot.toBase58(), 'card')).not.toThrow();
  });
  it('refuses a writable prize card the hot wallet already holds', () => {
    expect(() => checkNoHotAssetsWritable([{ key: 'prize', owner: TOKEN, data: tokenAccount(hot) }], hot.toBase58(), 'card')).toThrow(/token account/);
    const core = Buffer.concat([Buffer.from([1]), hot.toBuffer(), Buffer.alloc(40)]);
    expect(() => checkNoHotAssetsWritable([{ key: 'asset', owner: CORE, data: core }], hot.toBase58(), 'card')).toThrow(/Core asset/);
  });
});

describe('buyer config', () => {
  const A = Keypair.generate().publicKey.toBase58();
  const base = { DATABASE_URL: 'x', SOLANA_RPC_URL: 'https://rpc.example', HOT_WALLET_SECRET_KEY: 'k' };
  const buyer = { ...base, BUYER_SPENDING_LIMIT: A, SQUADS_MULTISIG_ADDRESS: A, SQUADS_PROPOSER_SECRET_KEY: 'k', BUY_COLLECTION_ADDRESS: A, BUY_UPDATE_AUTHORITY: A };
  it('refuses the buyer without a trait filter or a pinned collection', () => {
    expect(() => loadConfig(buyer)).toThrow(/BUY_REQUIRED_TRAITS/);
    expect(() => loadConfig({ ...buyer, BUY_REQUIRED_TRAITS: 'Type=Card', BUY_COLLECTION_ADDRESS: '' })).toThrow();
    expect(loadConfig({ ...buyer, BUY_REQUIRED_TRAITS: 'Type=Card' }).BUY_REQUIRED_TRAITS).toEqual({ Type: 'Card' });
  });
  it('needs the phrase for a single-signer minimum', () => {
    expect(() => loadConfig({ ...base, SQUADS_MIN_THRESHOLD: '1' })).toThrow(/SQUADS_ALLOW_SINGLE_SIGNER/);
    expect(loadConfig({ ...base, SQUADS_MIN_THRESHOLD: '1', SQUADS_ALLOW_SINGLE_SIGNER: 'yes-one-wallet-controls-the-vault' }).SQUADS_MIN_THRESHOLD).toBe(1);
  });
});
