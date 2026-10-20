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
  /**
   * The Squads vault address (the vault PDA, not the multisig account). Read-only here: inventory
   * sync lists its cards so vault cards that go missing are reported. No key for it ever lives here.
   */
  SQUADS_VAULT_ADDRESS: base58Address.optional(),
  /** Squads multisig account (not the vault). With SQUADS_PROPOSER_SECRET_KEY, turns on the top-up proposer. */
  SQUADS_MULTISIG_ADDRESS: base58Address.optional(),
  /**
   * Key of a multisig member with the Initiate permission ONLY. It drafts top-ups and pays their
   * rent; signers approve and execute. The worker refuses to start if it can vote or execute.
   */
  SQUADS_PROPOSER_SECRET_KEY: z.string().min(1).optional(),
  /** Wanted available cards per tier in the hot wallet, e.g. common:10,uncommon:4,rare:2,grail:1 */
  /** The worker refuses a multisig whose approval threshold is lower than this. */
  SQUADS_MIN_THRESHOLD: z.coerce.number().int().min(2).default(2),
  TOPUP_TARGETS: z.string().default('common:10,uncommon:4,rare:2,grail:1'),
  TOPUP_MAX_CARDS: z.coerce.number().int().min(1).max(20).default(10),
  TOPUP_MAX_USD: z.coerce.number().min(0).default(500),
  TOPUP_MIN_HOT_SOL: z.coerce.number().min(0).default(0.05),
  TOPUP_SOL_AMOUNT: z.coerce.number().min(0).max(5).default(0.1),
  TOPUP_INTERVAL_MS: z.coerce.number().int().min(60_000).default(600_000),
  /** The pump.fun coin whose creator fees go to the vault. With FEE_CLAIMER_SECRET_KEY, turns on the fee claimer. */
  PUMP_COIN_MINT: base58Address.optional(),
  /** Gas-only wallet for the fee claimer. Fees never pass through it. */
  FEE_CLAIMER_SECRET_KEY: z.string().min(1).optional(),
  FEE_CLAIM_INTERVAL_MS: z.coerce.number().int().min(600_000).default(3 * 3600_000),
  /** Skip claims smaller than this many base units of the quote asset. */
  FEE_CLAIM_MIN_BASE_UNITS: z.string().regex(/^\d{1,30}$/).default('1'),
  /** Refuse to claim unless the vault's share of the fees is at least this (10000 = 100%). */
  FEE_MIN_VAULT_SHARE_BPS: z.coerce.number().int().min(1).max(10_000).default(10_000),
  FEE_CLAIMER_MIN_GAS_SOL: z.coerce.number().min(0).default(0.005),
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

export type Config = Omit<z.infer<typeof EnvSchema>, 'PRIZE_COLLECTIONS' | 'TOPUP_TARGETS'> & {
  PRIZE_COLLECTIONS: string[];
  TOPUP_TARGETS: Record<'common' | 'uncommon' | 'rare' | 'grail', number>;
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
  if (Boolean(parsed.data.SQUADS_MULTISIG_ADDRESS) !== Boolean(parsed.data.SQUADS_PROPOSER_SECRET_KEY)) {
    throw new Error('Invalid worker environment:\n  set both SQUADS_MULTISIG_ADDRESS and SQUADS_PROPOSER_SECRET_KEY, or neither');
  }
  if (Boolean(parsed.data.PUMP_COIN_MINT) !== Boolean(parsed.data.FEE_CLAIMER_SECRET_KEY)) {
    throw new Error('Invalid worker environment:\n  set both PUMP_COIN_MINT and FEE_CLAIMER_SECRET_KEY, or neither');
  }
  if (parsed.data.PUMP_COIN_MINT && !parsed.data.SQUADS_VAULT_ADDRESS) {
    throw new Error('Invalid worker environment:\n  the fee claimer needs SQUADS_VAULT_ADDRESS');
  }
  return { ...parsed.data, PRIZE_COLLECTIONS: collections, TOPUP_TARGETS: parseTargets(parsed.data.TOPUP_TARGETS) };
}

export function parseTargets(raw: string): Config['TOPUP_TARGETS'] {
  const out = { common: 0, uncommon: 0, rare: 0, grail: 0 };
  for (const part of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = /^(common|uncommon|rare|grail):(\d{1,3})$/.exec(part);
    if (!m) throw new Error(`Invalid worker environment:\n  TOPUP_TARGETS: bad entry "${part}"`);
    out[m[1] as keyof typeof out] = Number(m[2]);
  }
  return out;
}

export function parseSecretKey(raw: string, name = 'HOT_WALLET_SECRET_KEY'): Uint8Array {
  const trimmed = raw.trim();
  if (trimmed.startsWith('[')) {
    // JSON.parse and zod both quote the input in their errors; never let a key fragment reach the logs.
    let bytes: number[];
    try {
      bytes = z.array(z.number().int().min(0).max(255)).length(64).parse(JSON.parse(trimmed));
    } catch {
      throw new Error(`${name} is not a valid JSON array of 64 bytes`);
    }
    return Uint8Array.from(bytes);
  }
  return Uint8Array.from(base58Decode(trimmed, name));
}

// Small local decoder so key parsing has no failure path that could echo the key in an error.
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58Decode(s: string, name: string): number[] {
  const bytes: number[] = [0];
  for (const ch of s) {
    let carry = ALPHABET.indexOf(ch);
    if (carry < 0) throw new Error(`${name} is not valid base58`);
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
  if (out.length !== 64) throw new Error(`${name} must decode to 64 bytes`);
  return out;
}

export function isValidAddress(s: string): boolean {
  return base58Address.safeParse(s).success;
}
