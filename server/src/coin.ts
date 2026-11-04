/**
 * Our coin: configuration, on-chain balance, and price.
 *
 * Everything here is dormant until COIN_MINT is set. `coinHoldConfig()` returning null is the one
 * switch that turns the holder gate off, which is what keeps the site playable before the coin
 * exists (see holding.ts).
 *
 * Both lookups go out over plain fetch rather than a Solana client library: the server package has
 * no web3 dependency, these are two read-only calls, and keeping it that way means the web app's
 * request path doesn't pull in a wallet SDK.
 */

/** A 32–44 character base58 address. Narrow enough to catch a typo'd env var. */
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function isBase58Address(s: string): boolean {
  return BASE58.test(s);
}

export interface CoinHoldConfig {
  mint: string;
  /** USD a wallet must hold to open a crate. */
  requiredUsd: number;
  /** How long a qualifying check stands for. The required token amount is fixed for this long. */
  windowMs: number;
  /** Inside a window, how stale a balance check may be before it is taken again. */
  recheckMs: number;
  rpcUrl: string;
  priceUrl: string;
}

function num(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * The holder gate's configuration, or null when it is switched off.
 *
 * Off means: no coin address (it does not exist yet), or LOTUS_HOLD_GATE=off. A missing or
 * malformed mint is not an error — before launch there is no coin to hold, and refusing every open
 * because an env var is unset would take the game down rather than open it up.
 */
export function coinHoldConfig(env: NodeJS.ProcessEnv = process.env, mintOverride?: string | null): CoinHoldConfig | null {
  if (env.LOTUS_HOLD_GATE === 'off') return null;
  // The same address the site shows (NEXT_PUBLIC_COIN_ADDRESS) switches the gate on, so setting it
  // once at launch is enough. The site's placeholder text is not base58, so it reads as "no coin".
  // The admin box (app_settings) takes precedence over the environment when it has an address.
  const mint = (mintOverride || env.COIN_MINT || env.NEXT_PUBLIC_COIN_ADDRESS || '').trim();
  if (!mint || !BASE58.test(mint)) return null;
  // A coin address with no RPC configured must not leave the gate silently off, so fall back to the
  // public endpoint. It is rate limited, which is why SOLANA_RPC_URL should be set for real traffic.
  const rpcUrl = (env.SOLANA_RPC_URL ?? '').trim() || 'https://api.mainnet-beta.solana.com';
  return {
    mint,
    requiredUsd: num(env, 'LOTUS_HOLD_REQUIRED_USD', 25),
    windowMs: num(env, 'LOTUS_HOLD_WINDOW_HOURS', 48) * 3_600_000,
    recheckMs: num(env, 'LOTUS_HOLD_RECHECK_MIN', 10) * 60_000,
    rpcUrl,
    priceUrl: (env.COIN_PRICE_URL ?? 'https://lite-api.jup.ag/price/v3').trim(),
  };
}

export interface CoinBalance {
  /** Total across every token account the wallet owns for this mint, in base units. */
  baseUnits: bigint;
  decimals: number;
}

interface RpcTokenAccounts {
  result?: { value?: { account?: { data?: { parsed?: { info?: { tokenAmount?: { amount?: string; decimals?: number } } } } } }[] };
  error?: { message?: string };
}

/**
 * What a wallet holds of the coin, summed over all of its token accounts for that mint.
 *
 * Throws on any RPC trouble rather than returning zero: "we could not read the chain" and "they
 * hold nothing" must not look the same to the caller, or an RPC outage would lock everybody out
 * (or, worse, let everybody in).
 */
export async function fetchCoinBalance(
  owner: string,
  cfg: CoinHoldConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<CoinBalance> {
  const res = await fetchImpl(cfg.rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getTokenAccountsByOwner',
      params: [owner, { mint: cfg.mint }, { encoding: 'jsonParsed', commitment: 'confirmed' }],
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`coin balance RPC ${res.status}`);
  const body = (await res.json()) as RpcTokenAccounts;
  if (body.error) throw new Error(`coin balance RPC: ${body.error.message ?? 'error'}`);
  const accounts = body.result?.value;
  if (!Array.isArray(accounts)) throw new Error('coin balance RPC returned no account list');

  let baseUnits = 0n;
  let decimals: number | null = null;
  for (const a of accounts) {
    const amt = a.account?.data?.parsed?.info?.tokenAmount;
    if (!amt || typeof amt.amount !== 'string' || typeof amt.decimals !== 'number') {
      throw new Error('coin balance RPC returned an unreadable token amount');
    }
    baseUnits += BigInt(amt.amount);
    decimals = amt.decimals;
  }
  // No token account at all is a real answer: they hold none. Decimals then come from the mint.
  return { baseUnits, decimals: decimals ?? (await fetchMintDecimals(cfg, fetchImpl)) };
}

interface RpcSupply {
  result?: { value?: { decimals?: number } };
  error?: { message?: string };
}

export async function fetchMintDecimals(cfg: CoinHoldConfig, fetchImpl: typeof fetch): Promise<number> {
  const res = await fetchImpl(cfg.rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTokenSupply', params: [cfg.mint] }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`coin supply RPC ${res.status}`);
  const body = (await res.json()) as RpcSupply;
  const d = body.result?.value?.decimals;
  if (typeof d !== 'number') throw new Error(`coin supply RPC: ${body.error?.message ?? 'no decimals'}`);
  return d;
}

/** Coin price in USD. Throws when the feed is unreachable or has no price for the mint. */
export async function fetchCoinPriceUsd(
  cfg: CoinHoldConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<number> {
  const res = await fetchImpl(`${cfg.priceUrl}?ids=${cfg.mint}`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`coin price ${res.status}`);
  const body = (await res.json()) as Record<string, { usdPrice?: number } | undefined>;
  const p = body[cfg.mint]?.usdPrice;
  if (typeof p !== 'number' || !Number.isFinite(p) || p <= 0) throw new Error('coin price feed has no price');
  return p;
}

/**
 * Base units of the coin that `usd` buys at `price`, rounded up.
 *
 * Rounded up so the gate is never a hair under the advertised dollar figure, and computed with
 * integer arithmetic on the scaled price: doing it as usd / price * 10**decimals in floating point
 * loses the low digits on a sub-cent coin, which is exactly the kind of coin this will be.
 */
export function requiredBaseUnits(usd: number, price: number, decimals: number): bigint {
  if (!(usd > 0) || !(price > 0)) throw new Error('requiredBaseUnits needs a positive usd and price');
  // Both sides scaled by 1e12, so the factor cancels and the division is exact integer work.
  const scaledPrice = BigInt(Math.round(price * 1e12));
  if (scaledPrice <= 0n) throw new Error(`coin price ${price} is too small to price a holding`);
  const scaledUsd = BigInt(Math.round(usd * 1e12)) * 10n ** BigInt(decimals);
  return (scaledUsd + scaledPrice - 1n) / scaledPrice; // ceil
}

/** Base units as a human amount of coin, for messages. */
export function toUiAmount(baseUnits: bigint, decimals: number): number {
  return Number(baseUnits) / 10 ** decimals;
}
