import { z } from 'zod';

const base58Address = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, 'not a base58 Solana address');

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  /**
   * Optional direct (non-pooler) connection string, used only for the prize-sender lock, e.g.
   * postgresql://postgres:PASSWORD@db.<ref>.supabase.co:5432/postgres. Falls back to DATABASE_URL.
   */
  DATABASE_LOCK_URL: z.string().optional().transform((v) => v || undefined),
  /** Solana JSON-RPC endpoint used to send and confirm transactions. A Helius devnet URL works for both RPC and DAS. */
  SOLANA_RPC_URL: z.string().url(),
  /** Endpoint that answers Helius DAS calls (getAsset, getAssetsByOwner). Defaults to SOLANA_RPC_URL. */
  HELIUS_DAS_URL: z.string().url().optional(),
  /**
   * Hot wallet secret key, injected at runtime by the host's secret store (Fly secrets,
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
  /** The worker refuses a multisig whose approval threshold is lower than this. 1 only for a deliberately single-signer safe. */
  SQUADS_MIN_THRESHOLD: z.coerce.number().int().min(1).default(2),
  /** Must be exactly SINGLE_SIGNER_PHRASE for SQUADS_MIN_THRESHOLD=1. */
  SQUADS_ALLOW_SINGLE_SIGNER: z.string().optional(),
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
  FEE_CLAIM_INTERVAL_MS: z.coerce.number().int().min(600_000).default(600_000),
  /** Skip claims smaller than this many base units of the quote asset. */
  FEE_CLAIM_MIN_BASE_UNITS: z.string().regex(/^\d{1,30}$/).default('1'),
  /** Refuse to claim unless the vault's share of the fees is at least this (10000 = 100%). */
  FEE_MIN_VAULT_SHARE_BPS: z.coerce.number().int().min(1).max(10_000).default(10_000),
  /** Share of each fee claim that goes to the card fund the game pays prizes from (7000 = 70%). The rest stays in the vault. */
  FEE_CARD_FUND_BPS: z.coerce.number().int().min(0).max(10_000).default(7_000),
  /** Float mode: share of each sweep swapped to USDC (the card fund); the rest becomes SOL and stays in the wallet (3000 = 30%). 0 = old rule. */
  FEE_USDC_SHARE_BPS: z.coerce.number().int().min(0).max(10_000).default(0),
  FEE_CLAIMER_MIN_GAS_SOL: z.coerce.number().min(0).default(0.005),
  /**
   * Squads spending limit the hot wallet may draw on to buy cards. With SQUADS_MULTISIG_ADDRESS,
   * turns on the card buyer. The limit itself (amount per period) is set on chain by the signers.
   */
  BUYER_SPENDING_LIMIT: base58Address.optional(),
  /**
   * One-wallet mode: HOT_WALLET_SECRET_KEY is also the coin's creator, so it claims its own creator
   * fees (PUMP_COIN_MINT) and swaps them into SOL. 'yes' turns it on; no vault or Squads is involved.
   */
  ONE_WALLET_FEES: z.enum(['yes', 'no']).default('no'),
  /**
   * Float mode: the coin was launched on Float (Raydium LaunchLab) with HOT_WALLET_SECRET_KEY's address as the
   * fee recipient. Float's bot pays the creator share into that wallet's token account for the paired token, so
   * nothing is claimed; the worker only sweeps what lands there into SOL and credits the card fund.
   */
  FLOAT_FEES: z.enum(['yes', 'no']).default('no'),
  /** Float mode: the token the coin is paired with (its fees are paid in it). Defaults to wrapped SOL; CARDS is CARDSccUMFKoPRZxt5vt3ksUbxEFEcnZ3H2pd3dKxYjp. */
  FLOAT_PAIR_MINT: base58Address.default('So11111111111111111111111111111111111111112'),
  /** One-wallet mode: the card buyer spends the wallet's own SOL instead of drawing on a Squads spending limit. */
  ONE_WALLET_BUYER: z.enum(['yes', 'no']).default('no'),
  /** Slippage allowed when swapping claimed fee tokens into SOL. */
  FEE_SWAP_SLIPPAGE_BPS: z.coerce.number().int().min(1).max(1_000).default(100),
  /** A swap that Jupiter quotes with more price impact than this is not done (300 = 3%). */
  FEE_SWAP_MAX_IMPACT_BPS: z.coerce.number().int().min(1).max(5_000).default(300),
  /** Fee-token balances below this many base units are left to build up before swapping. */
  FEE_SWAP_MIN_BASE_UNITS: z.string().regex(/^\d{1,30}$/).default('1'),
  /**
   * How the stock value is split across tiers, as weights (they need not sum to 100). The stock
   * itself is sized from the prize pool, so there are no fixed card counts or dollar targets.
   */
  BUY_TIER_MIX: z.string().default('common:45,uncommon:30,rare:20,grail:5'),
  /** The pool pays out over this many days. Must match LOTUS_POOL_PAYOUT_DAYS on the game server. */
  LOTUS_POOL_PAYOUT_DAYS: z.coerce.number().min(1).default(14),
  /** Days of a day's release the hot wallet holds in cards. */
  BUY_STOCK_DAYS: z.coerce.number().positive().default(1),
  /** The game's fixed daily prize budget in USD. Must match LOTUS_MAX_CARD_VALUE_PER_DAY on the game server. The buyer keeps BUY_STOCK_DAYS of it in stock. 0 = use pool / LOTUS_POOL_PAYOUT_DAYS. */
  LOTUS_MAX_CARD_VALUE_PER_DAY: z.coerce.number().min(0).default(500),
  /** Lowest insured value (USD) for each tier. Same bands as the game's tiers (server tierForValue). */
  BUY_TIER_MIN_USD: z.string().default('common:0,uncommon:30,rare:75,grail:300'),
  /** Traits a listing must have, e.g. "Type=Card;Grading Company=PSA". */
  BUY_REQUIRED_TRAITS: z.string().default(''),
  BUY_VALUE_TRAIT: z.string().min(1).default('Insured Value'),
  /** The on-chain trait that holds the grade, for example "GEM MINT 10". */
  BUY_GRADE_TRAIT: z.string().default('The Grade'),
  /** The verified on-chain Collector Crypt collection and update authority. Required with the buyer. */
  BUY_COLLECTION_ADDRESS: base58Address.optional(),
  BUY_UPDATE_AUTHORITY: base58Address.optional(),
  /** Off-chain backstop: card spend over any 7 days, on top of the on-chain spending limit. */
  BUY_WEEKLY_MAX_SOL: z.coerce.number().positive().default(20),
  BUY_MAX_PRICE_TO_VALUE: z.coerce.number().positive().max(2).default(1),
  /** Hard top on one card, in USD (USDC). The buyer also never pays more than one day's release for a card. */
  BUY_MAX_USD_PER_CARD: z.coerce.number().positive().max(1000).default(1000),
  /** Slippage allowed on the SOL to USDC swap that funds a purchase. */
  BUY_SWAP_SLIPPAGE_BPS: z.coerce.number().int().min(1).max(500).default(100),
  BUY_MAX_SOL_PER_CARD: z.coerce.number().positive().max(100).default(10),
  BUY_MAX_CARDS_PER_TICK: z.coerce.number().int().min(1).max(20).default(10),
  BUY_MAX_OVERHEAD_BPS: z.coerce.number().int().min(0).max(2000).default(800),
  BUY_GAS_RESERVE_SOL: z.coerce.number().min(0).default(0.05),
  /** Where listings are found: the Collector Crypt website API, or the marketplace program's accounts (needs DAS). */
  BUY_LISTING_SOURCE: z.enum(['api', 'chain']).default('api'),
  /** With BUY_LISTING_SOURCE=chain: how many of the cheapest listings to look up per tick. */
  BUY_CHAIN_LISTING_LIMIT: z.coerce.number().int().min(1).max(1000).default(300),
  BUY_LISTING_PAGES: z.coerce.number().int().min(1).max(200).default(100),
  BUY_INTERVAL_MS: z.coerce.number().int().min(300_000).default(3_600_000),
  SOL_USD_MIN: z.coerce.number().positive().default(20),
  SOL_USD_MAX: z.coerce.number().positive().default(2000),
  MAGIC_EDEN_API_KEY: z.string().optional(),
  PRIZE_SENDER_INTERVAL_MS: z.coerce.number().int().min(1000).default(5000),
  PRIZE_SENDER_BATCH: z.coerce.number().int().min(1).max(50).default(10),
  PRIZE_SENDER_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(8),
  INVENTORY_SYNC_INTERVAL_MS: z.coerce.number().int().min(10_000).default(120_000),
  /** How often the world-crate seeder tops the launch cities up. */
  CRATE_SEED_INTERVAL_MS: z.coerce.number().int().min(60_000).default(300_000),
  /** OpenStreetMap lookups one seeder tick may make, across every city. */
  /** Location pings older than this are deleted hourly. Anti-cheat reads at most the last 6 hours. */
  PING_RETENTION_DAYS: z.coerce.number().int().min(1).default(30),
  /** Priority fee in micro-lamports per compute unit. */
  PRIORITY_FEE_MICROLAMPORTS: z.coerce.number().int().min(0).default(10_000),
});

export const SINGLE_SIGNER_PHRASE = 'yes-one-wallet-controls-the-vault';
export const MAINNET_CONFIRMATION_PHRASE = 'yes-send-real-prizes-on-mainnet';
export const MAINNET_GENESIS_HASH = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';

type TierNumbers = Record<'common' | 'uncommon' | 'rare' | 'grail', number>;
export type Config = Omit<
  z.infer<typeof EnvSchema>,
  'PRIZE_COLLECTIONS' | 'TOPUP_TARGETS' | 'BUY_TIER_MIX' | 'BUY_TIER_MIN_USD' | 'BUY_REQUIRED_TRAITS'
> & {
  PRIZE_COLLECTIONS: string[];
  TOPUP_TARGETS: TierNumbers;
  /** Fractions of the stock value per tier; they sum to 1. */
  BUY_TIER_MIX: TierNumbers;
  BUY_TIER_MIN_USD: TierNumbers;
  BUY_REQUIRED_TRAITS: Record<string, string>;
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
  if (parsed.data.FLOAT_FEES === 'yes') {
    if (parsed.data.ONE_WALLET_FEES === 'yes' || parsed.data.PUMP_COIN_MINT || parsed.data.FEE_CLAIMER_SECRET_KEY) {
      throw new Error('Invalid worker environment:\n  FLOAT_FEES replaces the pump.fun fee modes; unset ONE_WALLET_FEES, PUMP_COIN_MINT and FEE_CLAIMER_SECRET_KEY');
    }
    if (parsed.data.FEE_USDC_SHARE_BPS > 0 && parsed.data.FLOAT_PAIR_MINT === 'So11111111111111111111111111111111111111112') {
      throw new Error('Invalid worker environment:\n  FEE_USDC_SHARE_BPS needs the coin paired with a token (set FLOAT_PAIR_MINT), not wrapped SOL');
    }
  } else if (parsed.data.ONE_WALLET_FEES === 'yes') {
    if (!parsed.data.PUMP_COIN_MINT) throw new Error('Invalid worker environment:\n  ONE_WALLET_FEES needs PUMP_COIN_MINT');
    if (parsed.data.FEE_CLAIMER_SECRET_KEY) {
      throw new Error('Invalid worker environment:\n  ONE_WALLET_FEES claims with HOT_WALLET_SECRET_KEY; unset FEE_CLAIMER_SECRET_KEY (vault mode)');
    }
  } else {
    if (Boolean(parsed.data.PUMP_COIN_MINT) !== Boolean(parsed.data.FEE_CLAIMER_SECRET_KEY)) {
      throw new Error('Invalid worker environment:\n  set both PUMP_COIN_MINT and FEE_CLAIMER_SECRET_KEY, or neither');
    }
    if (parsed.data.PUMP_COIN_MINT && !parsed.data.SQUADS_VAULT_ADDRESS) {
      throw new Error('Invalid worker environment:\n  the fee claimer needs SQUADS_VAULT_ADDRESS');
    }
  }
  if (parsed.data.ONE_WALLET_BUYER === 'yes' && parsed.data.BUYER_SPENDING_LIMIT) {
    throw new Error('Invalid worker environment:\n  ONE_WALLET_BUYER spends the wallet directly; unset BUYER_SPENDING_LIMIT');
  }
  if (parsed.data.SQUADS_MIN_THRESHOLD < 2 && parsed.data.SQUADS_ALLOW_SINGLE_SIGNER !== SINGLE_SIGNER_PHRASE) {
    throw new Error(`Invalid worker environment:\n  SQUADS_MIN_THRESHOLD=1 also needs SQUADS_ALLOW_SINGLE_SIGNER=${SINGLE_SIGNER_PHRASE}`);
  }
  if (parsed.data.BUYER_SPENDING_LIMIT || parsed.data.ONE_WALLET_BUYER === 'yes') {
    const need = parsed.data.BUYER_SPENDING_LIMIT
      ? (['SQUADS_MULTISIG_ADDRESS', 'BUY_COLLECTION_ADDRESS', 'BUY_UPDATE_AUTHORITY'] as const)
      : (['BUY_COLLECTION_ADDRESS', 'BUY_UPDATE_AUTHORITY'] as const);
    const missing = need.filter((k) => !parsed.data[k]);
    if (missing.length) throw new Error(`Invalid worker environment:\n  the card buyer needs ${missing.join(', ')}`);
    if (!parsed.data.BUY_REQUIRED_TRAITS.trim()) {
      throw new Error('Invalid worker environment:\n  the card buyer needs BUY_REQUIRED_TRAITS (it keeps merch and sealed product out)');
    }
  }
  return {
    ...parsed.data,
    PRIZE_COLLECTIONS: collections,
    TOPUP_TARGETS: parseTargets(parsed.data.TOPUP_TARGETS),
    BUY_TIER_MIX: parseMix(parsed.data.BUY_TIER_MIX),
    BUY_TIER_MIN_USD: parseTargets(parsed.data.BUY_TIER_MIN_USD, 'BUY_TIER_MIN_USD', 6),
    BUY_REQUIRED_TRAITS: parseTraits(parsed.data.BUY_REQUIRED_TRAITS),
  };
}

/** Parses "common:45,uncommon:30,..." weights into fractions that sum to 1. */
export function parseMix(raw: string): TierNumbers {
  const w = parseTargets(raw, 'BUY_TIER_MIX');
  const total = w.common + w.uncommon + w.rare + w.grail;
  if (total <= 0) throw new Error('Invalid worker environment:\n  BUY_TIER_MIX: at least one tier needs a weight above 0');
  return { common: w.common / total, uncommon: w.uncommon / total, rare: w.rare / total, grail: w.grail / total };
}

export function parseTraits(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of raw.split(';').map((s) => s.trim()).filter(Boolean)) {
    const i = part.indexOf('=');
    if (i <= 0 || i === part.length - 1) throw new Error(`Invalid worker environment:\n  BUY_REQUIRED_TRAITS: bad entry "${part}"`);
    out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

export function parseTargets(raw: string, name = 'TOPUP_TARGETS', maxDigits = 3): TierNumbers {
  const out = { common: 0, uncommon: 0, rare: 0, grail: 0 };
  const re = new RegExp(`^(common|uncommon|rare|grail):(\\d{1,${maxDigits}})$`);
  for (const part of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = re.exec(part);
    if (!m) throw new Error(`Invalid worker environment:\n  ${name}: bad entry "${part}"`);
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
