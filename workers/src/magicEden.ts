import type { Listing, Market } from './cardBuyer.js';

/**
 * Magic Eden's public Solana API: Collector Crypt listings, and the buy-now transaction for one.
 * Everything it returns is untrusted: the buyer checks prices itself and simulates every transaction.
 */

const BASE = 'https://api-mainnet.magiceden.dev/v2';

export interface MagicEdenConfig {
  collection: string;
  apiKey: string | undefined;
  /** Listing pages of 100 to read per tick, cheapest first. */
  pages: number;
  /** Traits to filter on server-side as well (the buyer re-checks them). */
  requiredTraits: Record<string, string>;
  fetchImpl?: typeof fetch;
}

interface MeListing {
  tokenMint: string;
  tokenAddress: string;
  seller: string;
  sellerReferral?: string;
  auctionHouse?: string;
  price: number;
  expiry?: number;
  token?: { name?: string; image?: string; attributes?: Array<{ trait_type: string; value: unknown }> };
}

export function toListing(l: MeListing): Listing | null {
  if (!l.tokenMint || !l.seller || typeof l.price !== 'number' || !(l.price > 0)) return null;
  const attributes: Record<string, string> = {};
  for (const a of l.token?.attributes ?? []) attributes[a.trait_type] = String(a.value);
  return {
    mint: l.tokenMint,
    seller: l.seller,
    // Rounded so float noise in the API's SOL price never makes us bid a lamport under the listing.
    priceLamports: BigInt(Math.round(l.price * 1e9)),
    name: l.token?.name ?? 'Collector Crypt card',
    image: l.token?.image ?? null,
    attributes,
    raw: { tokenAddress: l.tokenAddress, auctionHouse: l.auctionHouse ?? '', sellerReferral: l.sellerReferral ?? '', expiry: l.expiry ?? -1, price: l.price },
  };
}

export function createMagicEden(cfg: MagicEdenConfig): Market & { buildBuyTx(listing: Listing, buyer: string): Promise<Uint8Array> } {
  const f = cfg.fetchImpl ?? fetch;
  const headers: Record<string, string> = { accept: 'application/json' };
  if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`;

  const get = async (url: string): Promise<unknown> => {
    const res = await f(url, { headers, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`Magic Eden ${res.status} for ${url.replace(/\?.*/, '')}`);
    return res.json();
  };

  return {
    async listings() {
      const out: Listing[] = [];
      const traits = Object.entries(cfg.requiredTraits).map(([traitType, value]) => ({ traitType, value }));
      for (let page = 0; page < cfg.pages; page++) {
        const q = new URLSearchParams({ offset: String(page * 100), limit: '100', sort: 'listPrice', sort_direction: 'asc' });
        if (traits.length) q.set('attributes', JSON.stringify([traits]));
        const rows = (await get(`${BASE}/collections/${encodeURIComponent(cfg.collection)}/listings?${q}`)) as MeListing[];
        if (!Array.isArray(rows) || rows.length === 0) break;
        for (const r of rows) {
          const l = toListing(r);
          if (l) out.push(l);
        }
        if (rows.length < 100) break;
      }
      return out;
    },

    async buildBuyTx(listing, buyer) {
      const r = listing.raw as { tokenAddress: string; auctionHouse: string; sellerReferral: string; expiry: number; price: number };
      const q = new URLSearchParams({
        buyer,
        seller: listing.seller,
        auctionHouseAddress: r.auctionHouse,
        tokenMint: listing.mint,
        tokenATA: r.tokenAddress,
        price: String(r.price),
        sellerReferral: r.sellerReferral,
        sellerExpiry: String(r.expiry),
      });
      const body = (await get(`${BASE}/instructions/buy_now?${q}`)) as Record<string, unknown>;
      // Prefer the copy the marketplace already co-signed; v0 responses nest it one level down.
      const pick = (o: Record<string, unknown> | undefined) => (o?.txSigned ?? o?.tx) as { data?: number[] } | undefined;
      const buf = pick(body.v0 as Record<string, unknown> | undefined) ?? pick(body);
      if (!buf?.data?.length) throw new Error('Magic Eden returned no transaction');
      return Uint8Array.from(buf.data);
    },
  };
}

/** SOL/USD from Jupiter's public price API. The buyer bounds-checks it and caps every card in SOL too. */
export async function jupiterSolUsd(fetchImpl: typeof fetch = fetch): Promise<number> {
  const SOL = 'So11111111111111111111111111111111111111112';
  const res = await fetchImpl(`https://lite-api.jup.ag/price/v3?ids=${SOL}`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Jupiter price ${res.status}`);
  const body = (await res.json()) as Record<string, { usdPrice?: number }>;
  const p = body[SOL]?.usdPrice;
  if (typeof p !== 'number') throw new Error('Jupiter returned no SOL price');
  return p;
}
