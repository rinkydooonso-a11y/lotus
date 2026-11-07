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

/**
 * Swaps exactly `amount` of `inputMint` into native SOL (fee tokens the wallet has claimed).
 * `priceImpact` is the quote's own estimate as a fraction; the caller refuses a swap that moves
 * the price too far, since the pair's token may be thinly traded.
 */
export function createJupiterSwapToSol(opts: { slippageBps: number; fetchImpl?: typeof fetch }) {
  const f = opts.fetchImpl ?? fetch;
  // `outputMint` is native SOL unless the caller asks for USDC. `minOutLamports` is then the guaranteed
  // minimum in that output's own base units (USDC: 6 decimals).
  return async (inputMint: string, amount: bigint, user: string, outputMint: 'SOL' | 'USDC' = 'SOL'): Promise<{ tx: Uint8Array; minOutLamports: bigint; priceImpact: number }> => {
    const outMint = outputMint === 'USDC' ? USDC : SOL;
    const q = new URLSearchParams({
      inputMint, outputMint: outMint, amount: amount.toString(), swapMode: 'ExactIn', slippageBps: String(opts.slippageBps),
    });
    const qres = await f(`${BASE}/quote?${q}`, { signal: AbortSignal.timeout(15_000) });
    if (!qres.ok) throw new Error(`Jupiter quote ${qres.status}`);
    const quote = (await qres.json()) as { inAmount?: string; outAmount?: string; otherAmountThreshold?: string; priceImpactPct?: string; swapMode?: string; inputMint?: string; outputMint?: string };
    if (quote.swapMode !== 'ExactIn' || quote.inputMint !== inputMint || quote.outputMint !== outMint) throw new Error('Jupiter quote is not the swap we asked for');
    if (BigInt(quote.inAmount ?? '0') !== amount) throw new Error('Jupiter quote does not swap the amount asked');
    const minOut = BigInt(quote.otherAmountThreshold ?? '0');
    if (minOut <= 0n) throw new Error('Jupiter quote promises no SOL');
    const priceImpact = Number(quote.priceImpactPct);
    if (!Number.isFinite(priceImpact)) throw new Error('Jupiter quote has no price impact');
    const sres = await f(`${BASE}/swap`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ quoteResponse: quote, userPublicKey: user, wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!sres.ok) throw new Error(`Jupiter swap ${sres.status}`);
    const { swapTransaction } = (await sres.json()) as { swapTransaction?: string };
    if (!swapTransaction) throw new Error('Jupiter returned no transaction');
    return { tx: Uint8Array.from(Buffer.from(swapTransaction, 'base64')), minOutLamports: minOut, priceImpact };
  };
}
