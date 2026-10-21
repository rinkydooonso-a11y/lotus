/**
 * READ-ONLY check before the card buyer touches real money. Sends nothing and needs no key.
 *
 *   cd workers && SOLANA_RPC_URL=<mainnet Helius URL> HOT_WALLET_ADDRESS=... \
 *     BUY_COLLECTION_ADDRESS=<Collector Crypt Core collection> npx tsx scripts/buyer-dry-run.ts
 *
 * 1. Reads Collector Crypt marketplace listings (USDC) and prints the cheapest few.
 * 2. For the cheapest card under the cap, builds the buy_core transaction (never signed or sent),
 *    prints each instruction, checks our allowlist accepts it, and simulates it. Simulation needs
 *    the hot wallet to hold enough USDC and some SOL; without that it fails with a balance error,
 *    which is expected on an unfunded wallet.
 */
import { Connection, VersionedTransaction } from '@solana/web3.js';
import { TransactionMessage } from '@solana/web3.js';
import { checkBuyInstructions } from '../src/buyerGateway.js';
import { createBuyCoreBuilder, createCollectorCrypt } from '../src/collectorCrypt.js';
import { jupiterSolUsd } from '../src/magicEden.js';

const rpc = process.env.SOLANA_RPC_URL!;
const hot = process.env.HOT_WALLET_ADDRESS!;
const collection = process.env.BUY_COLLECTION_ADDRESS!;
if (!rpc || !hot || !collection) throw new Error('SOLANA_RPC_URL, HOT_WALLET_ADDRESS and BUY_COLLECTION_ADDRESS are required');
const maxUsd = Number(process.env.BUY_MAX_USD_PER_CARD ?? 25);

async function main() {
  const solUsd = await jupiterSolUsd();
  const listings = await createCollectorCrypt({ collection, pages: 3 }).listings(solUsd);
  console.log(`listings read: ${listings.length} (SOL/USD ${solUsd})`);
  for (const l of listings.slice(0, 5)) {
    console.log(JSON.stringify({ mint: l.mint, seller: l.seller, usdc: Number(l.priceUsdc) / 1e6, attributes: l.attributes }));
  }
  const cheapest = listings.find((l) => l.attributes.Type === 'Card' && Number(l.priceUsdc) / 1e6 <= maxUsd);
  if (!cheapest) return console.log(`no card listing at or under $${maxUsd}`);
  console.log(`building (not sending) a buy for ${cheapest.mint} at $${Number(cheapest.priceUsdc) / 1e6}`);
  const conn = new Connection(rpc, 'confirmed');
  try {
    const tx = VersionedTransaction.deserialize(await createBuyCoreBuilder({ connection: conn, collection })(cheapest, hot));
    const ixs = TransactionMessage.decompile(tx.message).instructions;
    for (const ix of ixs) console.log(`  ${ix.programId.toBase58()} ${ix.data.subarray(0, 8).toString('hex')} (${ix.keys.length} accounts)`);
    try {
      checkBuyInstructions(ixs);
      console.log('allowlist: ACCEPTS this transaction');
    } catch (err) {
      console.log(`allowlist: REFUSES this transaction: ${(err as Error).message}`);
    }
    const sim = await conn.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed' });
    console.log(`simulation: err=${JSON.stringify(sim.value.err)} unitsConsumed=${sim.value.unitsConsumed ?? '?'}`);
  } catch (err) {
    console.log(`could not build a buy transaction: ${(err as Error).message}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
