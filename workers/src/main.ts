import pg from 'pg';
import {
  claimNextPrizeSend,
  expireStaleCrates,
  markPrizeFailed,
  markPrizeSent,
  pgSsl,
  pruneLocationPings,
  recordSubmittedSignature,
  setInventoryStatus,
} from '@lotus/server';
import { loadConfig, parseSecretKey } from './config.js';
import { collectionOf, dasGetAssetsByOwner } from './das.js';
import { runInventorySync } from './inventorySync.js';
import { Keypair } from '@solana/web3.js';
import { acquireSingletonLock, PgClaimLog, PgSyncStore, PgTopUpStore, PgTxLog } from './pg.js';
import { createSquadsGateway } from './squads.js';
import { runTopUpTick } from './topUp.js';
import { runFeeClaimTick } from './feeClaimer.js';
import { createPumpFeeGateway } from './pumpFees.js';
import { MAX_QUEUE_ATTEMPTS, runPrizeSenderTick } from './prizeSender.js';
import { createSolanaChain } from './solanaChain.js';
import { jsonLogger as log, type PrizeQueue } from './types.js';

/**
 * Scheduler: a plain Node process with one loop per job. Each loop awaits its tick, then sleeps
 * for its interval, so ticks never overlap. Deploy as one always-on worker (Railway/Fly). Chosen
 * over Inngest/Trigger.dev because it needs no extra account and the prize sender wants a
 * long-lived process holding a DB lock.
 *
 *   tsx src/main.ts all | prize-sender | inventory-sync | maintenance | top-up | fee-claimer
 *
 * 'all' includes top-up only when SQUADS_MULTISIG_ADDRESS and SQUADS_PROPOSER_SECRET_KEY are set,
 * and fee-claimer only when PUMP_COIN_MINT and FEE_CLAIMER_SECRET_KEY are set.
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
  if (!['all', 'prize-sender', 'inventory-sync', 'maintenance', 'top-up', 'fee-claimer'].includes(mode)) {
    throw new Error(`unknown mode ${mode}`);
  }
  const config = loadConfig();
  const db = new pg.Pool({ connectionString: config.DATABASE_URL, ssl: pgSsl(config.DATABASE_URL), max: 10, connectionTimeoutMillis: 10_000 });
  // An idle connection dropped by the pooler emits 'error' on the pool; unhandled, it would crash every loop.
  db.on('error', (err) => log.error('pg pool idle client error', { error: err.message }));
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
    const prizesOwnedBy = async (owner: string) =>
      (await dasGetAssetsByOwner(dasUrl, owner))
        .map((a) => ({ mint: a.id, name: a.content?.metadata?.name ?? null, collection: collectionOf(a) }))
        .filter((a) => allowed.size === 0 || (a.collection !== null && allowed.has(a.collection)));
    const vault = config.SQUADS_VAULT_ADDRESS;
    loops.push(loop('inventory-sync', config.INVENTORY_SYNC_INTERVAL_MS, async () => {
      await runInventorySync({
        listHeld: () => prizesOwnedBy(chain.hotWallet),
        listVaultHeld: vault ? () => prizesOwnedBy(vault) : undefined,
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
    loops.push(loop('prune-pings', 3_600_000, async () => {
      const n = await pruneLocationPings({ retentionDays: config.PING_RETENTION_DAYS }, db);
      if (n) log.info('pruned old location pings', { count: n });
    }, controller.signal));
  }

  // Treasury jobs build their gateway inside the loop: a refusal or RPC blip at startup is logged
  // and retried each interval, and never stops the prize sender or inventory sync.
  const squadsOn = Boolean(config.SQUADS_MULTISIG_ADDRESS && config.SQUADS_PROPOSER_SECRET_KEY);
  if (mode === 'top-up' && !squadsOn) throw new Error('top-up needs SQUADS_MULTISIG_ADDRESS and SQUADS_PROPOSER_SECRET_KEY');
  if (mode === 'all' && !squadsOn) log.info('top-up proposer disabled: SQUADS_MULTISIG_ADDRESS / SQUADS_PROPOSER_SECRET_KEY not set');
  if ((mode === 'all' || mode === 'top-up') && squadsOn) {
    const multisigAddress = config.SQUADS_MULTISIG_ADDRESS!;
    let deps: Parameters<typeof runTopUpTick>[0] | null = null;
    loops.push(loop('top-up', config.TOPUP_INTERVAL_MS, async () => {
      if (!deps) {
        const squads = await createSquadsGateway({
          rpcUrl: config.SOLANA_RPC_URL,
          multisigAddress,
          proposer: Keypair.fromSecretKey(parseSecretKey(config.SQUADS_PROPOSER_SECRET_KEY!, 'SQUADS_PROPOSER_SECRET_KEY')),
          hotWallet: chain.hotWallet,
          expectedVault: config.SQUADS_VAULT_ADDRESS,
          minThreshold: config.SQUADS_MIN_THRESHOLD,
          allowMainnet: config.LOTUS_ALLOW_MAINNET,
          getAsset: (mint) => chain.getAsset(mint),
          log,
        });
        log.info('top-up proposer on', { multisig: multisigAddress, vault: squads.vault });
        deps = {
          store: new PgTopUpStore(db, multisigAddress),
          squads,
          policy: {
            targets: config.TOPUP_TARGETS,
            maxCards: config.TOPUP_MAX_CARDS,
            maxUsd: config.TOPUP_MAX_USD,
            minHotLamports: BigInt(Math.round(config.TOPUP_MIN_HOT_SOL * 1e9)),
            solTopUpLamports: BigInt(Math.round(config.TOPUP_SOL_AMOUNT * 1e9)),
          },
          log,
        };
      }
      const r = await runTopUpTick(deps);
      if (r.kind !== 'idle' || r.skippedByCap) log.info('top-up tick', r);
    }, controller.signal));
  }

  const feesOn = Boolean(config.PUMP_COIN_MINT && config.FEE_CLAIMER_SECRET_KEY);
  if (mode === 'fee-claimer' && !feesOn) throw new Error('fee-claimer needs PUMP_COIN_MINT and FEE_CLAIMER_SECRET_KEY');
  if (mode === 'all' && !feesOn) log.info('fee claimer disabled: PUMP_COIN_MINT / FEE_CLAIMER_SECRET_KEY not set');
  if ((mode === 'all' || mode === 'fee-claimer') && feesOn) {
    const vault = config.SQUADS_VAULT_ADDRESS!;
    let deps: Parameters<typeof runFeeClaimTick>[0] | null = null;
    loops.push(loop('fee-claimer', config.FEE_CLAIM_INTERVAL_MS, async () => {
      if (!deps) {
        const gateway = await createPumpFeeGateway({
          rpcUrl: config.SOLANA_RPC_URL,
          coinMint: config.PUMP_COIN_MINT!,
          vault,
          payer: Keypair.fromSecretKey(parseSecretKey(config.FEE_CLAIMER_SECRET_KEY!, 'FEE_CLAIMER_SECRET_KEY')),
          allowMainnet: config.LOTUS_ALLOW_MAINNET,
          priorityFeeMicroLamports: config.PRIORITY_FEE_MICROLAMPORTS,
        });
        log.info('fee claimer on', { coin: config.PUMP_COIN_MINT, vault });
        deps = {
          gateway,
          claims: new PgClaimLog(db),
          vault,
          minVaultShareBps: config.FEE_MIN_VAULT_SHARE_BPS,
          minClaim: BigInt(config.FEE_CLAIM_MIN_BASE_UNITS),
          minGasLamports: BigInt(Math.round(config.FEE_CLAIMER_MIN_GAS_SOL * 1e9)),
          log,
        };
      }
      const r = await runFeeClaimTick(deps);
      if (r.kind !== 'below_minimum') log.info('fee claim tick', r);
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
