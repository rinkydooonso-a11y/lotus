import { describe, expect, it } from 'vitest';
import { runFeeClaimTick, toDecimal, type FeeGateway, type Shareholder } from '../src/feeClaimer.js';
import { silentLog } from './fakes.js';

const VAULT = 'Vau1t11111111111111111111111111111111111111';

class FakeGateway implements FeeGateway {
  holders: Shareholder[] = [{ address: VAULT, shareBps: 10_000 }];
  gas = 50_000_000n;
  pending = 2_500_000n;
  balance = 0n;
  sends = 0;
  async quote() { return { asset: 'CARDSmint', decimals: 6 }; }
  async shareholders() { return this.holders; }
  async gasLamports() { return this.gas; }
  async vaultBalance() { return this.balance; }
  async simulateVaultGain() { return (this.pending * BigInt(this.holders.find((h) => h.address === VAULT)?.shareBps ?? 0)) / 10_000n; }
  async sendDistribution() { this.balance += await this.simulateVaultGain(); this.pending = 0n; this.sends++; return 'sig1'; }
}

function setup() {
  const gateway = new FakeGateway();
  const claims: Array<{ signature: string; amount: string; asset: string; note: string }> = [];
  const deps = { gateway, claims: { recordClaim: async (e: (typeof claims)[number]) => { claims.push(e); } }, vault: VAULT, minClaim: 1_000_000n, minGasLamports: 5_000_000n, log: silentLog };
  return { gateway, claims, deps };
}

describe('fee claimer', () => {
  it('claims into the vault and logs exactly what landed', async () => {
    const s = setup();
    const r = await runFeeClaimTick(s.deps);
    expect(r).toEqual({ kind: 'claimed', signature: 'sig1', received: '2500000', asset: 'CARDSmint' });
    expect(s.claims).toEqual([{ signature: 'sig1', amount: '2.500000', asset: 'CARDSmint', note: 'pump.fun creator fees, vault share 100%' }]);
  });

  it('never sends when the vault is not a shareholder', async () => {
    const s = setup();
    s.gateway.holders = [{ address: 'SomeoneElse1111111111111111111111111111111', shareBps: 10_000 }];
    expect(await runFeeClaimTick(s.deps)).toMatchObject({ kind: 'vault_not_shareholder' });
    expect(s.gateway.sends).toBe(0);
  });

  it('skips below the minimum and when gas is low', async () => {
    const s = setup();
    s.gateway.pending = 10n;
    expect(await runFeeClaimTick(s.deps)).toMatchObject({ kind: 'below_minimum', gain: '10' });
    s.gateway.pending = 5_000_000n;
    s.gateway.gas = 1n;
    expect(await runFeeClaimTick(s.deps)).toMatchObject({ kind: 'gas_low' });
    expect(s.gateway.sends).toBe(0);
  });

  it('formats base units exactly', () => {
    expect(toDecimal(1n, 9)).toBe('0.000000001');
    expect(toDecimal(123_456_789_012_345_678n, 6)).toBe('123456789012.345678');
    expect(toDecimal(7n, 0)).toBe('7');
  });
});
