import { describe, expect, it } from 'vitest';
import { runCreatorFeeTick, type CreatorFeeGateway } from '../src/feeClaimer.js';
import { isWrappedSol } from '../src/floatFees.js';
import { loadConfig } from '../src/config.js';
import { silentLog } from './fakes.js';

type Claim = { signature: string; amount: string | null; asset: string; note: string; usdValue: string | null; fundUsd: string | null; kind?: string };

/** Float pays the creator share into the wallet by itself: nothing to claim, only tokens that landed. */
class FloatFake implements CreatorFeeGateway {
  readonly paidDirectly = true;
  gas = 50_000_000n;
  held = 0n; // paired tokens that Float's bot paid in (6 decimals)
  claimCalls = 0;
  swaps = 0;
  async quote() { return { asset: 'CARDSmint', decimals: 6, native: false }; }
  async gasLamports() { return this.gas; }
  async claimable() { return 5_000_000n; } // would trigger a claim if paidDirectly were ignored
  async claim(): Promise<never> { this.claimCalls++; throw new Error('nothing to claim'); }
  async quoteTokenBalance() { return this.held; }
  async swapToSol(amount: bigint) {
    if (amount !== this.held) throw new Error('swapped the wrong amount');
    this.held = 0n; this.swaps++;
    return { signature: 'swap1', lamports: 2_000_000_000n };
  }
  usdcSwaps: bigint[] = [];
  solSwaps: bigint[] = [];
  async swapToUsdc(amount: bigint) {
    this.held -= amount; this.usdcSwaps.push(amount);
    return { signature: 'usdc1', usdc: 72_000_000n }; // $72
  }
}

/** Like FloatFake but the SOL leg also takes only its part, as the real gateway does. */
class SplitFake extends FloatFake {
  async swapToSol(amount: bigint) {
    this.held -= amount; this.solSwaps.push(amount); this.swaps++;
    return { signature: 'sol1', lamports: 1_400_000_000n }; // 1.4 SOL
  }
}

function setup() {
  const gateway = new FloatFake();
  const claims: Claim[] = [];
  const deps = {
    gateway,
    claims: { recordClaim: async (e: Claim) => { claims.push(e); } },
    minClaim: 0n, minSwap: 1n, minGasLamports: 5_000_000n, solUsd: async () => 150, cardFundBps: 7_000, log: silentLog,
  };
  return { gateway, claims, deps };
}

describe('Float fee sweep', () => {
  it('never tries to claim, and does nothing when no fees have landed', async () => {
    const s = setup();
    expect(await runCreatorFeeTick(s.deps)).toEqual({ kind: 'idle' });
    expect(s.gateway.claimCalls).toBe(0);
    expect(s.claims).toHaveLength(0);
  });

  it('swaps what Float paid in and credits 70% of the SOL value to the card fund, once', async () => {
    const s = setup();
    s.gateway.held = 4_000_000n;
    expect(await runCreatorFeeTick(s.deps)).toEqual({ kind: 'done', claimed: null, swapped: 'swap1' });
    expect(s.claims).toHaveLength(1);
    expect(s.claims[0]).toMatchObject({ signature: 'swap1', asset: 'SOL', amount: '2.000000000', usdValue: '300.00', fundUsd: '210.00', kind: 'other' });
    // The tokens are gone, so the next tick has nothing to credit again.
    expect(await runCreatorFeeTick(s.deps)).toEqual({ kind: 'idle' });
    expect(s.claims).toHaveLength(1);
  });

  it('with a 30% USDC share: 70% of the tokens go to SOL (not credited), 30% to USDC (credited in full)', async () => {
    const gateway = new SplitFake();
    const claims: Claim[] = [];
    const deps = {
      gateway,
      claims: { recordClaim: async (e: Claim) => { claims.push(e); } },
      minClaim: 0n, minSwap: 1n, minGasLamports: 5_000_000n, solUsd: async () => 150, cardFundBps: 7_000, usdcShareBps: 3_000, log: silentLog,
    };
    gateway.held = 10_000_000n;
    expect(await runCreatorFeeTick(deps)).toMatchObject({ kind: 'done' });
    expect(gateway.solSwaps).toEqual([7_000_000n]);
    expect(gateway.usdcSwaps).toEqual([3_000_000n]);
    expect(gateway.held).toBe(0n);
    expect(claims).toHaveLength(2);
    expect(claims[0]).toMatchObject({ signature: 'sol1', asset: 'SOL', usdValue: '210.00', fundUsd: null });
    expect(claims[1]).toMatchObject({ signature: 'usdc1', asset: 'USDC', amount: '72.000000', usdValue: '72.00', fundUsd: '72.00' });
    expect(await runCreatorFeeTick(deps)).toEqual({ kind: 'idle' });
  });

  it('does not sweep when the wallet is out of gas', async () => {
    const s = setup();
    s.gateway.held = 4_000_000n;
    s.gateway.gas = 10n;
    expect(await runCreatorFeeTick(s.deps)).toEqual({ kind: 'gas_low', lamports: '10' });
    expect(s.gateway.swaps).toBe(0);
  });

  it('recognises wrapped SOL', () => {
    expect(isWrappedSol('So11111111111111111111111111111111111111112')).toBe(true);
    expect(isWrappedSol('CARDSccUMFKoPRZxt5vt3ksUbxEFEcnZ3H2pd3dKxYjp')).toBe(false);
  });
});

describe('Float config', () => {
  const base = {
    DATABASE_URL: 'postgres://x', SOLANA_RPC_URL: 'https://example.com', HOT_WALLET_SECRET_KEY: '[1]',
  };
  it('accepts FLOAT_FEES with the CARDS pair and defaults the pair to wrapped SOL', () => {
    expect(loadConfig({ ...base, FLOAT_FEES: 'yes' } as never).FLOAT_PAIR_MINT).toBe('So11111111111111111111111111111111111111112');
    expect(loadConfig({ ...base, FLOAT_FEES: 'yes', FLOAT_PAIR_MINT: 'CARDSccUMFKoPRZxt5vt3ksUbxEFEcnZ3H2pd3dKxYjp' } as never).FLOAT_PAIR_MINT)
      .toBe('CARDSccUMFKoPRZxt5vt3ksUbxEFEcnZ3H2pd3dKxYjp');
  });
  it('refuses a USDC share when the coin is paired with wrapped SOL', () => {
    expect(() => loadConfig({ ...base, FLOAT_FEES: 'yes', FEE_USDC_SHARE_BPS: '3000' } as never)).toThrow(/FEE_USDC_SHARE_BPS/);
    expect(loadConfig({ ...base, FLOAT_FEES: 'yes', FLOAT_PAIR_MINT: 'CARDSccUMFKoPRZxt5vt3ksUbxEFEcnZ3H2pd3dKxYjp', FEE_USDC_SHARE_BPS: '3000' } as never).FEE_USDC_SHARE_BPS).toBe(3000);
  });
  it('refuses to mix Float mode with the pump.fun modes', () => {
    expect(() => loadConfig({ ...base, FLOAT_FEES: 'yes', ONE_WALLET_FEES: 'yes' } as never)).toThrow(/FLOAT_FEES replaces/);
    expect(() => loadConfig({ ...base, FLOAT_FEES: 'yes', PUMP_COIN_MINT: 'CARDSccUMFKoPRZxt5vt3ksUbxEFEcnZ3H2pd3dKxYjp' } as never)).toThrow(/FLOAT_FEES replaces/);
  });
});
