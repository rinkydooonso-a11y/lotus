import type { Logger } from './types.js';

/**
 * Fee claimer: moves the QUEST coin's pump.fun creator fees into the Squads vault.
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
  /** Simulates the distribution; how much the vault would receive, in base units. */
  simulateVaultGain(): Promise<bigint>;
  /**
   * Sends and confirms the distribution. `received` is the vault's change read from the landed
   * transaction itself (null if the node can't return it yet), so other vault traffic can't skew it.
   */
  sendDistribution(): Promise<{ signature: string; received: bigint | null }>;
}

export interface ClaimLog {
  /** `amount` is a decimal string in whole units, exact (no float rounding); null if unknown. */
  recordClaim(e: { signature: string; amount: string | null; asset: string; note: string }): Promise<void>;
}

export interface FeeClaimDeps {
  gateway: FeeGateway;
  claims: ClaimLog;
  vault: string;
  /** Refuse unless the vault's share is at least this many basis points. */
  minVaultShareBps: number;
  /** Skip claims that would bring the vault less than this, in base units of the quote. */
  minClaim: bigint;
  minGasLamports: bigint;
  log: Logger;
}

export type FeeClaimOutcome =
  | { kind: 'vault_not_shareholder'; shareholders: Shareholder[] }
  | { kind: 'vault_share_too_low'; shareBps: number }
  | { kind: 'gas_low'; lamports: string }
  | { kind: 'below_minimum'; gain: string }
  | { kind: 'claimed'; signature: string; received: string | null; asset: string };

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
  if (mine.shareBps < deps.minVaultShareBps) {
    // Every distribution also pays the other shareholders; don't spend gas sending most of it elsewhere.
    log.error('Squads vault share is below the minimum; not claiming', { shareBps: mine.shareBps, min: deps.minVaultShareBps, shareholders });
    return { kind: 'vault_share_too_low', shareBps: mine.shareBps };
  }

  const gas = await gateway.gasLamports();
  if (gas < deps.minGasLamports) {
    log.warn('fee claimer gas wallet low; not claiming', { lamports: gas.toString() });
    return { kind: 'gas_low', lamports: gas.toString() };
  }

  const gain = await gateway.simulateVaultGain();
  if (gain < deps.minClaim) return { kind: 'below_minimum', gain: gain.toString() };

  const { asset, decimals } = await gateway.quote();
  const { signature, received } = await gateway.sendDistribution();
  await deps.claims.recordClaim({
    signature,
    amount: received === null ? null : toDecimal(received, decimals),
    asset,
    note: `pump.fun creator fees, vault share ${mine.shareBps / 100}%${received === null ? ' (amount not read, see tx)' : ''}`,
  });
  log.info('creator fees claimed into the vault', { signature, received: received?.toString() ?? null, asset });
  return { kind: 'claimed', signature, received: received?.toString() ?? null, asset };
}
