import { TIERS, type Tier } from './topUp.js';
import type { Logger } from './types.js';

/**
 * Card buyer: keeps the hot wallet stocked by buying Collector Crypt cards on the open market.
 *
 * Money comes from the Squads vault through an on-chain spending limit that the signers approve
 * once: the hot wallet may pull at most N SOL per week, and only to itself. The program enforces
 * that cap, so a leaked hot-wallet key loses at most one week's budget, never the vault.
 *
 * Nothing here is a fixed dollar number: everything scales with the prize pool (the card fund's cash
 * plus the cost of the cards in stock). One day's release is pool / payoutDays, the stock to hold is
 * stockDays of that split across tiers by `tierMix`, and no card may cost more than one day's
 * release. A tier whose cards are all too dear passes its share down to the tier below. It only
 * ever spends fund cash, which comes from the seed and the card share of fee claims.
 *
 * Each tick it compares the stock value per tier with its target, picks the cheapest listings
 * that pass the filters (required traits, insured value, price caps), and buys them one at a
 * time. Every marketplace-built transaction is simulated and checked before it is signed. A
 * purchase row is written before sending, so a crash leaves a 'sending' row the next tick
 * reconciles against chain state; nothing new is bought while one is unresolved.
 */

export interface Listing {
  mint: string;
  seller: string;
  priceLamports: bigint;
  /** Exact price in USDC base units (6 decimals), for marketplaces that price in USDC. */
  priceUsdc?: bigint;
  name: string;
  image: string | null;
  attributes: Record<string, string>;
  /** Marketplace-specific fields the buy instruction needs (auction house, token account, expiry). */
  raw: Record<string, unknown>;
}

export interface Candidate {
  listing: Listing;
  tier: Tier;
  valueUsd: number;
  priceUsd: number;
  grade: string | null;
}

export interface BuyPolicy {
  /** Share of the stock value held in each tier (fractions that sum to 1). */
  tierMix: Record<Tier, number>;
  /** The pool pays out over this many days; one day's release is pool / payoutDays. */
  payoutDays: number;
  /** Stock held in the hot wallet, in days of release. */
  stockDays: number;
  /** Lowest insured value (USD) for each tier; a card takes the highest tier it reaches. */
  tierMinUsd: Record<Tier, number>;
  /** Every one of these traits must match exactly (e.g. Type=Card). */
  requiredTraits: Record<string, string>;
  /** Trait holding the card's insured value in USD. */
  valueTrait: string;
  gradeTrait: string | null;
  /** Never pay more than this fraction of the insured value. */
  maxPriceToValue: number;
  /** Hard per-card cap in lamports, whatever the price feed says. */
  maxLamportsPerCard: bigint;
  maxCardsPerTick: number;
  /** Fees and royalties allowed on top of the listing price, in basis points. */
  maxOverheadBps: number;
  /** Hard per-card cap in USD. The tick also never pays more than one day's release for a card. */
  maxPriceUsd?: number;
}

export interface FundState {
  /** Card fund cash, in USD. */
  cashUsd: number;
  /** Cards in stock per tier, counted at what they cost. */
  stockUsd: Record<Tier, number>;
}

export interface Sizing {
  poolUsd: number;
  /** What the game may give away in a day. */
  dayReleaseUsd: number;
  /** Most one card may cost. */
  capUsd: number;
  targetUsd: Record<Tier, number>;
}

/** Pure: how big everything is for a given fund. */
export function sizing(fund: FundState, policy: BuyPolicy): Sizing {
  const stock = TIERS.reduce((a, t) => a + (fund.stockUsd[t] ?? 0), 0);
  const poolUsd = Math.max(0, fund.cashUsd) + stock;
  const dayReleaseUsd = poolUsd / Math.max(1, policy.payoutDays);
  const stockTarget = dayReleaseUsd * policy.stockDays;
  const targetUsd = { common: 0, uncommon: 0, rare: 0, grail: 0 };
  for (const t of TIERS) targetUsd[t] = stockTarget * (policy.tierMix[t] ?? 0);
  return {
    poolUsd,
    dayReleaseUsd,
    capUsd: Math.min(dayReleaseUsd, policy.maxPriceUsd ?? Infinity),
    targetUsd,
  };
}

export function parseUsd(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const n = Number(raw.replace(/[$,\s]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Pure: whether a listing is a card we would buy, and as which tier. */
export function classify(listing: Listing, policy: BuyPolicy, solUsd: number): Candidate | null {
  for (const [k, v] of Object.entries(policy.requiredTraits)) {
    if ((listing.attributes[k] ?? '').toLowerCase() !== v.toLowerCase()) return null;
  }
  const valueUsd = parseUsd(listing.attributes[policy.valueTrait]);
  if (valueUsd === null) return null;
  if (listing.priceLamports <= 0n || listing.priceLamports > policy.maxLamportsPerCard) return null;
  const priceUsd = listing.priceUsdc !== undefined ? Number(listing.priceUsdc) / 1e6 : (Number(listing.priceLamports) / 1e9) * solUsd;
  if (policy.maxPriceUsd !== undefined && priceUsd > policy.maxPriceUsd) return null;
  if (priceUsd > valueUsd * policy.maxPriceToValue) return null;
  let tier: Tier | null = null;
  for (const t of TIERS) if (valueUsd >= policy.tierMinUsd[t]) tier = t;
  if (!tier) return null;
  const grade = policy.gradeTrait ? listing.attributes[policy.gradeTrait] ?? null : null;
  return { listing, tier, valueUsd, priceUsd, grade };
}

/** Pure: how many dollars of stock each tier is short of its target. */
export function shortByTier(fund: FundState, size: Sizing): Record<Tier, number> {
  const out = { common: 0, uncommon: 0, rare: 0, grail: 0 };
  for (const t of TIERS) out[t] = Math.max(0, size.targetUsd[t] - (fund.stockUsd[t] ?? 0));
  return out;
}

export interface BuyPlan {
  /** Candidates in the order to try: cheaper tiers first, cheapest first within a tier, spares last in their tier. */
  picks: Candidate[];
  /** Dollars of stock still wanted per tier, after a tier with nothing to buy has passed its share down. */
  want: Record<Tier, number>;
}

/**
 * Pure: what to buy. Tiers are settled from the top down: a tier with no listing it can afford (or
 * whose cheapest card would overshoot its need by more than half) passes its need to the tier below,
 * so a small pool that can't buy a rare puts that money into more commons. The plan never plans more
 * than `cashUsd` of purchases, and never exceeds `maxCardsPerTick`.
 */
export function planBuys(
  short: Record<Tier, number>,
  listings: Listing[],
  owned: Set<string>,
  policy: BuyPolicy,
  solUsd: number,
  cashUsd: number,
  /** Extra candidates per tier beyond the need, as replacements. */
  spare = 0,
): BuyPlan {
  const byTier: Record<Tier, Candidate[]> = { common: [], uncommon: [], rare: [], grail: [] };
  for (const l of listings) {
    if (owned.has(l.mint)) continue;
    const c = classify(l, policy, solUsd);
    if (c) byTier[c.tier].push(c);
  }
  for (const t of TIERS) byTier[t].sort((a, b) => a.priceUsd - b.priceUsd);

  // Pass 1: top down, a tier that can't use its need hands it to the tier below.
  const want = { ...short };
  for (let i = TIERS.length - 1; i > 0; i--) {
    const t = TIERS[i]!;
    const cheapest = byTier[t][0];
    if (want[t] > 0 && (!cheapest || cheapest.priceUsd > want[t] * 1.5)) {
      want[TIERS[i - 1]!] += want[t];
      want[t] = 0;
    }
  }

  // Pass 2: bottom up so scarce cash goes to the everyday tiers first.
  const picks: Candidate[] = [];
  let cash = cashUsd;
  for (const t of TIERS) {
    let need = want[t];
    let extra = need > 0 ? spare : 0;
    for (const c of byTier[t]) {
      if (picks.length >= policy.maxCardsPerTick) break;
      if (need > 0) {
        if (c.priceUsd > cash) continue;
        picks.push(c);
        need -= c.priceUsd;
        cash -= c.priceUsd;
      } else if (extra > 0) {
        picks.push(c);
        extra--;
      } else break;
    }
  }
  return { picks, want };
}

export interface PendingPurchase {
  id: string;
  mint: string;
  signature: string;
  createdAt: Date;
}

export interface BuyerStore {
  pending(): Promise<PendingPurchase[]>;
  /** The card fund's cash and the cost of the cards in stock per tier. */
  fund(): Promise<FundState>;
  /** Lamports spent on purchases (sending or bought) since the given time. */
  spentSince(since: Date): Promise<bigint>;
  /** Mints already in inventory or in a sending/bought purchase. */
  ownedMints(): Promise<Set<string>>;
  /** Inserts a 'sending' purchase. Throws if the mint already has a live purchase. */
  insertPending(c: Candidate, signature: string, solUsd: number): Promise<string>;
  /** Marks it bought, adds the card as 'available' in the hot wallet, and logs a purchase event. */
  markBought(id: string): Promise<void>;
  markFailed(id: string, note: string): Promise<void>;
}

export type PurchaseState = 'landed' | 'failed' | 'pending' | 'expired';

export interface BuyerGateway {
  hotWallet: string;
  solUsd(): Promise<number>;
  /** Lamports the hot wallet can spend now, plus what the spending limit still allows this period. */
  budget(): Promise<{ walletLamports: bigint; limitRemainingLamports: bigint }>;
  /** Pulls this many lamports from the vault through the spending limit, into the hot wallet. */
  pullFromVault(lamports: bigint): Promise<string>;
  /**
   * Builds the marketplace's buy transaction, simulates it and refuses it unless the only effects
   * are: the hot wallet pays at most `maxSpend` lamports and ends up owning the card. Returns the
   * signed transaction's signature and a function that broadcasts and confirms it.
   */
  prepareBuy(listing: Listing, maxSpend: bigint): Promise<{ signature: string; send(): Promise<void> }>;
  /**
   * Re-reads the card from chain: refuses it unless its verified collection is the pinned
   * Collector Crypt collection, and returns the listing with name, image and traits from the
   * asset's own metadata, so the marketplace's copy is never trusted for value or tier.
   */
  verifyCard(listing: Listing): Promise<Listing>;
  purchaseState(signature: string, createdAt: Date): Promise<PurchaseState>;
  ownsCard(mint: string): Promise<boolean>;
}

export interface Market {
  /** Current listings, cheapest first. */
  listings(solUsd: number): Promise<Listing[]>;
}

export interface BuyDeps {
  store: BuyerStore;
  gateway: BuyerGateway;
  market: Market;
  policy: BuyPolicy;
  /** Keep at least this much SOL in the hot wallet for prize-sending gas. */
  gasReserveLamports: bigint;
  /** Off-chain backstop to the on-chain limit: card spend over any 7 days, whatever SOL the wallet holds. */
  weeklyMaxLamports: bigint;
  log: Logger;
}

export type BuyOutcome =
  | { kind: 'waiting'; pending: number }
  | { kind: 'idle'; reason: string }
  | { kind: 'bought'; cards: number; spentLamports: string; stopped?: string };

export async function runBuyTick(deps: BuyDeps): Promise<BuyOutcome> {
  const { store, gateway, policy, log } = deps;

  // 1. Settle anything in flight. Never buy more while a purchase is unresolved.
  let unresolved = 0;
  for (const p of await store.pending()) {
    const state = await gateway.purchaseState(p.signature, p.createdAt);
    if (state === 'pending') {
      unresolved++;
      continue;
    }
    // Ownership is the truth: a landed tx that didn't deliver, or an expired one that did, both happen.
    if (await gateway.ownsCard(p.mint)) {
      await store.markBought(p.id);
      log.info('card purchase settled', { mint: p.mint, signature: p.signature });
    } else if (state === 'landed' && Date.now() - p.createdAt.getTime() < 10 * 60_000) {
      unresolved++;
      log.warn('purchase landed but the card is not in the hot wallet yet', { mint: p.mint, signature: p.signature });
    } else if (state === 'landed') {
      await store.markFailed(p.id, 'landed but the card never reached the hot wallet; check the transaction');
      log.error('purchase landed without delivering the card', { mint: p.mint, signature: p.signature });
    } else {
      await store.markFailed(p.id, `transaction ${state}`);
      log.warn('card purchase did not go through', { mint: p.mint, signature: p.signature, state });
    }
  }
  if (unresolved) return { kind: 'waiting', pending: unresolved };

  // 2. Work out what to buy.
  const fund = await store.fund();
  const size = sizing(fund, policy);
  const short = shortByTier(fund, size);
  if (!TIERS.some((t) => short[t] > 0)) return { kind: 'idle', reason: 'stocked' };
  if (fund.cashUsd <= 0) {
    log.warn('stock is short but the card fund has no cash; waiting for fees', { poolUsd: size.poolUsd, short });
    return { kind: 'idle', reason: 'fund_empty' };
  }
  const solUsd = await gateway.solUsd();
  const [listings, owned] = await Promise.all([deps.market.listings(solUsd), store.ownedMints()]);
  // No card may cost more than one day's release (and never more than the hard cap).
  const tickPolicy: BuyPolicy = { ...policy, maxPriceUsd: size.capUsd, maxCardsPerTick: policy.maxCardsPerTick * 4 };
  // Plan with spares: a pick that fails the on-chain check is replaced by the next-cheapest one.
  const { picks, want } = planBuys(short, listings, owned, tickPolicy, solUsd, fund.cashUsd, 3);
  if (picks.length === 0) {
    log.warn('cards needed but no listing passes the filters', { short, capUsd: size.capUsd });
    return { kind: 'idle', reason: 'no_matching_listings' };
  }

  // 3. Buy them one at a time, inside the fund and the weekly budget.
  let bought = 0;
  let spent = 0n;
  let cashLeft = fund.cashUsd;
  for (const pick of picks) {
    if (bought >= policy.maxCardsPerTick) break;
    if (want[pick.tier] <= 0) continue;
    let c: Candidate | null;
    try {
      c = classify(await gateway.verifyCard(pick.listing), tickPolicy, solUsd);
    } catch (err) {
      log.warn('listing failed the on-chain card check', { mint: pick.listing.mint, error: err instanceof Error ? err.message : String(err) });
      continue;
    }
    if (!c || want[c.tier] <= 0) {
      log.warn('on-chain traits do not qualify the listing for a tier we need', { mint: pick.listing.mint, tier: c?.tier ?? null });
      continue;
    }
    if (c.priceUsd > cashLeft) {
      log.warn('card fund cash used up; stopping until more fees arrive', { cashLeft, price: c.priceUsd });
      return { kind: 'bought', cards: bought, spentLamports: spent.toString(), stopped: 'fund' };
    }
    const weekSpent = await store.spentSince(new Date(Date.now() - 7 * 86_400_000));
    if (weekSpent + c.listing.priceLamports > deps.weeklyMaxLamports) {
      log.warn('weekly card budget reached; stopping', { spent: weekSpent.toString(), max: deps.weeklyMaxLamports.toString() });
      return { kind: 'bought', cards: bought, spentLamports: spent.toString(), stopped: 'budget' };
    }
    const maxSpend = c.listing.priceLamports + (c.listing.priceLamports * BigInt(policy.maxOverheadBps)) / 10_000n + 10_000_000n;
    const { walletLamports, limitRemainingLamports } = await gateway.budget();
    const shortfall = maxSpend + deps.gasReserveLamports - walletLamports;
    if (shortfall > 0n) {
      if (shortfall > limitRemainingLamports) {
        log.warn('not enough SOL in the buying wallet or in the spending limit; stopping until fees arrive or the limit resets', { remaining: limitRemainingLamports.toString(), needed: shortfall.toString() });
        return { kind: 'bought', cards: bought, spentLamports: spent.toString(), stopped: 'budget' };
      }
      const sig = await gateway.pullFromVault(shortfall);
      log.info('pulled budget from the vault', { lamports: shortfall.toString(), signature: sig });
    }

    let prepared;
    try {
      prepared = await gateway.prepareBuy(c.listing, maxSpend);
    } catch (err) {
      // Listing gone, price changed, or the transaction failed our checks: skip this card.
      log.warn('skipped a listing', { mint: c.listing.mint, error: err instanceof Error ? err.message : String(err) });
      continue;
    }
    const id = await store.insertPending(c, prepared.signature, solUsd);
    try {
      await prepared.send();
    } catch (err) {
      // Unknown outcome: the row stays 'sending' and the next tick settles it from chain state.
      log.error('purchase send failed; will settle next tick', { mint: c.listing.mint, error: err instanceof Error ? err.message : String(err) });
      return { kind: 'bought', cards: bought, spentLamports: spent.toString(), stopped: 'send_error' };
    }
    if (!(await gateway.ownsCard(c.listing.mint))) {
      log.warn('purchase confirmed but card not seen yet; will settle next tick', { mint: c.listing.mint });
      return { kind: 'bought', cards: bought, spentLamports: spent.toString(), stopped: 'unsettled' };
    }
    await store.markBought(id);
    bought++;
    want[c.tier] -= c.priceUsd;
    cashLeft -= c.priceUsd;
    spent += c.listing.priceLamports;
    log.info('bought a card', { mint: c.listing.mint, tier: c.tier, valueUsd: c.valueUsd, priceUsd: Math.round(c.priceUsd * 100) / 100 });
  }
  return { kind: 'bought', cards: bought, spentLamports: spent.toString() };
}
