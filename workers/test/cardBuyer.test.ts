import { describe, expect, it } from 'vitest';
import { ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { createHash } from 'node:crypto';
import {
  classify, planBuys, runBuyTick, type BuyerGateway, type BuyerStore, type BuyPolicy, type Candidate, type Listing,
  type PendingPurchase, type PurchaseState,
} from '../src/cardBuyer.js';
import { checkBuyInstructions } from '../src/buyerGateway.js';
import { toListing } from '../src/magicEden.js';
import type { Tier } from '../src/topUp.js';
import { silentLog } from './fakes.js';

const SOL = 1_000_000_000n;
const policy: BuyPolicy = {
  targets: { common: 2, uncommon: 1, rare: 0, grail: 0 },
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

describe('planBuys', () => {
  it('picks the cheapest per tier, skips owned mints, and respects the per-tick cap', () => {
    const ls = [listing('c3', 0.3, 40), listing('c1', 0.1, 20), listing('c2', 0.2, 30), listing('u1', 0.5, 60)];
    expect(planBuys(none, ls, new Set(['c1']), policy, SOL_USD).map((c) => c.listing.mint)).toEqual(['c2', 'c3', 'u1']);
    expect(planBuys(none, ls, new Set(), { ...policy, maxCardsPerTick: 1 }, SOL_USD).map((c) => c.listing.mint)).toEqual(['c1']);
    expect(planBuys({ ...none, common: 2, uncommon: 1 }, ls, new Set(), policy, SOL_USD)).toEqual([]);
  });
});

class MemStore implements BuyerStore {
  rows: Array<PendingPurchase & { status: string; c: Candidate }> = [];
  available = { ...none };
  async pending() { return this.rows.filter((r) => r.status === 'sending'); }
  async availableByTier() { return { ...this.available }; }
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
    this.available[r.c.tier]++;
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

function setup(listings: Listing[]) {
  const store = new MemStore();
  const gateway = new FakeGateway();
  return { store, gateway, deps: { store, gateway, market: { listings: async () => listings }, policy, gasReserveLamports: SOL / 20n, log: silentLog } };
}

describe('buy tick', () => {
  it('pulls budget from the vault, buys what is short and records it', async () => {
    const s = setup([listing('c1', 0.1, 20), listing('c2', 0.2, 30), listing('u1', 0.5, 60)]);
    const r = await runBuyTick(s.deps);
    expect(r).toMatchObject({ kind: 'bought', cards: 3 });
    expect(s.store.rows.map((x) => x.status)).toEqual(['bought', 'bought', 'bought']);
    expect(s.gateway.pulls.length).toBeGreaterThan(0);
    expect(await runBuyTick(s.deps)).toMatchObject({ kind: 'idle', reason: 'stocked' });
  });

  it('stops at the weekly budget', async () => {
    const s = setup([listing('c1', 0.1, 20), listing('c2', 0.2, 30)]);
    s.gateway.limit = 0n;
    expect(await runBuyTick(s.deps)).toMatchObject({ kind: 'bought', cards: 0, stopped: 'budget' });
    expect(s.store.rows).toEqual([]);
  });

  it('skips a listing whose transaction fails the checks and buys the next one', async () => {
    const s = setup([listing('c1', 0.1, 20), listing('c2', 0.2, 30), listing('c3', 0.3, 40)]);
    s.gateway.refuse.add('c1');
    await runBuyTick(s.deps);
    expect(s.store.rows.map((x) => x.mint)).toEqual(['c2']);
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
