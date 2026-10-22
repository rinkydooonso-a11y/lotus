export {};
/**
 * Prints what Jupiter would give for swapping a fee token into SOL, without sending anything.
 * Run it before turning ONE_WALLET_FEES on, to see whether the pair's token has a route and how much
 * the price would move at the size you expect to claim.
 *
 *   cd workers && npx tsx scripts/swap-quote.ts <token mint> <amount in whole tokens> [decimals=6]
 */
const [mint, amountArg, decimalsArg] = process.argv.slice(2);
if (!mint || !amountArg) throw new Error('usage: swap-quote.ts <token mint> <amount in whole tokens> [decimals]');
const decimals = Number(decimalsArg ?? 6);
const amount = BigInt(Math.round(Number(amountArg) * 10 ** decimals));
const SOL = 'So11111111111111111111111111111111111111112';
const q = new URLSearchParams({ inputMint: mint, outputMint: SOL, amount: amount.toString(), swapMode: 'ExactIn', slippageBps: '100' });
const res = await fetch(`https://lite-api.jup.ag/swap/v1/quote?${q}`, { signal: AbortSignal.timeout(15_000) });
if (!res.ok) throw new Error(`Jupiter quote ${res.status}: ${await res.text()}`);
const j = (await res.json()) as { inAmount: string; outAmount: string; otherAmountThreshold: string; priceImpactPct: string; routePlan?: Array<{ swapInfo?: { label?: string } }> };
console.log({
  sells: `${amountArg} tokens`,
  getsSol: Number(j.outAmount) / 1e9,
  atLeastSol: Number(j.otherAmountThreshold) / 1e9,
  priceImpactPct: j.priceImpactPct,
  note: 'the worker treats priceImpactPct as a fraction (0.01 = 1%); check that against a trade you know',
  route: (j.routePlan ?? []).map((r) => r.swapInfo?.label),
});
