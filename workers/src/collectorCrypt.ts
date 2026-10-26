import { createHash } from 'node:crypto';
import {
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
  type Connection,
  type TransactionInstruction,
} from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { base58 } from '@metaplex-foundation/umi/serializers';
import type { Listing, Market } from './cardBuyer.js';
import type { DasAsset } from './das.js';

/**
 * Collector Crypt's own marketplace (an Anchor program). Cards are Metaplex Core assets listed for
 * USDC; a buy needs only the buyer's signature. Layouts below were decoded from live listings and
 * buys; the price in the instruction must equal the listing's on-chain price, so a stale or
 * tampered API price can never make us pay more than we checked.
 */
export const CC_PROGRAM = new PublicKey('CcmRKTuZCGJBWQwMHvDYApBRvSZNHqGJXkznqpDTSQUr');
export const CC_BUY_CORE_DISCRIMINATOR = createHash('sha256').update('global:buy_core').digest().subarray(0, 8);
export const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
export const CC_TREASURY = new PublicKey('8373hLiAEXxaJ3oV7SRzx4KHwurEg9rEG98tUPj1sdtX');
export const MPL_CORE_PROGRAM = new PublicKey('CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d');
const LISTING_DISCRIMINATOR = 'da2032492b861a3a';
const LISTING_SIZE = 162;
const COLLECTION_TYPE_CORE = 3;

export const ccMarketPda = () => PublicKey.findProgramAddressSync([Buffer.from('market')], CC_PROGRAM)[0];
export const ccWhitelistPda = (collection: PublicKey) =>
  PublicKey.findProgramAddressSync([Buffer.from('whitelist_entry'), ccMarketPda().toBuffer(), Buffer.from('CoreNFT'), collection.toBuffer()], CC_PROGRAM)[0];
export const ccListingPda = (asset: PublicKey, seller: PublicKey) =>
  PublicKey.findProgramAddressSync([Buffer.from('listing'), asset.toBuffer(), seller.toBuffer()], CC_PROGRAM)[0];

export interface OnChainListing {
  seller: string;
  nft: string;
  collection: string;
  priceUsdc: bigint;
  collectionType: number;
  /** Who paid the listing's rent. The buy must return the rent to this account (Collector Crypt sponsors some listings). */
  rentPayer: string;
}

/** Pure: parses a listing account, or throws if it is not a Collector Crypt listing. */
export function parseListing(owner: string, data: Buffer): OnChainListing {
  if (owner !== CC_PROGRAM.toBase58()) throw new Error('listing account is not owned by the Collector Crypt marketplace');
  if (data.length !== LISTING_SIZE || data.subarray(0, 8).toString('hex') !== LISTING_DISCRIMINATOR) throw new Error('not a listing account');
  return {
    seller: new PublicKey(data.subarray(8, 40)).toBase58(),
    nft: new PublicKey(data.subarray(40, 72)).toBase58(),
    collection: new PublicKey(data.subarray(72, 104)).toBase58(),
    collectionType: data[113]!,
    priceUsdc: data.readBigUInt64LE(105),
    rentPayer: new PublicKey(data.subarray(130, 162)).toBase58(),
  };
}

/** Pure: the buy_core instruction. `expectedPrice` is USDC base units (6 decimals). */
export function buyCoreInstruction(p: { buyer: PublicKey; seller: PublicKey; rentReceiver: PublicKey; asset: PublicKey; collection: PublicKey; expectedPrice: bigint }): TransactionInstruction {
  const data = Buffer.alloc(16);
  CC_BUY_CORE_DISCRIMINATOR.copy(data, 0);
  data.writeBigUInt64LE(p.expectedPrice, 8);
  const ata = (owner: PublicKey) => getAssociatedTokenAddressSync(USDC_MINT, owner, true);
  const meta = (pubkey: PublicKey, isWritable: boolean, isSigner = false) => ({ pubkey, isWritable, isSigner });
  return {
    programId: CC_PROGRAM,
    data,
    keys: [
      meta(p.buyer, true, true),
      meta(p.seller, true),
      meta(p.rentReceiver, true), // listing_rent_receiver: the listing's rent payer, not always the seller
      meta(p.buyer, true, true), // rent_payer
      meta(ccMarketPda(), false),
      meta(ccWhitelistPda(p.collection), false),
      meta(p.asset, true),
      meta(p.collection, true),
      meta(ccListingPda(p.asset, p.seller), true),
      meta(USDC_MINT, false),
      meta(ata(p.buyer), true),
      meta(ata(p.seller), true),
      meta(CC_TREASURY, false),
      meta(ata(CC_TREASURY), true),
      meta(MPL_CORE_PROGRAM, false),
      meta(ASSOCIATED_TOKEN_PROGRAM_ID, false),
      meta(TOKEN_PROGRAM_ID, false),
      meta(SystemProgram.programId, false),
    ],
  } as TransactionInstruction;
}

export interface CollectorCryptConfig {
  /** Core collection and update authority we pin; a listing for anything else is refused. */
  collection: string;
  /** Listing pages of 30 to read per tick. */
  pages: number;
  /** Only ask the API for this category (for example 'Pokemon'). The buyer still checks the Category trait on chain. */
  category?: string;
  fetchImpl?: typeof fetch;
}

interface ApiItem {
  nftAddress?: string;
  nftStandard?: string;
  type?: string;
  category?: string;
  itemName?: string;
  grade?: string;
  insuredValue?: string | number;
  listing?: { price?: number; currency?: string; marketplace?: string; sellerId?: string };
  owner?: { wallet?: string };
  image?: string;
}

const STEP = 30;

/** Pure: an API item as a Listing, or null for anything that is not a plain USDC card listing. */
export function toListing(it: ApiItem, solUsd: number): Listing | null {
  const price = it.listing?.price;
  const seller = it.owner?.wallet ?? it.listing?.sellerId;
  if (!it.nftAddress || !seller || it.nftStandard !== 'core' || it.listing?.currency !== 'USDC') return null;
  if (typeof price !== 'number' || !(price > 0) || !(solUsd > 0)) return null;
  const priceUsdc = BigInt(Math.round(price * 1e6));
  return {
    mint: it.nftAddress,
    seller,
    // SOL-equivalent at the current rate, rounded up: used for caps, the weekly budget and the books.
    priceLamports: BigInt(Math.ceil((Number(priceUsdc) * 1000) / solUsd)),
    priceUsdc,
    name: it.itemName ?? 'Collector Crypt card',
    image: it.image ?? null,
    // 'The Grade' is what the on-chain metadata calls it; 'Grade' is kept for older settings.
    attributes: { Type: it.type ?? '', Category: it.category ?? '', 'Insured Value': String(it.insuredValue ?? ''), Grade: it.grade ?? '', 'The Grade': it.grade ?? '' },
    raw: {},
  };
}

/** Collector Crypt's public listings API. Everything it returns is untrusted: prices are re-read on chain. */
export function createCollectorCrypt(cfg: CollectorCryptConfig): Market {
  const f = cfg.fetchImpl ?? fetch;
  return {
    async listings(solUsd: number) {
      const out: Listing[] = [];
      for (let page = 1; page <= cfg.pages; page++) {
        const q = new URLSearchParams({ page: String(page), step: String(STEP) });
        if (cfg.category) q.append('categories[]', cfg.category);
        const res = await f(`https://api.collectorcrypt.com/marketplace?${q}`, {
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) throw new Error(`Collector Crypt ${res.status} for /marketplace`);
        const body = (await res.json()) as { filterNFtCard?: ApiItem[] };
        const rows = body.filterNFtCard;
        if (!Array.isArray(rows) || rows.length === 0) break;
        for (const r of rows) {
          const l = toListing(r, solUsd);
          if (l) out.push(l);
        }
        if (rows.length < STEP) break;
      }
      return out.sort((a, b) => (a.priceLamports < b.priceLamports ? -1 : a.priceLamports > b.priceLamports ? 1 : 0));
    },
  };
}

/**
 * Builds the unsigned buy transaction for a listing: re-reads the listing account on chain,
 * refuses it unless seller, asset, pinned collection, Core type and price all match, then
 * creates the buyer's USDC account if needed and calls buy_core at the on-chain price.
 */
export function createBuyCoreBuilder(cfg: { connection: Connection; collection: string }) {
  return async (listing: Listing, buyerKey: string): Promise<Uint8Array> => {
    if (listing.priceUsdc === undefined) throw new Error('listing has no USDC price');
    const buyer = new PublicKey(buyerKey);
    const asset = new PublicKey(listing.mint);
    const seller = new PublicKey(listing.seller);
    const collection = new PublicKey(cfg.collection);
    const acct = await cfg.connection.getAccountInfo(ccListingPda(asset, seller), 'confirmed');
    if (!acct) throw new Error('listing no longer exists on chain');
    const l = parseListing(acct.owner.toBase58(), acct.data);
    if (l.seller !== listing.seller || l.nft !== listing.mint) throw new Error('on-chain listing does not match');
    if (l.collection !== cfg.collection) throw new Error(`listing collection ${l.collection} is not the pinned collection`);
    if (l.collectionType !== COLLECTION_TYPE_CORE) throw new Error('listing is not a Core asset');
    if (l.priceUsdc !== listing.priceUsdc) throw new Error(`on-chain price ${l.priceUsdc} differs from the checked price ${listing.priceUsdc}`);
    const { blockhash } = await cfg.connection.getLatestBlockhash('confirmed');
    const msg = new TransactionMessage({
      payerKey: buyer,
      recentBlockhash: blockhash,
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 150_000 }),
        createAssociatedTokenAccountIdempotentInstruction(buyer, getAssociatedTokenAddressSync(USDC_MINT, buyer), buyer, USDC_MINT),
        buyCoreInstruction({ buyer, seller, rentReceiver: new PublicKey(l.rentPayer), asset, collection, expectedPrice: l.priceUsdc }),
      ],
    }).compileToV0Message();
    return new VersionedTransaction(msg).serialize();
  };
}

const LISTING_ACCOUNTS_CAP = 20_000;

/**
 * Listings read straight from the marketplace program, not from the website's API (which returns
 * unlisted items first when sorted by price and only a first page when filtered by category).
 * One getProgramAccounts call finds every listing of the pinned Core collection; the cheapest
 * under `maxPriceUsd` get their traits from DAS, and the buyer's usual checks run on those.
 */
export function createOnChainListings(cfg: {
  connection: Connection;
  collection: string;
  /** DAS getAssetBatch: traits come from the asset's own metadata. */
  getAssets: (ids: string[]) => Promise<DasAsset[]>;
  maxPriceUsd: number;
  /** How many of the cheapest listings to look up per tick. */
  limit: number;
}): Market {
  return {
    async listings(solUsd: number) {
      const accounts = await cfg.connection.getProgramAccounts(CC_PROGRAM, {
        commitment: 'confirmed',
        filters: [
          { dataSize: LISTING_SIZE },
          { memcmp: { offset: 0, bytes: base58.deserialize(Buffer.from(LISTING_DISCRIMINATOR, 'hex'))[0] } },
          { memcmp: { offset: 72, bytes: cfg.collection } },
          { memcmp: { offset: 113, bytes: base58.deserialize(Uint8Array.of(COLLECTION_TYPE_CORE))[0] } },
        ],
      });
      if (accounts.length > LISTING_ACCOUNTS_CAP) throw new Error(`${accounts.length} listing accounts is more than expected; refusing to read them all`);
      const maxMicro = BigInt(Math.floor(cfg.maxPriceUsd * 1e6));
      const parsed = [];
      for (const a of accounts) {
        try {
          const l = parseListing(a.account.owner.toBase58(), a.account.data);
          if (l.collection === cfg.collection && l.collectionType === COLLECTION_TYPE_CORE && l.priceUsdc > 0n && l.priceUsdc <= maxMicro) parsed.push(l);
        } catch {
          // not a listing we understand: skip it
        }
      }
      parsed.sort((a, b) => (a.priceUsdc < b.priceUsdc ? -1 : a.priceUsdc > b.priceUsdc ? 1 : 0));
      const cheapest = parsed.slice(0, cfg.limit);
      const byId = new Map<string, DasAsset>();
      for (let i = 0; i < cheapest.length; i += 100) {
        for (const asset of await cfg.getAssets(cheapest.slice(i, i + 100).map((l) => l.nft))) byId.set(asset.id, asset);
      }
      const out: Listing[] = [];
      for (const l of cheapest) {
        const asset = byId.get(l.nft);
        if (!asset || !(solUsd > 0)) continue;
        const attributes: Record<string, string> = {};
        for (const a of asset.content?.metadata?.attributes ?? []) attributes[a.trait_type] = String(a.value);
        out.push({
          mint: l.nft,
          seller: l.seller,
          priceLamports: BigInt(Math.ceil((Number(l.priceUsdc) * 1000) / solUsd)),
          priceUsdc: l.priceUsdc,
          name: asset.content?.metadata?.name ?? 'Collector Crypt card',
          image: asset.content?.links?.image ?? null,
          attributes,
          raw: {},
        });
      }
      return out;
    },
  };
}
