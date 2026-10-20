import type { Logger } from './types.js';

/**
 * Fee claimer: moves the CARDS coin's pump.fun creator fees into the Squads vault.
 *
 * It calls pump's permissionless sweep / consolidate / distribute instructions, which pay every
 * shareholder of the coin's fee-sharing config directly. The bot's key only pays gas: the fees
 * go from pump's vault straight to the shareholders, never through the bot. It refuses to run
 * unless the Squads vault is one of the shareholders, and simulates first so it never spends gas
 * on a claim below the minimum.
 */

export interface Shareholder {
  address: string;
  shareBps: number;
}

export interface FeeGateway {
  /** The coin's quote mint ('SOL' for native) and its decimals. */
  quote(): Promise<{ asset: string; decimals: number }>;
  shareholders(): Promise<Shareholder[]>;
  gasLamports(): Promise<bigint>;
  /** The vault's balance of the quote asset, in base units. */
  vaultBalance(): Promise<bigint>;
  /** Simulates the distribution; how much the vault would receive, in base units. */
  simulateVaultGain(): Promise<bigint>;
  sendDistribution(): Promise<string>;
}

export interface ClaimLog {
  /** `amount` is a decimal string in whole units, exact (no float rounding). */
  recordClaim(e: { signature: string; amount: string; asset: string; note: string }): Promise<void>;
}

export interface FeeClaimDeps {
  gateway: FeeGateway;
  claims: ClaimLog;
  vault: string;
  /** Skip claims that would bring the vault less than this, in base units of the quote. */
  minClaim: bigint;
  minGasLamports: bigint;
  log: Logger;
}

export type FeeClaimOutcome =
  | { kind: 'vault_not_shareholder'; shareholders: Shareholder[] }
  | { kind: 'gas_low'; lamports: string }
  | { kind: 'below_minimum'; gain: string }
  | { kind: 'claimed'; signature: string; received: string; asset: string };

export function toDecimal(baseUnits: bigint, decimals: number): string {
  const s = baseUnits.toString().padStart(decimals + 1, '0');
  return decimals === 0 ? s : `${s.slice(0, -decimals)}.${s.slice(-decimals)}`;
}

export async function runFeeClaimTick(deps: FeeClaimDeps): Promise<FeeClaimOutcome> {
  const { gateway, log } = deps;

  const shareholders = await gateway.shareholders();
  const mine = shareholders.find((s) => s.address === deps.vault);
  if (!mine) {
    log.error('Squads vault is not a fee shareholder; not claiming', { vault: deps.vault, shareholders });
    return { kind: 'vault_not_shareholder', shareholders };
  }

  const gas = await gateway.gasLamports();
  if (gas < deps.minGasLamports) {
    log.warn('fee claimer gas wallet low; not claiming', { lamports: gas.toString() });
    return { kind: 'gas_low', lamports: gas.toString() };
  }

  const gain = await gateway.simulateVaultGain();
  if (gain < deps.minClaim) return { kind: 'below_minimum', gain: gain.toString() };

  const { asset, decimals } = await gateway.quote();
  const before = await gateway.vaultBalance();
  const signature = await gateway.sendDistribution();
  const after = await gateway.vaultBalance();
  // Measured, not simulated: what actually landed (other inflows in the same window would count too).
  const received = after > before ? after - before : 0n;
  await deps.claims.recordClaim({
    signature,
    amount: toDecimal(received, decimals),
    asset,
    note: `pump.fun creator fees, vault share ${mine.shareBps / 100}%`,
  });
  log.info('creator fees claimed into the vault', { signature, received: received.toString(), asset });
  return { kind: 'claimed', signature, received: received.toString(), asset };
}
