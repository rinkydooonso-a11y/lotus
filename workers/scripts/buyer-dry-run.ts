/**
 * READ-ONLY check before the card buyer touches real money. Sends nothing and needs no key.
 *
 *   cd workers && SOLANA_RPC_URL=<mainnet Helius URL> HOT_WALLET_ADDRESS=... [MAGIC_EDEN_API_KEY=...] \
 *     npx tsx scripts/buyer-dry-run.ts
 *
 * 1. Reads a few pages of Collector Crypt listings from Magic Eden and, for listings from different
 *    sellers, what DAS says on chain: interface, verified collection, authorities, traits.
 * 2. Counts the collection's assets (getAssetsByGroup), as one cross-check of the pinned address.
 * 3. Asks Magic Eden to build a buy transaction for the cheapest card (never signed or sent) and
 *    prints each instruction's program and discriminator, and whether our allowlist accepts it.
 */
import { Connection, PublicKey, TransactionMessage, VersionedTransaction, type AddressLookupTableAccount } from '@solana/web3.js';
import { checkBuyInstructions } from '../src/buyerGateway.js';
import { createMagicEden } from '../src/magicEden.js';

const rpc = process.env.SOLANA_RPC_URL!;
const hot = process.env.HOT_WALLET_ADDRESS!;
if (!rpc || !hot) throw new Error('SOLANA_RPC_URL and HOT_WALLET_ADDRESS are required');

async function das(method: string, params: Record<string, unknown>): Promise<any> {
  const res = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const body = (await res.json()) as { result?: unknown; error?: { message?: string } };
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}

async function main() {
  const me = createMagicEden({ collection: 'collector_crypt', apiKey: process.env.MAGIC_EDEN_API_KEY, pages: 3, requiredTraits: {} });
  const listings = await me.listings();
  console.log(`listings read: ${listings.length}`);
  const traitKeys = new Map<string, Set<string>>();
  for (const l of listings) for (const [k, v] of Object.entries(l.attributes)) {
    if (!traitKeys.has(k)) traitKeys.set(k, new Set());
    if (traitKeys.get(k)!.size < 8) traitKeys.get(k)!.add(v);
  }
  console.log('Magic Eden trait names and sample values:', JSON.stringify(Object.fromEntries([...traitKeys].map(([k, v]) => [k, [...v]])), null, 1));

  const sellers = new Set<string>();
  const sample = listings.filter((l) => !sellers.has(l.seller) && sellers.add(l.seller)).slice(0, 6);
  const collections = new Map<string, number>();
  for (const l of sample) {
    const a = await das('getAsset', { id: l.mint });
    const coll = (a.grouping ?? []).find((g: any) => g.group_key === 'collection');
    collections.set(coll?.group_value ?? 'none', (collections.get(coll?.group_value ?? 'none') ?? 0) + 1);
    console.log(JSON.stringify({
      mint: l.mint, seller: l.seller, priceSol: Number(l.priceLamports) / 1e9, interface: a.interface,
      collection: coll?.group_value ?? null, collectionVerified: coll?.verified ?? null,
      authorities: (a.authorities ?? []).map((x: any) => x.address),
      onChainTraits: Object.fromEntries((a.content?.metadata?.attributes ?? []).map((x: any) => [x.trait_type, x.value])),
    }));
  }
  for (const [c, n] of collections) {
    if (c === 'none') continue;
    const r = await das('getAssetsByGroup', { groupKey: 'collection', groupValue: c, page: 1, limit: 1000 });
    console.log(`collection ${c}: seen on ${n} sampled listings; getAssetsByGroup page 1 has ${r.items?.length ?? 0} items (total ${r.total ?? '?'})`);
  }

  const cheapest = listings.find((l) => /card/i.test(l.attributes.Type ?? l.attributes.Category ?? '')) ?? listings[0];
  if (!cheapest) return;
  console.log(`building (not sending) a buy for ${cheapest.mint} at ${Number(cheapest.priceLamports) / 1e9} SOL`);
  try {
    const tx = VersionedTransaction.deserialize(await me.buildBuyTx(cheapest, hot));
    const conn = new Connection(rpc, 'confirmed');
    const luts: AddressLookupTableAccount[] = [];
    for (const l of tx.message.addressTableLookups) {
      const r = await conn.getAddressLookupTable(l.accountKey);
      if (r.value) luts.push(r.value);
    }
    const ixs = TransactionMessage.decompile(tx.message, { addressLookupTableAccounts: luts }).instructions;
    console.log(`fee payer is hot wallet: ${tx.message.staticAccountKeys[0]?.equals(new PublicKey(hot))}`);
    for (const ix of ixs) console.log(`  ${ix.programId.toBase58()} ${ix.data.subarray(0, 8).toString('hex')} (${ix.keys.length} accounts)`);
    try {
      checkBuyInstructions(ixs);
      console.log('allowlist: ACCEPTS this transaction');
    } catch (err) {
      console.log(`allowlist: REFUSES this transaction: ${(err as Error).message}`);
    }
  } catch (err) {
    console.log(`could not build a buy transaction: ${(err as Error).message}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
