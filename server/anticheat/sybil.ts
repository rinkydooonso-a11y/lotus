import type { AntiCheatConfig } from "./config";
import type { KV } from "./store";

const MEMBERSHIP_TTL_S = 30 * 24 * 3600;

export interface SybilInput {
  walletAddress: string;
  deviceId: string;
  ip?: string | null;
  /** Epoch ms of the wallet's first on-chain tx, when known. */
  walletFirstTxAt?: number | null;
  walletFunder?: string | null;
}

export interface SybilResult {
  score: number;
  signals: string[];
}

/** Weights per signal; summed and compared against sybilFlagScore / sybilBlockScore. */
export const SYBIL_WEIGHTS = {
  many_wallets_per_device: 2,
  many_wallets_per_ip: 1,
  funder_cluster: 2,
  fresh_wallet: 1,
} as const;

/**
 * Records wallet<->device/IP/funder links (30-day rolling sets) and scores the current open.
 * Wallet age and funder come from walletinfo.ts; missing inputs just skip that signal.
 */
export async function scoreSybil(
  kv: KV,
  cfg: AntiCheatConfig,
  input: SybilInput,
  now: number,
): Promise<SybilResult> {
  const p = cfg.keyPrefix;
  const signals: string[] = [];
  let score = 0;

  const track = async (key: string) => {
    await kv.sadd(key, input.walletAddress);
    await kv.expire(key, MEMBERSHIP_TTL_S);
    return kv.scard(key);
  };

  const perDevice = await track(`${p}syb:dev:${input.deviceId}`);
  if (perDevice > cfg.maxWalletsPerDevice) {
    score += SYBIL_WEIGHTS.many_wallets_per_device;
    signals.push(`many_wallets_per_device:${perDevice}`);
  }
  if (input.ip) {
    const perIp = await track(`${p}syb:ip:${input.ip}`);
    if (perIp > cfg.maxWalletsPerIp) {
      score += SYBIL_WEIGHTS.many_wallets_per_ip;
      signals.push(`many_wallets_per_ip:${perIp}`);
    }
  }
  if (input.walletFunder) {
    const perFunder = await track(`${p}syb:fund:${input.walletFunder}`);
    if (perFunder > cfg.maxWalletsPerFunder) {
      score += SYBIL_WEIGHTS.funder_cluster;
      signals.push(`funder_cluster:${perFunder}`);
    }
  }
  if (input.walletFirstTxAt) {
    const ageH = (now - input.walletFirstTxAt) / 3_600_000;
    if (ageH < cfg.minWalletAgeH) {
      score += SYBIL_WEIGHTS.fresh_wallet;
      signals.push(`fresh_wallet:${ageH.toFixed(1)}h`);
    }
  }
  return { score, signals };
}
