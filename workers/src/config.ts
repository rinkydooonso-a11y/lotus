import { z } from 'zod';

const base58Address = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, 'not a base58 Solana address');

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  /** Solana JSON-RPC endpoint used to send and confirm transactions. A Helius devnet URL works for both RPC and DAS. */
  SOLANA_RPC_URL: z.string().url(),
  /** Endpoint that answers Helius DAS calls (getAsset, getAssetsByOwner). Defaults to SOLANA_RPC_URL. */
  HELIUS_DAS_URL: z.string().url().optional(),
  /**
   * Hot wallet secret key, injected at runtime by the host's secret store (Railway/Fly secrets,
   * Doppler, AWS Secrets Manager...). Base58 string or a JSON byte array as written by solana-keygen.
   * Never commit it, never log it.
   */
  HOT_WALLET_SECRET_KEY: z.string().min(1),
  /**
   * Mainnet is refused unless this is set to exactly this phrase. Setting it is the human
   * confirmation required before any mainnet transaction.
   */
  LOTUS_ALLOW_MAINNET: z.string().optional(),
  /** Comma-separated collection addresses that count as prize inventory. Empty = every NFT in the hot wallet. */
  PRIZE_COLLECTIONS: z.string().optional().default(''),
  PRIZE_SENDER_INTERVAL_MS: z.coerce.number().int().min(1000).default(5000),
  PRIZE_SENDER_BATCH: z.coerce.number().int().min(1).max(50).default(10),
  PRIZE_SENDER_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(8),
  INVENTORY_SYNC_INTERVAL_MS: z.coerce.number().int().min(10_000).default(120_000),
  /** Location pings older than this are deleted hourly. Anti-cheat reads at most the last 6 hours. */
  PING_RETENTION_DAYS: z.coerce.number().int().min(1).default(30),
  /** Priority fee in micro-lamports per compute unit. */
  PRIORITY_FEE_MICROLAMPORTS: z.coerce.number().int().min(0).default(10_000),
});

export const MAINNET_CONFIRMATION_PHRASE = 'yes-send-real-prizes-on-mainnet';
export const MAINNET_GENESIS_HASH = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';

export type Config = Omit<z.infer<typeof EnvSchema>, 'PRIZE_COLLECTIONS'> & {
  PRIZE_COLLECTIONS: string[];
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    // Only report which variables are wrong, never their values.
    const fields = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid worker environment:\n  ${fields.join('\n  ')}`);
  }
  const collections = parsed.data.PRIZE_COLLECTIONS.split(',').map((s) => s.trim()).filter(Boolean);
  for (const c of collections) base58Address.parse(c);
  return { ...parsed.data, PRIZE_COLLECTIONS: collections };
}

export function parseSecretKey(raw: string): Uint8Array {
  const trimmed = raw.trim();
  if (trimmed.startsWith('[')) {
    const bytes = z.array(z.number().int().min(0).max(255)).length(64).parse(JSON.parse(trimmed));
    return Uint8Array.from(bytes);
  }
  return Uint8Array.from(base58Decode(trimmed));
}

// Small local decoder so key parsing has no failure path that could echo the key in an error.
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58Decode(s: string): number[] {
  const bytes: number[] = [0];
  for (const ch of s) {
    let carry = ALPHABET.indexOf(ch);
    if (carry < 0) throw new Error('HOT_WALLET_SECRET_KEY is not valid base58');
    for (let i = 0; i < bytes.length; i++) {
      carry += (bytes[i] ?? 0) * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (const ch of s) {
    if (ch !== '1') break;
    bytes.push(0);
  }
  const out = bytes.reverse();
  if (out.length !== 64) throw new Error('HOT_WALLET_SECRET_KEY must decode to 64 bytes');
  return out;
}

export function isValidAddress(s: string): boolean {
  return base58Address.safeParse(s).success;
}
