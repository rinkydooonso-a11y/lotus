import pg from 'pg';
import {
  claimNextPrizeSend,
  expireStaleCrates,
  markPrizeFailed,
  markPrizeSent,
  pgSsl,
  recordSubmittedSignature,
  setInventoryStatus,
} from '@lotus/server';
import { loadConfig } from './config.js';
import { collectionOf, dasGetAssetsByOwner } from './das.js';
import { runInventorySync } from './inventorySync.js';
import { acquireSingletonLock, PgSyncStore, PgTxLog } from './pg.js';
import { MAX_QUEUE_ATTEMPTS, runPrizeSenderTick } from './prizeSender.js';
import { createSolanaChain } from './solanaChain.js';
import { jsonLogger as log, type PrizeQueue } from './types.js';

/**
 * Scheduler: a plain Node process with one loop per job. Each loop awaits its tick, then sleeps
 * for its interval, so ticks never overlap. Deploy as one always-on worker (Railway/Fly). Chosen
 * over Inngest/Trigger.dev because it needs no extra account and the prize sender wants a
 * long-lived process holding a DB lock.
 *
 *   tsx src/main.ts all | prize-sender | inventory-sync | maintenance
 */

function loop(name: string, intervalMs: number, tick: () => Promise<void>, signal: AbortSignal): Promise<void> {
  return (async () => {
    while (!signal.aborted) {
      try {
        await tick();
      } catch (err) {
        log.error(`${name} tick failed`, { error: err instanceof Error ? err.message : String(err) });
      }
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, intervalMs);
        signal.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
      });
    }
  })();
}

async function main() {
  const mode = process.argv[2] ?? 'all';
  if (!['all', 'prize-sender', 'inventory-sync', 'maintenance'].includes(mode)) {
    throw new Error(`unknown mode ${mode}`);
  }
  const config = loadConfig();
  const db = new pg.Pool({ connectionString: config.DATABASE_URL, ssl: pgSsl(config.DATABASE_URL), max: 10 });
  const chain = await createSolanaChain(config);
  log.info('workers starting', { mode, hotWallet: chain.hotWallet });

  const controller = new AbortController();
  const loops: Promise<void>[] = [];
  let releaseLock: (() => Promise<void>) | null = null;

  if (mode === 'all' || mode === 'prize-sender') {
    releaseLock = await acquireSingletonLock(db, 'lotus:prize-sender');
    if (!releaseLock) throw new Error('another prize sender is already running');
    const queue: PrizeQueue = {
      claimNextPrizeSend: (opts) => claimNextPrizeSend(opts, db),
      recordSubmittedSignature: (id, sig) => recordSubmittedSignature(id, sig, db),
      markPrizeSent: (id, sig) => markPrizeSent(id, sig, db),
      markPrizeFailed: (id, err, opts) => markPrizeFailed(id, err, { ...opts, maxAttempts: MAX_QUEUE_ATTEMPTS }, db),
    };
    const deps = { queue, txLog: new PgTxLog(db), chain, log, maxTxsPerPrize: config.PRIZE_SENDER_MAX_ATTEMPTS };
    loops.push(loop('prize-sender', config.PRIZE_SENDER_INTERVAL_MS, async () => {
      const outcomes = await runPrizeSenderTick(deps, config.PRIZE_SENDER_BATCH);
      if (outcomes.length) log.info('prize sender tick', { outcomes });
    }, controller.signal));
  }

  if (mode === 'all' || mode === 'inventory-sync') {
    const dasUrl = config.HELIUS_DAS_URL ?? config.SOLANA_RPC_URL;
    const allowed = new Set(config.PRIZE_COLLECTIONS);
    const store = new PgSyncStore(db);
    loops.push(loop('inventory-sync', config.INVENTORY_SYNC_INTERVAL_MS, async () => {
      await runInventorySync({
        listHeld: async () =>
          (await dasGetAssetsByOwner(dasUrl, chain.hotWallet))
            .map((a) => ({ mint: a.id, name: a.content?.metadata?.name ?? null, collection: collectionOf(a) }))
            .filter((a) => allowed.size === 0 || (a.collection !== null && allowed.has(a.collection))),
        store,
        chain,
        setInventoryStatus: (id, status) => setInventoryStatus(id, status, db),
        log,
      });
    }, controller.signal));
  }

  if (mode === 'all' || mode === 'maintenance') {
    loops.push(loop('expire-crates', 60_000, async () => {
      const n = await expireStaleCrates(db);
      if (n) log.info('expired stale crates', { count: n });
    }, controller.signal));
  }

  const shutdown = () => {
    log.info('shutting down after current ticks finish');
    controller.abort();
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  await Promise.all(loops);
  if (releaseLock) await releaseLock();
  await db.end();
}

main().catch((err) => {
  log.error('workers crashed', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
