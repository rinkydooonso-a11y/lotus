import { isValidAddress } from './config.js';
import type { Chain, Logger, PrizeQueue, PrizeSendJob, PrizeTx, TxLog } from './types.js';

/**
 * Prize sender: moves a reserved card NFT from the hot wallet to the winner.
 *
 * Why this never double-sends:
 *  1. @lotus/server keeps one prize_sends row per opening and per inventory item (both UNIQUE), so
 *     one card can't be queued for two winners and one win can't be queued twice.
 *  2. Write-ahead: each signed transaction (signature, lastValidBlockHeight, bytes) is committed to
 *     prize_send_txs and recordSubmittedSignature BEFORE it is broadcast. A crash after
 *     broadcasting always leaves a signature we can look up.
 *  3. A new transaction is built only when every earlier one is provably dead: it landed with an
 *     error, or block height passed its lastValidBlockHeight (height read BEFORE the status
 *     lookup) and it was never seen. While one might still land, we only rebroadcast and wait.
 *  4. Before building, we read the asset's owner from chain state. Owned by the winner means it
 *     already arrived (mark sent). Owned by anyone but the hot wallet means stop for an admin.
 *  5. A card NFT is unique on chain, so even two racing transactions can't both deliver it: the
 *     second fails because the hot wallet no longer owns it. Only one sender process runs at a
 *     time (Postgres advisory lock in main.ts) so that race isn't expected in the first place.
 * Anything unexpected is marked permanently failed. The item stays reserved for the winner and
 * an admin requeues it; the worker never returns a card to the pool.
 */

export interface SenderDeps {
  queue: PrizeQueue;
  txLog: TxLog;
  chain: Chain;
  log: Logger;
  /** Max transactions built for one prize before it is parked for an admin. */
  maxTxsPerPrize: number;
  /** Stop waiting on an in-flight tx after this long and leave it for the next claim. Must be < lock. */
  settleBudgetMs?: number;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export type JobOutcome = 'sent' | 'failed_permanent' | 'retry' | 'still_in_flight';

export const LOCK_MS = 180_000;
export const MAX_QUEUE_ATTEMPTS = 20;
const DEFAULT_SETTLE_BUDGET_MS = 140_000;

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Claims up to `batch` jobs and processes them concurrently. */
export async function runPrizeSenderTick(deps: SenderDeps, batch: number): Promise<JobOutcome[]> {
  const jobs: PrizeSendJob[] = [];
  for (let i = 0; i < batch; i++) {
    const job = await deps.queue.claimNextPrizeSend({ lockMs: LOCK_MS, maxAttempts: MAX_QUEUE_ATTEMPTS });
    if (!job) break;
    jobs.push(job);
  }
  return Promise.all(jobs.map((job) => processJobSafely(job, deps)));
}

export async function processJobSafely(job: PrizeSendJob, deps: SenderDeps): Promise<JobOutcome> {
  try {
    return await processJob(job, deps);
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    deps.log.warn('prize send errored, will retry', { jobId: job.id, attempts: job.attempts, error: message });
    try {
      await deps.queue.markPrizeFailed(job.id, message);
    } catch (markErr) {
      // The lock expires on its own and the job is reclaimed.
      deps.log.error('could not record prize send failure', { jobId: job.id, error: String(markErr) });
    }
    return 'retry';
  }
}

type Settled = { kind: 'landed'; signature: string } | { kind: 'all_dead' } | { kind: 'in_flight'; tx: PrizeTx };

/** Looks at every pending tx once. Marks dead ones; reports a landed or still-live one. */
async function settleOnce(txs: PrizeTx[], deps: SenderDeps): Promise<Settled> {
  let live: PrizeTx | null = null;
  for (const tx of txs) {
    if (tx.state !== 'pending') continue;
    // Height first, then status. If height is already past lastValidBlockHeight, the tx could only
    // have landed in a block this node already processed, so the status lookup would see it.
    const height = await deps.chain.getBlockHeight();
    const state = await deps.chain.getSignatureState(tx.signature);
    if (state.kind === 'landed') {
      await deps.txLog.setState(tx.signature, 'landed');
      tx.state = 'landed';
      return { kind: 'landed', signature: tx.signature };
    }
    if (state.kind === 'failed') {
      await deps.txLog.setState(tx.signature, 'failed');
      tx.state = 'failed';
      deps.log.warn('prize tx failed on chain', { signature: tx.signature, error: state.error });
      continue;
    }
    if (state.kind === 'not_found' && height > tx.lastValidBlockHeight) {
      await deps.txLog.setState(tx.signature, 'expired');
      tx.state = 'expired';
      continue;
    }
    live ??= tx; // processing, or not seen yet while its blockhash is still valid
  }
  return live ? { kind: 'in_flight', tx: live } : { kind: 'all_dead' };
}

export async function processJob(job: PrizeSendJob, deps: SenderDeps): Promise<JobOutcome> {
  const { queue, txLog, chain, log } = deps;
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? Date.now;
  const deadline = now() + (deps.settleBudgetMs ?? DEFAULT_SETTLE_BUDGET_MS);
  const ctx = { jobId: job.id, mint: job.nftMint, recipient: job.recipientAddress };

  const txs = await txLog.list(job.id);

  // A signature on the job that our log doesn't know means something else sent for this prize.
  // We can't prove it dead without its blockhash, so a human looks at it.
  if (job.txSignature && !txs.some((t) => t.signature === job.txSignature)) {
    const state = await chain.getSignatureState(job.txSignature);
    if (state.kind === 'landed') {
      await queue.markPrizeSent(job.id, job.txSignature);
      return 'sent';
    }
    return failPermanent(job, deps, 'job has a signature the worker did not record; check it by hand');
  }

  for (;;) {
    // Step 1: settle earlier transactions, waiting while one is still live.
    const settled = await settleOnce(txs, deps);
    if (settled.kind === 'landed') {
      await queue.markPrizeSent(job.id, settled.signature);
      log.info('prize sent', { ...ctx, signature: settled.signature });
      return 'sent';
    }
    if (settled.kind === 'in_flight') {
      if (now() >= deadline) {
        // Leave it 'submitted'; the next claim settles it.
        await queue.markPrizeFailed(job.id, 'transaction still in flight');
        return 'still_in_flight';
      }
      chain.sendRaw(settled.tx.txBase64).catch(() => {}); // best-effort rebroadcast
      await sleep(deps.pollMs ?? 2_000);
      continue;
    }

    // Step 2: every earlier tx is dead. Guards that need a human rather than another try.
    if (!isValidAddress(job.recipientAddress) || job.recipientAddress === chain.hotWallet) {
      return failPermanent(job, deps, 'invalid recipient address');
    }
    if (txs.length >= deps.maxTxsPerPrize) {
      return failPermanent(job, deps, `gave up after ${txs.length} transactions that did not land`);
    }

    // Step 3: check where the NFT actually is right now.
    const asset = await chain.getAsset(job.nftMint);
    if (!asset) return failPermanent(job, deps, 'asset not found on chain');
    if (asset.owner === job.recipientAddress) {
      const lastSig = txs.at(-1)?.signature;
      if (lastSig) {
        log.warn('asset already with winner, marking sent with last known signature', { ...ctx, signature: lastSig });
        await queue.markPrizeSent(job.id, lastSig);
        return 'sent';
      }
      return failPermanent(job, deps, 'winner already holds this asset but no transfer was recorded');
    }
    if (asset.owner !== chain.hotWallet) {
      return failPermanent(job, deps, `hot wallet does not hold this asset (owner ${asset.owner || 'unknown'})`);
    }
    if (asset.standard === 'compressed' || asset.standard === 'unsupported') {
      return failPermanent(job, deps, `transfer not implemented for ${asset.standard} assets`);
    }

    // Step 4: sign, persist, then broadcast. Loop back to step 1 to confirm.
    const signed = await chain.buildSignedTransfer(asset, job.recipientAddress);
    await txLog.insert(job.id, signed);
    await queue.recordSubmittedSignature(job.id, signed.signature);
    txs.push({ ...signed, state: 'pending' });
    try {
      await chain.sendRaw(signed.txBase64);
    } catch (err) {
      // It may still have reached a leader. It stays pending until it lands or expires.
      log.warn('broadcast errored, settling by signature', { ...ctx, signature: signed.signature, error: String(err) });
    }
    await sleep(deps.pollMs ?? 2_000);
  }
}

async function failPermanent(job: PrizeSendJob, deps: SenderDeps, reason: string): Promise<JobOutcome> {
  deps.log.error('prize send needs an admin', { jobId: job.id, mint: job.nftMint, reason });
  await deps.queue.markPrizeFailed(job.id, reason, { permanent: true });
  return 'failed_permanent';
}
