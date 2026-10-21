/**
 * Jupiter's public swap API, used to turn SOL into the exact USDC a card costs. Everything it
 * returns is untrusted: the buyer gateway checks the instructions and simulates the swap before signing.
 */
const BASE = 'https://lite-api.jup.ag/swap/v1';
const SOL = 'So11111111111111111111111111111111111111112';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

export function createJupiterSwap(opts: { slippageBps: number; fetchImpl?: typeof fetch }) {
  const f = opts.fetchImpl ?? fetch;
  return async (usdcOut: bigint, maxSolIn: bigint, user: string): Promise<Uint8Array> => {
    const q = new URLSearchParams({
      inputMint: SOL, outputMint: USDC, amount: usdcOut.toString(), swapMode: 'ExactOut', slippageBps: String(opts.slippageBps),
    });
    const qres = await f(`${BASE}/quote?${q}`, { signal: AbortSignal.timeout(15_000) });
    if (!qres.ok) throw new Error(`Jupiter quote ${qres.status}`);
    const quote = (await qres.json()) as { outAmount?: string; inAmount?: string; otherAmountThreshold?: string; swapMode?: string };
    if (quote.swapMode !== 'ExactOut' || BigInt(quote.outAmount ?? '0') < usdcOut) throw new Error('Jupiter quote does not deliver the USDC needed');
    // The worst case after slippage must fit the budget, or we do not swap.
    if (BigInt(quote.otherAmountThreshold ?? quote.inAmount ?? '0') > maxSolIn) throw new Error('Jupiter quote costs more SOL than allowed');
    const sres = await f(`${BASE}/swap`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ quoteResponse: quote, userPublicKey: user, wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!sres.ok) throw new Error(`Jupiter swap ${sres.status}`);
    const { swapTransaction } = (await sres.json()) as { swapTransaction?: string };
    if (!swapTransaction) throw new Error('Jupiter returned no transaction');
    return Uint8Array.from(Buffer.from(swapTransaction, 'base64'));
  };
}
