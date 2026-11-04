import type { Pool } from 'pg';
import { coinHoldConfig, fetchCoinPriceUsd, fetchMintDecimals, isBase58Address, type CoinHoldConfig } from './coin';
import { getPool } from './db';

/**
 * Runtime settings kept in `app_settings`, so launch day is "paste the coin address" and not a redeploy.
 *
 *  - `coin_mint`: the coin's address. Overrides NEXT_PUBLIC_COIN_ADDRESS / COIN_MINT when present.
 *  - `hold_gate`: 'off' keeps the address public (buy button, CA chip) but lets everyone open crates,
 *    for the minutes before the price feed knows a brand-new coin. Anything else means on.
 *
 * Reads are cached for a few seconds per server instance, so a change reaches every instance quickly
 * and a busy site makes about one read per instance per few seconds, not one per request.
 */

const TTL_MS = 5_000;
let cache: { at: number; mint: string | null; gateOff: boolean } | null = null;

/** Postgres "undefined_table": the migration has not been applied yet. */
const MISSING_TABLE = '42P01';

export interface CoinSettings {
  /** The coin address from the admin box, or null when none is set there. */
  mint: string | null;
  gateOff: boolean;
}

export async function readCoinSettings(db: Pool = getPool(), now: number = Date.now()): Promise<CoinSettings> {
  if (cache && now - cache.at < TTL_MS) return { mint: cache.mint, gateOff: cache.gateOff };
  try {
    const { rows } = await db.query<{ key: string; value: string }>(
      `SELECT key, value FROM app_settings WHERE key IN ('coin_mint', 'hold_gate')`,
    );
    const mintRaw = rows.find((r) => r.key === 'coin_mint')?.value.trim() ?? '';
    const mint = isBase58Address(mintRaw) ? mintRaw : null;
    const gateOff = rows.find((r) => r.key === 'hold_gate')?.value === 'off';
    cache = { at: now, mint, gateOff };
    return { mint, gateOff };
  } catch (err) {
    // Table not created yet: behave exactly as before this feature (environment only).
    if ((err as { code?: string }).code === MISSING_TABLE) return { mint: null, gateOff: false };
    throw err;
  }
}

/** The holder gate's configuration with the admin's settings applied; null when the gate is off. */
export async function resolveCoinHoldConfig(
  env: NodeJS.ProcessEnv = process.env,
  db: Pool = getPool(),
): Promise<CoinHoldConfig | null> {
  let s: CoinSettings;
  try {
    s = await readCoinSettings(db);
  } catch (err) {
    // The settings can't be read. If an address is fixed in the environment use it; otherwise refuse
    // rather than guess, because "no gate" would let everyone in on a coin that may be live.
    if (coinHoldConfig(env)) return coinHoldConfig(env);
    throw err;
  }
  if (s.gateOff) return null;
  return coinHoldConfig(env, s.mint);
}

/** The coin address the site should show: the admin's, else the environment's, else null. */
export async function currentCoinMint(env: NodeJS.ProcessEnv = process.env, db: Pool = getPool()): Promise<string | null> {
  try {
    const s = await readCoinSettings(db);
    if (s.mint) return s.mint;
  } catch {
    /* fall through to the environment */
  }
  const e = (env.COIN_MINT || env.NEXT_PUBLIC_COIN_ADDRESS || '').trim();
  return isBase58Address(e) ? e : null;
}

export interface CoinSetResult {
  mint: string | null;
  gate: 'on' | 'off';
  /** Dollar price the feed has for the coin right now, or null if it has none yet. */
  priceUsd: number | null;
  decimals: number | null;
}

/**
 * Sets (or clears, with null) the coin address and the gate switch. The address must be a real token
 * on chain, so a typo can't go live. Returns what the price feed says, so the admin can see whether the
 * gate will work before turning it on.
 */
export async function setCoinSettings(
  input: { mint: string | null; gate: 'on' | 'off' },
  db: Pool = getPool(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<CoinSetResult> {
  let priceUsd: number | null = null;
  let decimals: number | null = null;
  if (input.mint !== null) {
    if (!isBase58Address(input.mint)) throw new Error('That is not a valid address.');
    const rpcUrl = (env.SOLANA_RPC_URL ?? '').trim() || 'https://api.mainnet-beta.solana.com';
    const probe = { mint: input.mint, rpcUrl, priceUrl: (env.COIN_PRICE_URL ?? 'https://lite-api.jup.ag/price/v3').trim() } as CoinHoldConfig;
    try {
      decimals = await fetchMintDecimals(probe, fetch);
    } catch {
      throw new Error('That address is not a token on this network (or the node could not be reached). Check it and try again.');
    }
    try {
      priceUsd = await fetchCoinPriceUsd(probe);
    } catch {
      priceUsd = null; // brand-new coins take a little while to be priced
    }
  }
  if (input.mint === null) {
    await db.query(`DELETE FROM app_settings WHERE key = 'coin_mint'`);
  } else {
    await db.query(
      `INSERT INTO app_settings (key, value) VALUES ('coin_mint', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [input.mint],
    );
  }
  await db.query(
    `INSERT INTO app_settings (key, value) VALUES ('hold_gate', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [input.gate],
  );
  cache = null;
  return { mint: input.mint, gate: input.gate, priceUsd, decimals };
}

/** Tests: forget the cached settings. */
export function resetSettingsCache(): void {
  cache = null;
}
