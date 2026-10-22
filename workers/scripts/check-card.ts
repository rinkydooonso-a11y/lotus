/**
 * READ-ONLY: would the card buyer buy this card? Sends nothing and needs no key.
 *
 *   cd workers && SOLANA_RPC_URL=<mainnet Helius URL> BUY_COLLECTION_ADDRESS=<Collector Crypt Core collection> \
 *     npx tsx scripts/check-card.ts <card address>
 *
 * Reads the card's on-chain traits and its marketplace listing, then applies the buyer's own rules
 * (the BUY_* settings, same defaults as .env.example) and prints the first rule it breaks, if any.
 * It does not say whether the buyer would pick it today: that also depends on which tier is short of
 * stock, the fund's cash, and the cheapest-first order (it prints this card's place in that order).
 */
import { explainListing, type BuyPolicy, type Listing } from '../src/cardBuyer.js';
import { createCollectorCrypt } from '../src/collectorCrypt.js';
import { parseMix, parseTargets, parseTraits } from '../src/config.js';
import { dasGetAsset } from '../src/das.js';
import { jupiterSolUsd } from '../src/magicEden.js';

const mint = process.argv[2];
const rpc = process.env.HELIUS_DAS_URL ?? process.env.SOLANA_RPC_URL;
const collection = process.env.BUY_COLLECTION_ADDRESS;
if (!mint || !rpc || !collection) throw new Error('usage: check-card.ts <card address>  (needs SOLANA_RPC_URL and BUY_COLLECTION_ADDRESS)');
const env = (k: string, d: string) => process.env[k] || d;
const listingPages = Number(env('BUY_LISTING_PAGES', '100'));
const policy: BuyPolicy = {
  tierMix: parseMix(env('BUY_TIER_MIX', 'common:45,uncommon:30,rare:20,grail:5')),
  payoutDays: Number(env('LOTUS_POOL_PAYOUT_DAYS', '14')),
  stockDays: Number(env('BUY_STOCK_DAYS', '3')),
  tierMinUsd: parseTargets(env('BUY_TIER_MIN_USD', 'common:0,uncommon:30,rare:75,grail:300'), 'BUY_TIER_MIN_USD', 6),
  requiredTraits: parseTraits(env('BUY_REQUIRED_TRAITS', 'Type=Card;Category=Pokemon')),
  valueTrait: env('BUY_VALUE_TRAIT', 'Insured Value'),
  gradeTrait: env('BUY_GRADE_TRAIT', 'The Grade'),
  maxPriceToValue: Number(env('BUY_MAX_PRICE_TO_VALUE', '1')),
  maxLamportsPerCard: BigInt(Math.round(Number(env('BUY_MAX_SOL_PER_CARD', '10')) * 1e9)),
  maxCardsPerTick: 10,
  maxOverheadBps: Number(env('BUY_MAX_OVERHEAD_BPS', '800')),
  maxPriceUsd: Number(env('BUY_MAX_USD_PER_CARD', '1000')),
};

const solUsd = await jupiterSolUsd();
const asset = await dasGetAsset(rpc, mint);
if (!asset) throw new Error(`card ${mint} not found on chain`);
const traits: Record<string, string> = {};
for (const a of asset.content?.metadata?.attributes ?? []) traits[a.trait_type] = String(a.value);
console.log('on-chain traits:', JSON.stringify({ name: asset.content?.metadata?.name, ...traits }, null, 2));

// The listings API is read cheapest first; look further than the buyer does so we can say where it falls.
const all = await createCollectorCrypt({ collection, pages: listingPages }).listings(solUsd);
const idx = all.findIndex((l) => l.mint === mint);
if (idx < 0) {
  console.log(`not found among the ${all.length} cheapest USDC listings: it is not listed in USDC, is sold, or is priced above all of these.`);
  process.exit(0);
}
const listed = all[idx]!;
console.log(`listed for $${Number(listed.priceUsdc) / 1e6} USDC; #${idx + 1} cheapest of ${all.length} read (the buyer reads the newest ${listingPages * 30} listings each run)`);
// The buyer judges the on-chain traits (verifyCard), so judge those, with the listing's price.
const asBought: Listing = { ...listed, attributes: { ...listed.attributes, ...traits } };
const r = explainListing(asBought, policy, solUsd);
if ('candidate' in r) {
  console.log(`PASSES every rule: tier ${r.candidate.tier}, insured value $${r.candidate.valueUsd}, price $${r.candidate.priceUsd.toFixed(2)}, grade ${r.candidate.grade ?? '?'}`);
  console.log(idx >= listingPages * 30 ? 'but it is deeper than the listings the buyer reads each run, so it would not be seen.' : 'and it is within the listings the buyer reads. It is bought when its tier is short of stock and the fund can pay.');
} else {
  console.log(`would NOT be bought: ${r.reason}`);
}
