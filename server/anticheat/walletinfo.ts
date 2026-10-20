import type { KV } from "./store";

export interface WalletInfo {
  /** Block time of the wallet's first transaction, epoch ms; null if it has no history. */
  firstTxAt: number | null;
  /** Address that funded the wallet in its first transaction, if we could tell. */
  funder: string | null;
}

export interface WalletInfoSource {
  get(address: string): Promise<WalletInfo | null>;
}

const MAX_PAGES = 3;
const CACHE_TTL_S = 30 * 24 * 3600;

interface RpcSig {
  signature: string;
  blockTime: number | null;
}
interface RpcTx {
  transaction: { message: { accountKeys: (string | { pubkey: string })[] } };
  meta: { preBalances: number[]; postBalances: number[] } | null;
}

/**
 * Wallet age + funder from a Solana RPC (Helius recommended). Env: HELIUS_RPC_URL (full URL incl. api key).
 * Cached in Redis per wallet. Any error or timeout returns null, and the sybil check skips these signals.
 * Wallets with more than MAX_PAGES*1000 transactions are old by definition; funder is left null.
 */
export function rpcWalletInfo(kv: KV, keyPrefix: string, timeoutMs: number, rpcUrl = process.env.HELIUS_RPC_URL): WalletInfoSource {
  async function rpc<T>(method: string, params: unknown[]): Promise<T> {
    const res = await fetch(rpcUrl!, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = (await res.json()) as { result?: T; error?: unknown };
    if (body.error !== undefined || body.result === undefined) throw new Error(`${method} failed`);
    return body.result;
  }

  async function lookup(address: string): Promise<WalletInfo> {
    let before: string | undefined;
    let oldest: RpcSig | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const sigs = await rpc<RpcSig[]>("getSignaturesForAddress", [address, { limit: 1000, ...(before ? { before } : {}) }]);
      if (sigs.length === 0) break;
      oldest = sigs[sigs.length - 1];
      if (sigs.length < 1000) {
        before = undefined;
        break;
      }
      before = oldest!.signature;
    }
    if (!oldest) return { firstTxAt: null, funder: null };
    if (before) return { firstTxAt: 0, funder: null }; // ran out of pages: very active, old wallet
    const tx = await rpc<RpcTx | null>("getTransaction", [oldest.signature, { encoding: "json", maxSupportedTransactionVersion: 0 }]);
    let funder: string | null = null;
    if (tx?.meta) {
      const keys = tx.transaction.message.accountKeys.map((k) => (typeof k === "string" ? k : k.pubkey));
      let biggestDrop = 0;
      keys.forEach((k, i) => {
        const drop = (tx.meta!.preBalances[i] ?? 0) - (tx.meta!.postBalances[i] ?? 0);
        if (k !== address && drop > biggestDrop) {
          biggestDrop = drop;
          funder = k;
        }
      });
    }
    return { firstTxAt: oldest.blockTime ? oldest.blockTime * 1000 : null, funder };
  }

  return {
    async get(address) {
      if (!rpcUrl) return null;
      const key = `${keyPrefix}wallet:${address}`;
      const cached = await kv.get(key);
      if (cached) return JSON.parse(cached) as WalletInfo;
      try {
        const info = await lookup(address);
        // A wallet with no history may get one soon; only cache it briefly.
        await kv.set(key, JSON.stringify(info), { exSec: info.firstTxAt === null ? 600 : CACHE_TTL_S });
        return info;
      } catch {
        return null;
      }
    },
  };
}
