import { describe, expect, it } from 'vitest';
import { runCreatorFeeTick, type CreatorFeeGateway } from '../src/feeClaimer.js';
import { createJupiterSwapToSol } from '../src/jupiterSwap.js';
import { silentLog } from './fakes.js';

type Claim = { signature: string; amount: string | null; asset: string; note: string; usdValue: string | null; fundUsd: string | null; kind?: string };

class FakeGateway implements CreatorFeeGateway {
  native = false;
  gas = 50_000_000n;
  waiting = 3_000_000n; // 3 tokens at 6 decimals
  wallet = 0n; // quote tokens held
  swapLamports: bigint | null = 1_000_000_000n; // 1 SOL
  swapFails = false;
  swaps = 0;
  async quote() { return { asset: this.native ? 'SOL' : 'CARDSmint', decimals: this.native ? 9 : 6, native: this.native }; }
  async gasLamports() { return this.gas; }
  async claimable() { return this.waiting; }
  async claim() { const got = this.waiting; this.wallet += this.native ? 0n : got; this.waiting = 0n; return { signature: 'claim1', received: got }; }
  async quoteTokenBalance() { return this.wallet; }
  async swapToSol(amount: bigint) {
    if (this.swapFails) throw new Error('no route');
    if (amount !== this.wallet) throw new Error('swapped the wrong amount');
    this.wallet = 0n; this.swaps++;
    return { signature: 'swap1', lamports: this.swapLamports };
  }
}

function setup() {
  const gateway = new FakeGateway();
  const claims: Claim[] = [];
  const deps = {
    gateway,
    claims: { recordClaim: async (e: Claim) => { claims.push(e); } },
    minClaim: 1n, minSwap: 1n, minGasLamports: 5_000_000n, solUsd: async () => 150, cardFundBps: 7_000, log: silentLog,
  };
  return { gateway, claims, deps };
}

describe('one-wallet fee tick', () => {
  it('claims a token-paired coin, swaps it to SOL and credits 70% of the SOL value to the fund', async () => {
    const s = setup();
    const r = await runCreatorFeeTick(s.deps);
    expect(r).toEqual({ kind: 'done', claimed: 'claim1', swapped: 'swap1' });
    // The claim itself is not dollars yet; the swap is.
    expect(s.claims[0]).toMatchObject({ signature: 'claim1', asset: 'CARDSmint', amount: '3.000000', fundUsd: null });
    expect(s.claims[1]).toMatchObject({ signature: 'swap1', asset: 'SOL', amount: '1.000000000', usdValue: '150.00', fundUsd: '105.00', kind: 'other' });
  });

  it('credits a SOL-paired claim directly', async () => {
    const s = setup();
    s.gateway.native = true;
    s.gateway.waiting = 2_000_000_000n;
    await runCreatorFeeTick(s.deps);
    expect(s.claims).toHaveLength(1);
    expect(s.claims[0]).toMatchObject({ asset: 'SOL', usdValue: '300.00', fundUsd: '210.00' });
    expect(s.claims[0]!.kind).toBeUndefined();
  });

  it('keeps the tokens and records the claim when the swap fails, then retries the swap next tick', async () => {
    const s = setup();
    s.gateway.swapFails = true;
    await expect(runCreatorFeeTick(s.deps)).rejects.toThrow('no route');
    expect(s.claims).toHaveLength(1); // the claim is on the books
    expect(s.gateway.wallet).toBe(3_000_000n);

    s.gateway.swapFails = false;
    const r = await runCreatorFeeTick(s.deps);
    expect(r).toEqual({ kind: 'done', claimed: null, swapped: 'swap1' });
    expect(s.claims[1]).toMatchObject({ signature: 'swap1', fundUsd: '105.00' });
  });

  it('adds nothing to the fund when SOL cannot be priced, but still records the swap', async () => {
    const s = setup();
    await runCreatorFeeTick({ ...s.deps, solUsd: async () => { throw new Error('out of range'); } });
    expect(s.claims[1]).toMatchObject({ usdValue: null, fundUsd: null });
  });

  it('does nothing when there is nothing to claim or swap', async () => {
    const s = setup();
    s.gateway.waiting = 0n;
    expect(await runCreatorFeeTick({ ...s.deps, minClaim: 1_000n })).toEqual({ kind: 'idle' });
    expect(s.claims).toHaveLength(0);
  });

  it('leaves small amounts to build up', async () => {
    const s = setup();
    s.gateway.waiting = 500n;
    expect(await runCreatorFeeTick({ ...s.deps, minClaim: 1_000n, minSwap: 10_000n })).toEqual({ kind: 'idle' });
  });

  it('does not claim or swap when the wallet is out of gas', async () => {
    const s = setup();
    s.gateway.gas = 1_000n;
    expect(await runCreatorFeeTick(s.deps)).toEqual({ kind: 'gas_low', lamports: '1000' });
    expect(s.claims).toHaveLength(0);
  });
});

describe('jupiter swap to SOL builder', () => {
  const MINT = 'CARDSmint11111111111111111111111111111111111';
  const SOL = 'So11111111111111111111111111111111111111112';
  const quote = (over: object = {}) => ({
    swapMode: 'ExactIn', inputMint: MINT, outputMint: SOL, inAmount: '3000000', outAmount: '1000000000',
    otherAmountThreshold: '990000000', priceImpactPct: '0.004', ...over,
  });
  const fake = (q: object, calls: string[] = []) => (async (url: string) => {
    calls.push(url);
    return url.includes('/quote')
      ? { ok: true, status: 200, json: async () => q }
      : { ok: true, status: 200, json: async () => ({ swapTransaction: Buffer.from([7, 8, 9]).toString('base64') }) };
  }) as unknown as typeof fetch;

  it('quotes exact-in and returns the bytes, the quoted minimum and the price impact', async () => {
    const calls: string[] = [];
    const r = await createJupiterSwapToSol({ slippageBps: 100, fetchImpl: fake(quote(), calls) })(MINT, 3_000_000n, 'user');
    expect([...r.tx]).toEqual([7, 8, 9]);
    expect(r.minOutLamports).toBe(990_000_000n);
    expect(r.priceImpact).toBeCloseTo(0.004);
    expect(calls[0]).toContain('swapMode=ExactIn');
    expect(calls[0]).toContain('amount=3000000');
  });

  it('refuses a quote that is not the swap we asked for', async () => {
    const run = (q: object) => createJupiterSwapToSol({ slippageBps: 100, fetchImpl: fake(q) })(MINT, 3_000_000n, 'u');
    await expect(run(quote({ inAmount: '2000000' }))).rejects.toThrow(/amount asked/);
    await expect(run(quote({ outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' }))).rejects.toThrow(/not the swap/);
    await expect(run(quote({ otherAmountThreshold: '0' }))).rejects.toThrow(/no SOL/);
    await expect(run(quote({ priceImpactPct: undefined }))).rejects.toThrow(/price impact/);
  });
});
