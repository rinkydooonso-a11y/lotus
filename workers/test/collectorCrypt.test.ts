import { describe, expect, it } from 'vitest';
import { ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import {
  CC_PROGRAM, buyCoreInstruction, ccListingPda, ccMarketPda, ccWhitelistPda, createBuyCoreBuilder, createCollectorCrypt, createOnChainListings, parseListing, toListing,
} from '../src/collectorCrypt.js';
import { createJupiterSwap } from '../src/jupiterSwap.js';
import { checkBuyInstructions, checkSwapInstructions, checkNoHotAssetsWritable } from '../src/buyerGateway.js';
import { classify, type BuyPolicy, type Listing } from '../src/cardBuyer.js';

const COLLECTION = new PublicKey('CCryptUfeFSZ3Fgc9FLeKrhLVAP67FSqi1GuVoj9CRac');
const JUP = new PublicKey('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4');

function listingData(p: { seller: PublicKey; nft: PublicKey; collection: PublicKey; price: bigint; type?: number; rentPayer?: PublicKey }) {
  const d = Buffer.alloc(162);
  Buffer.from('da2032492b861a3a', 'hex').copy(d, 0);
  p.seller.toBuffer().copy(d, 8);
  p.nft.toBuffer().copy(d, 40);
  p.collection.toBuffer().copy(d, 72);
  d.writeBigUInt64LE(p.price, 105);
  d[113] = p.type ?? 3;
  (p.rentPayer ?? p.seller).toBuffer().copy(d, 130);
  return d;
}

describe('collector crypt addresses', () => {
  it('derives the market and whitelist PDAs seen in a real buy', () => {
    expect(ccMarketPda().toBase58()).toBe('4cPGpxA6CQgMmvr5MAVA4ApyW7T8oT6nkFdw9J4MVV3k');
    expect(ccWhitelistPda(COLLECTION).toBase58()).toBe('FxxbFmprwQKegXCwYkyRw9TC1VmHWxUrKft1n5PsgTqX');
  });
});

describe('buy_core instruction', () => {
  const buyer = Keypair.generate().publicKey;
  const seller = Keypair.generate().publicKey;
  const asset = Keypair.generate().publicKey;
  const rentPayer = Keypair.generate().publicKey;
  const ix = buyCoreInstruction({ buyer, seller, rentReceiver: rentPayer, asset, collection: COLLECTION, expectedPrice: 31_500_000n });

  it('encodes the discriminator and the USDC price like the live buy', () => {
    expect(ix.data.toString('hex')).toBe('a9e357ff4c56ff19e0a6e00100000000');
  });

  it('lists the 18 accounts in order with the buyer as the only signer', () => {
    expect(ix.keys).toHaveLength(18);
    expect(ix.keys.filter((k) => k.isSigner).map((k) => k.pubkey.toBase58())).toEqual([buyer.toBase58(), buyer.toBase58()]);
    expect(ix.keys[1]!.pubkey.equals(seller)).toBe(true);
    // The rent goes back to whoever paid it, which is not always the seller.
    expect(ix.keys[2]).toMatchObject({ isWritable: true, isSigner: false });
    expect(ix.keys[2]!.pubkey.equals(rentPayer)).toBe(true);
    expect(ix.keys[8]!.pubkey.equals(ccListingPda(asset, seller))).toBe(true);
    expect(ix.keys[6]).toMatchObject({ isWritable: true });
    expect(ix.keys[16]!.pubkey.equals(TOKEN_PROGRAM_ID)).toBe(true);
  });

  it('passes the buy allowlist, and a different instruction on the program does not', () => {
    expect(() => checkBuyInstructions([ix])).not.toThrow();
    const other = new TransactionInstruction({ programId: CC_PROGRAM, keys: [], data: Buffer.from('0102030405060708', 'hex') });
    expect(() => checkBuyInstructions([other])).toThrow(/instruction we don't allow/);
  });
});

describe('parseListing', () => {
  const seller = Keypair.generate().publicKey;
  const nft = Keypair.generate().publicKey;
  it('reads seller, asset, collection, price and type', () => {
    const l = parseListing(CC_PROGRAM.toBase58(), listingData({ seller, nft, collection: COLLECTION, price: 44_000_000n }));
    expect(l).toEqual({ seller: seller.toBase58(), nft: nft.toBase58(), collection: COLLECTION.toBase58(), priceUsdc: 44_000_000n, collectionType: 3, rentPayer: seller.toBase58() });
  });
  it('refuses the wrong owner, size or discriminator', () => {
    const d = listingData({ seller, nft, collection: COLLECTION, price: 1n });
    expect(() => parseListing(SystemProgram.programId.toBase58(), d)).toThrow(/not owned/);
    expect(() => parseListing(CC_PROGRAM.toBase58(), d.subarray(0, 100))).toThrow(/not a listing/);
    d[0] = d[0]! ^ 1;
    expect(() => parseListing(CC_PROGRAM.toBase58(), d)).toThrow(/not a listing/);
  });
});

describe('listings API', () => {
  const item = (mint: string, price: number, extra: object = {}) => ({
    nftAddress: mint, nftStandard: 'core', type: 'Card', category: 'Pokemon', itemName: mint, grade: '9', insuredValue: '40',
    owner: { wallet: 'seller1' }, listing: { price, currency: 'USDC', marketplace: 'CC' }, ...extra,
  });

  it('maps a card to a USDC listing with a SOL-equivalent price rounded up', () => {
    const l = toListing(item('m1', 20.5), 100)!;
    expect(l).toMatchObject({ mint: 'm1', seller: 'seller1', priceUsdc: 20_500_000n, attributes: { Type: 'Card', Category: 'Pokemon', 'Insured Value': '40', Grade: '9', 'The Grade': '9' } });
    expect(l.priceLamports).toBe(205_000_000n);
  });

  it('skips non-Core, non-USDC and priceless items', () => {
    expect(toListing(item('a', 5, { nftStandard: 'legacy' }), 100)).toBeNull();
    expect(toListing(item('b', 5, { listing: { price: 5, currency: 'SOL' } }), 100)).toBeNull();
    expect(toListing(item('c', 0), 100)).toBeNull();
    expect(toListing({ ...item('d', 5), owner: undefined }, 100)).toBeNull();
  });

  it('asks the API for one category when configured', async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string) => {
      urls.push(url);
      return { ok: true, status: 200, json: async () => ({ filterNFtCard: [item('p', 5)] }) };
    }) as unknown as typeof fetch;
    await createCollectorCrypt({ collection: COLLECTION.toBase58(), pages: 1, category: 'Pokemon', fetchImpl }).listings(100);
    expect(decodeURIComponent(urls[0]!)).toContain('categories[]=Pokemon');
    await createCollectorCrypt({ collection: COLLECTION.toBase58(), pages: 1, fetchImpl }).listings(100);
    expect(urls[1]).not.toContain('categories');
  });

  it('reads pages, stops on a short page, and returns cheapest first', async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string) => {
      urls.push(url);
      const rows = url.includes('page=1') ? Array.from({ length: 30 }, (_, i) => item(`m${i}`, 30 - i)) : [item('last', 0.5)];
      return { ok: true, status: 200, json: async () => ({ filterNFtCard: rows }) };
    }) as unknown as typeof fetch;
    const ls = await createCollectorCrypt({ collection: COLLECTION.toBase58(), pages: 5, fetchImpl }).listings(100);
    expect(urls).toHaveLength(2);
    expect(ls[0]!.mint).toBe('last');
    expect(ls).toHaveLength(31);
  });

  it('fails loudly on an API error', async () => {
    const fetchImpl = (async () => ({ ok: false, status: 500 })) as unknown as typeof fetch;
    await expect(createCollectorCrypt({ collection: 'c', pages: 1, fetchImpl }).listings(100)).rejects.toThrow(/500/);
  });
});

describe('buy transaction builder', () => {
  const seller = Keypair.generate().publicKey;
  const asset = Keypair.generate().publicKey;
  const hot = Keypair.generate().publicKey;
  const base: Listing = { mint: asset.toBase58(), seller: seller.toBase58(), priceLamports: 1n, priceUsdc: 20_000_000n, name: 'n', image: null, attributes: {}, raw: {} };
  const connection = (data: Buffer | null, owner = CC_PROGRAM) => ({
    getAccountInfo: async () => (data ? { owner, data } : null),
    getLatestBlockhash: async () => ({ blockhash: '11111111111111111111111111111111' }),
  }) as never;
  const build = (listing: Listing, data: Buffer | null, collection = COLLECTION.toBase58()) =>
    createBuyCoreBuilder({ connection: connection(data), collection })(listing, hot.toBase58());
  const good = listingData({ seller, nft: asset, collection: COLLECTION, price: 20_000_000n });

  it('builds ATA create plus buy_core at the on-chain price, paid by the buyer, accepted by the allowlist', async () => {
    const tx = VersionedTransaction.deserialize(await build(base, good));
    expect(tx.message.staticAccountKeys[0]!.equals(hot)).toBe(true);
    expect(tx.message.header.numRequiredSignatures).toBe(1);
    const ixs = TransactionMessage.decompile(tx.message).instructions;
    expect(ixs.map((i) => i.programId.toBase58())).toEqual([
      ComputeBudgetProgram.programId.toBase58(), ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(), CC_PROGRAM.toBase58(),
    ]);
    expect(ixs[2]!.data.readBigUInt64LE(8)).toBe(20_000_000n);
    expect(() => checkBuyInstructions(ixs)).not.toThrow();
  });

  it('returns the rent to the listing\'s rent payer when that is not the seller', async () => {
    const sponsor = Keypair.generate().publicKey;
    const data = listingData({ seller, nft: asset, collection: COLLECTION, price: 20_000_000n, rentPayer: sponsor });
    const ixs = TransactionMessage.decompile(VersionedTransaction.deserialize(await build(base, data)).message).instructions;
    expect(ixs[2]!.keys[1]!.pubkey.equals(seller)).toBe(true);
    expect(ixs[2]!.keys[2]!.pubkey.equals(sponsor)).toBe(true);
    expect(ixs[2]!.keys[3]!.pubkey.equals(hot)).toBe(true);
  });

  it('refuses a missing listing, a moved price, another collection, a non-Core type or another seller', async () => {
    await expect(build(base, null)).rejects.toThrow(/no longer exists/);
    await expect(build({ ...base, priceUsdc: 10_000_000n }, good)).rejects.toThrow(/differs/);
    await expect(build(base, listingData({ seller, nft: asset, collection: Keypair.generate().publicKey, price: 20_000_000n }))).rejects.toThrow(/pinned collection/);
    await expect(build(base, listingData({ seller, nft: asset, collection: COLLECTION, price: 20_000_000n, type: 1 }))).rejects.toThrow(/not a Core/);
    await expect(build(base, listingData({ seller: Keypair.generate().publicKey, nft: asset, collection: COLLECTION, price: 20_000_000n }))).rejects.toThrow(/does not match/);
    await expect(build({ ...base, priceUsdc: undefined }, good)).rejects.toThrow(/no USDC price/);
  });
});

describe('swap guards', () => {
  const hot = Keypair.generate();
  const ix = (programId: PublicKey, data: number[], keys: PublicKey[] = []) =>
    new TransactionInstruction({ programId, data: Buffer.from(data), keys: keys.map((pubkey) => ({ pubkey, isSigner: false, isWritable: true })) });
  const TOKEN = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

  it('accepts wrap, sync, Jupiter and close-to-hot, and refuses anything else', () => {
    const ok = [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1 }),
      SystemProgram.transfer({ fromPubkey: hot.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 }),
      ix(TOKEN, [17]),
      ix(JUP, [1, 2, 3]),
      ix(TOKEN, [9], [Keypair.generate().publicKey, hot.publicKey]),
    ];
    expect(() => checkSwapInstructions(ok, hot.publicKey.toBase58())).not.toThrow();
    expect(() => checkSwapInstructions([ix(TOKEN, [9], [hot.publicKey, Keypair.generate().publicKey])], hot.publicKey.toBase58())).toThrow(/close-to-hot/);
    expect(() => checkSwapInstructions([ix(TOKEN, [3, 1, 0, 0, 0, 0, 0, 0, 0])], hot.publicKey.toBase58())).toThrow(/token instruction/);
    expect(() => checkSwapInstructions([ix(CC_PROGRAM, [1])], hot.publicKey.toBase58())).toThrow(/don't allow/);
    expect(() => checkSwapInstructions([SystemProgram.assign({ accountPubkey: hot.publicKey, programId: CC_PROGRAM })], hot.publicKey.toBase58())).toThrow(/system instruction/);
  });

  it('lets only the named hot token accounts be written', () => {
    const tokenAcct = (owner: PublicKey) => {
      const d = Buffer.alloc(165);
      owner.toBuffer().copy(d, 32);
      return d;
    };
    const w = (key: string) => ({ key, owner: TOKEN.toBase58(), data: tokenAcct(hot.publicKey) });
    expect(() => checkNoHotAssetsWritable([w('usdc'), w('wsol')], hot.publicKey.toBase58(), ['usdc', 'wsol'])).not.toThrow();
    expect(() => checkNoHotAssetsWritable([w('usdc'), w('other')], hot.publicKey.toBase58(), ['usdc', 'wsol'])).toThrow(/hot-wallet token account/);
  });
});

describe('jupiter swap builder', () => {
  const quote = (over: object = {}) => ({ swapMode: 'ExactOut', outAmount: '5000000', inAmount: '50000000', otherAmountThreshold: '50500000', ...over });
  const fake = (q: object, calls: string[] = []) => (async (url: string) => {
    calls.push(url);
    return url.includes('/quote')
      ? { ok: true, status: 200, json: async () => q }
      : { ok: true, status: 200, json: async () => ({ swapTransaction: Buffer.from([1, 2, 3]).toString('base64') }) };
  }) as unknown as typeof fetch;

  it('quotes exact-out and returns the transaction bytes', async () => {
    const calls: string[] = [];
    const tx = await createJupiterSwap({ slippageBps: 100, fetchImpl: fake(quote(), calls) })(5_000_000n, 60_000_000n, 'user');
    expect([...tx]).toEqual([1, 2, 3]);
    expect(calls[0]).toContain('swapMode=ExactOut');
    expect(calls[0]).toContain('amount=5000000');
  });

  it('refuses a quote that delivers too little or costs more than the budget', async () => {
    await expect(createJupiterSwap({ slippageBps: 100, fetchImpl: fake(quote({ outAmount: '4000000' })) })(5_000_000n, 60_000_000n, 'u')).rejects.toThrow(/does not deliver/);
    await expect(createJupiterSwap({ slippageBps: 100, fetchImpl: fake(quote()) })(5_000_000n, 50_000_000n, 'u')).rejects.toThrow(/more SOL/);
  });
});

describe('USD price cap', () => {
  const policy: BuyPolicy = {
    tierMix: { common: 1, uncommon: 0, rare: 0, grail: 0 }, payoutDays: 14, stockDays: 3, tierMinUsd: { common: 0, uncommon: 50, rare: 150, grail: 500 },
    requiredTraits: { Type: 'Card' }, valueTrait: 'Insured Value', gradeTrait: 'Grade', maxPriceToValue: 1,
    maxLamportsPerCard: 10_000_000_000n, maxCardsPerTick: 5, maxOverheadBps: 800, maxPriceUsd: 25,
  };
  const l = (usd: number): Listing => ({
    mint: 'm', seller: 's', priceLamports: BigInt(usd * 1e7), priceUsdc: BigInt(usd * 1e6), name: 'n', image: null,
    attributes: { Type: 'Card', 'Insured Value': '100', Grade: '9' }, raw: {},
  });
  it('rejects cards over $25 USDC and accepts at the cap', () => {
    expect(classify(l(25), policy, 100)).not.toBeNull();
    expect(classify(l(26), policy, 100)).toBeNull();
  });
});

describe('on-chain listings', () => {
  const nft = (n: number) => new PublicKey(Buffer.alloc(32, n));
  const seller = Keypair.generate().publicKey;
  const acct = (n: number, usd: number, over: Partial<Parameters<typeof listingData>[0]> = {}) => ({
    pubkey: Keypair.generate().publicKey,
    account: { owner: CC_PROGRAM, data: listingData({ seller, nft: nft(n), collection: COLLECTION, price: BigInt(usd * 1e6), ...over }) },
  });
  const das = (n: number) => ({
    id: nft(n).toBase58(), interface: 'MplCoreAsset', ownership: { owner: seller.toBase58() },
    content: { metadata: { name: `card${n}`, attributes: [{ trait_type: 'Type', value: 'Card' }, { trait_type: 'Insured Value', value: '40' }] } },
  });
  const make = (accounts: unknown[], calls: { filters?: unknown; batches: string[][] }, limit = 2) => createOnChainListings({
    connection: { getProgramAccounts: async (_p: unknown, o: { filters: unknown }) => { calls.filters = o.filters; return accounts; } } as never,
    collection: COLLECTION.toBase58(),
    getAssets: async (ids) => { calls.batches.push(ids); return ids.map((id) => das(Buffer.from(new PublicKey(id).toBytes())[0]!)); },
    maxPriceUsd: 25,
    limit,
  });

  it('filters the program accounts on size, discriminator, collection and Core type', async () => {
    const calls = { batches: [] as string[][] } as { filters?: Array<Record<string, any>>; batches: string[][] };
    await make([], calls).listings(100);
    expect(calls.filters).toHaveLength(4);
    expect(calls.filters![0]).toEqual({ dataSize: 162 });
    expect(calls.filters![2]).toEqual({ memcmp: { offset: 72, bytes: COLLECTION.toBase58() } });
    expect(calls.filters![3]!.memcmp.offset).toBe(113);
    expect(calls.batches).toEqual([]);
  });

  it('keeps the cheapest listings under the cap, with traits from DAS', async () => {
    const calls = { batches: [] as string[][] };
    const ls = await make([acct(1, 20), acct(2, 5), acct(3, 30), acct(4, 10), acct(5, 1, { collection: Keypair.generate().publicKey }), acct(6, 2, { type: 1 })], calls).listings(100);
    expect(ls.map((l) => l.priceUsdc)).toEqual([5_000_000n, 10_000_000n]);
    expect(ls[0]).toMatchObject({ mint: nft(2).toBase58(), seller: seller.toBase58(), name: 'card2', attributes: { Type: 'Card', 'Insured Value': '40' } });
    expect(ls[0]!.priceLamports).toBe(50_000_000n);
    expect(calls.batches).toHaveLength(1);
  });

  it('skips listings DAS does not know and accounts that are not listings', async () => {
    const calls = { batches: [] as string[][] };
    const junk = { pubkey: Keypair.generate().publicKey, account: { owner: CC_PROGRAM, data: Buffer.alloc(50) } };
    const m = createOnChainListings({
      connection: { getProgramAccounts: async () => [junk, acct(1, 5)] } as never,
      collection: COLLECTION.toBase58(), getAssets: async () => [], maxPriceUsd: 25, limit: 5,
    });
    expect(await m.listings(100)).toEqual([]);
    expect(calls.batches).toEqual([]);
  });
});
