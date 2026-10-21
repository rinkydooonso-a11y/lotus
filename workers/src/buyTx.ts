import type { Listing } from './cardBuyer.js';

/** Builds an unsigned-by-us buy transaction for a listing, paid by `buyer`. The buyer gateway re-checks and simulates it. */
export type BuildBuyTx = (listing: Listing, buyer: string) => Promise<Uint8Array>;

/**
 * Picks how buy transactions are made: the marketplace's keyed API when an API key is set,
 * otherwise the local on-chain builder. Either way the gateway simulates and checks the result.
 */
export function selectBuildBuyTx(opts: { apiKey: string | undefined; keyed: BuildBuyTx; local: BuildBuyTx }): BuildBuyTx {
  return opts.apiKey ? opts.keyed : opts.local;
}
