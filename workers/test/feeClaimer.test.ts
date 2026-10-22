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
  async simulateVaultGain() { return (this.pending * BigInt(this.holders.find((h) => h.address === VAULT)?.shareBps ?? 0)) / 10_000n; }
  received: bigint | null | undefined;
  async sendDistribution() { const gain = await this.simulateVaultGain(); this.balance += gain; this.pending = 0n; this.sends++; return { signature: 'sig1', received: this.received === undefined ? gain : this.received }; }
}

function setup() {
  const gateway = new FakeGateway();
  const claims: Array<{ signature: string; amount: string | null; asset: string; note: string; usdValue: string | null; fundUsd: string | null }> = [];
  const deps = { gateway, claims: { recordClaim: async (e: (typeof claims)[number]) => { claims.push(e); } }, vault: VAULT, minVaultShareBps: 10_000, minClaim: 1_000_000n, minGasLamports: 5_000_000n, cardFundBps: 7_000, log: silentLog };
  return { gateway, claims, deps };
}

describe('fee claimer card fund', () => {
  it('prices a SOL claim and sends 70% of it to the card fund', async () => {
    const s = setup();
    s.gateway.quote = async () => ({ asset: 'SOL', decimals: 9 });
    s.gateway.pending = 2_000_000_000n; // 2 SOL
    await runFeeClaimTick({ ...s.deps, minClaim: 1n, solUsd: async () => 150 });
    expect(s.claims[0]).toMatchObject({ asset: 'SOL', usdValue: '300.00', fundUsd: '210.00' });
  });

  it('still records the claim when the price feed fails, adding nothing to the fund', async () => {
    const s = setup();
    s.gateway.quote = async () => ({ asset: 'SOL', decimals: 9 });
    s.gateway.pending = 2_000_000_000n;
    await runFeeClaimTick({ ...s.deps, minClaim: 1n, solUsd: async () => { throw new Error('down'); } });
    expect(s.claims[0]).toMatchObject({ usdValue: null, fundUsd: null });
  });
});

describe('fee claimer', () => {
  it('claims into the vault and logs exactly what landed', async () => {
    const s = setup();
    const r = await runFeeClaimTick(s.deps);
    expect(r).toEqual({ kind: 'claimed', signature: 'sig1', received: '2500000', asset: 'CARDSmint' });
    // The coin is quoted in its own token here, which has no price feed: nothing goes to the card fund.
    expect(s.claims).toEqual([{
      signature: 'sig1', amount: '2.500000', asset: 'CARDSmint', usdValue: null, fundUsd: null,
      note: 'pump.fun creator fees, vault share 100%; not added to the card fund, add it by hand',
    }]);
  });

  it('never sends when the vault is not a shareholder', async () => {
    const s = setup();
    s.gateway.holders = [{ address: 'SomeoneElse1111111111111111111111111111111', shareBps: 10_000 }];
    expect(await runFeeClaimTick(s.deps)).toMatchObject({ kind: 'vault_not_shareholder' });
    expect(s.gateway.sends).toBe(0);
  });

  it('refuses when the vault share is below the minimum', async () => {
    const s = setup();
    s.gateway.holders = [{ address: VAULT, shareBps: 1 }, { address: 'SomeoneElse1111111111111111111111111111111', shareBps: 9_999 }];
    expect(await runFeeClaimTick(s.deps)).toEqual({ kind: 'vault_share_too_low', shareBps: 1 });
    expect(s.gateway.sends).toBe(0);
  });

  it('still records a landed claim whose amount could not be read', async () => {
    const s = setup();
    s.gateway.received = null;
    expect(await runFeeClaimTick(s.deps)).toMatchObject({ kind: 'claimed', received: null });
    expect(s.claims[0]).toMatchObject({ signature: 'sig1', amount: null });
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
