import pg from 'pg';
import {
  claimNextPrizeSend,
  expireStaleCrates,
  markPrizeFailed,
  markPrizeSent,
  pgSsl,
  pruneHolderWindows,
  pruneLocationPings,
  recordSubmittedSignature,
  seedWorldCrates,
  setInventoryStatus,
} from '@lotus/server';
import { loadConfig, parseSecretKey } from './config.js';
import { collectionOf, dasGetAssetsByOwner } from './das.js';
import { runInventorySync } from './inventorySync.js';
import { Connection, Keypair } from '@solana/web3.js';
import { acquireSingletonLock, PgBuyerStore, PgClaimLog, PgSyncStore, PgTopUpStore, PgTxLog } from './pg.js';
import { createSquadsGateway } from './squads.js';
import { runTopUpTick } from './topUp.js';
import { runCreatorFeeTick, runFeeClaimTick } from './feeClaimer.js';
import { createPumpFeeGateway } from './pumpFees.js';
import { createCreatorFeeGateway } from './creatorFees.js';
import { createFloatFeeGateway } from './floatFees.js';
import { runBuyTick } from './cardBuyer.js';
import { createBuyerGateway } from './buyerGateway.js';
import { jupiterSolUsd } from './magicEden.js';
import { createBuyCoreBuilder, createCollectorCrypt, createOnChainListings } from './collectorCrypt.js';
import { createJupiterSwap, createJupiterSwapToSol } from './jupiterSwap.js';
import { dasGetAsset, dasGetAssetBatch } from './das.js';
import { MAX_QUEUE_ATTEMPTS, runPrizeSenderTick } from './prizeSender.js';
import { createSolanaChain } from './solanaChain.js';
import { jsonLogger as log, type PrizeQueue } from './types.js';

/**
 * Scheduler: a plain Node process with one loop per job. Each loop awaits its tick, then sleeps
 * for its interval, so ticks never overlap. Deploy as one always-on worker (Fly). Chosen
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
  if (!['all', 'prize-sender', 'inventory-sync', 'maintenance', 'top-up', 'fee-claimer', 'card-buyer'].includes(mode)) {
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
  let lockLost = false;
  // Registered before taking the lock: a deploy can SIGTERM us while we are still waiting for it.
  const shutdown = () => {
    log.info('shutting down after current ticks finish');
    controller.abort();
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  if (mode === 'all' || mode === 'prize-sender') {
    // The lock belongs to the Postgres backend, so take it over a direct connection when one is configured:
    // through the session pooler a backend (and our lock) can outlive this process and be handed to another client.
    const lockUrl = config.DATABASE_LOCK_URL ?? config.DATABASE_URL;
    const connectLock = async () => {
      const c = new pg.Client({ connectionString: lockUrl, ssl: pgSsl(lockUrl), connectionTimeoutMillis: 10_000, keepAlive: true });
      await c.connect();
      // If this machine dies without closing the socket, Postgres must notice fast or the orphaned backend keeps
      // the lock and the next worker can't start. Server-side keepalives drop a dead peer in ~25 s; as a backstop,
      // idle_session_timeout ends a session that sends nothing for 60 s (the lock heartbeat runs every 15 s).
      await c.query(
        "SET tcp_keepalives_idle = 10; SET tcp_keepalives_interval = 5; SET tcp_keepalives_count = 3; SET idle_session_timeout = '60s'",
      );
      return c;
    };
    releaseLock = await acquireSingletonLock(connectLock, 'lotus:prize-sender', {
      log,
      // A lock on a different database would exclude nothing: check the main pool sees it on the same cluster.
      verify: async (conn) => {
        const a = (await conn.query<{ pid: number; db: string; started: Date }>(
          'SELECT pg_backend_pid() AS pid, current_database() AS db, pg_postmaster_start_time() AS started',
        )).rows[0]!;
        const b = (await db.query<{ db: string; started: Date; seen: boolean }>(
          `SELECT current_database() AS db, pg_postmaster_start_time() AS started,
                  EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND granted AND pid = $1
                            AND database = (SELECT oid FROM pg_database WHERE datname = current_database())) AS seen`,
          [a.pid],
        )).rows[0]!;
        if (a.db !== b.db || new Date(a.started).getTime() !== new Date(b.started).getTime() || !b.seen) {
          throw new Error('DATABASE_LOCK_URL does not point at the same database as DATABASE_URL');
        }
      },
      signal: controller.signal,
      onLost: (reason) => {
        // Another machine could take the lock now, so stop everything and let the restart re-acquire it.
        lockLost = true;
        log.error('lost the prize-sender lock; stopping', { reason });
        controller.abort();
        // Backstop if a tick never returns: exit anyway after the longest legitimate send settles (~140 s).
        setTimeout(() => process.exit(1), 200_000).unref();
      },
    });
    if (!releaseLock) {
      log.info('stopped before the prize-sender lock was taken');
      await db.end();
      return;
    }
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
    // Keeps the shared map stocked: tops each launch city up to its target, within the global
    // per-day ceiling. Spots come from a fixed grid, so this needs the database and nothing else.
    loops.push(loop('seed-crates', config.CRATE_SEED_INTERVAL_MS, async () => {
      const r = await seedWorldCrates({}, db);
      if (r.created || r.shortfall) log.info('seeded world crates', { ...r });
      if (r.noRoom) log.warn('a city had no free spot for a crate', { cities: r.noRoom });
    }, controller.signal));
    loops.push(loop('prune-pings', 3_600_000, async () => {
      const n = await pruneLocationPings({ retentionDays: config.PING_RETENTION_DAYS }, db);
      if (n) log.info('pruned old location pings', { count: n });
    }, controller.signal));
    // Coin holder windows that ended over a day ago. Harmless to keep, but there is one row per
    // player and nothing reads a window once it has expired.
    loops.push(loop('prune-holder-windows', 6 * 3_600_000, async () => {
      const n = await pruneHolderWindows(db);
      if (n) log.info('pruned expired holder windows', { count: n });
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

  const floatFees = config.FLOAT_FEES === 'yes';
  const oneWalletFees = config.ONE_WALLET_FEES === 'yes' || floatFees;
  const feesOn = oneWalletFees || Boolean(config.PUMP_COIN_MINT && config.FEE_CLAIMER_SECRET_KEY);
  if (mode === 'fee-claimer' && !feesOn) throw new Error('fee-claimer needs FLOAT_FEES=yes (or PUMP_COIN_MINT and FEE_CLAIMER_SECRET_KEY, or ONE_WALLET_FEES=yes)');
  if (mode === 'all' && !feesOn) log.info('fee claimer disabled: PUMP_COIN_MINT / FEE_CLAIMER_SECRET_KEY not set');
  if ((mode === 'all' || mode === 'fee-claimer') && oneWalletFees) {
    let deps: Parameters<typeof runCreatorFeeTick>[0] | null = null;
    loops.push(loop('fee-claimer', config.FEE_CLAIM_INTERVAL_MS, async () => {
      if (!deps) {
        const wallet = Keypair.fromSecretKey(parseSecretKey(config.HOT_WALLET_SECRET_KEY));
        const swapOpts = {
          priorityFeeMicroLamports: config.PRIORITY_FEE_MICROLAMPORTS,
          buildSwapIn: createJupiterSwapToSol({ slippageBps: config.FEE_SWAP_SLIPPAGE_BPS }),
          maxPriceImpact: config.FEE_SWAP_MAX_IMPACT_BPS / 10_000,
        };
        const gateway = floatFees
          ? await createFloatFeeGateway({ rpcUrl: config.SOLANA_RPC_URL, pairMint: config.FLOAT_PAIR_MINT, wallet, allowMainnet: config.LOTUS_ALLOW_MAINNET, ...swapOpts })
          : await createCreatorFeeGateway({ rpcUrl: config.SOLANA_RPC_URL, coinMint: config.PUMP_COIN_MINT!, wallet, allowMainnet: config.LOTUS_ALLOW_MAINNET, ...swapOpts });
        log.info(floatFees ? 'fee sweeper on (Float, one wallet)' : 'fee claimer on (one wallet)', floatFees ? { pair: config.FLOAT_PAIR_MINT } : { coin: config.PUMP_COIN_MINT });
        deps = {
          gateway,
          claims: new PgClaimLog(db),
          minClaim: BigInt(config.FEE_CLAIM_MIN_BASE_UNITS),
          minSwap: BigInt(config.FEE_SWAP_MIN_BASE_UNITS),
          minGasLamports: BigInt(Math.round(config.FEE_CLAIMER_MIN_GAS_SOL * 1e9)),
          solUsd: async () => {
            const p = await jupiterSolUsd();
            if (!(p >= config.SOL_USD_MIN && p <= config.SOL_USD_MAX)) throw new Error(`SOL price ${p} is outside the sanity range ${config.SOL_USD_MIN}-${config.SOL_USD_MAX}`);
            return p;
          },
          cardFundBps: config.FEE_CARD_FUND_BPS,
          usdcShareBps: floatFees ? config.FEE_USDC_SHARE_BPS : 0,
          log,
        };
      }
      const r = await runCreatorFeeTick(deps);
      if (r.kind !== 'idle') log.info('creator fee tick', r);
    }, controller.signal));
  }
  if ((mode === 'all' || mode === 'fee-claimer') && feesOn && !oneWalletFees) {
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
          solUsd: () => jupiterSolUsd(),
          cardFundBps: config.FEE_CARD_FUND_BPS,
          log,
        };
      }
      const r = await runFeeClaimTick(deps);
      if (r.kind !== 'below_minimum') log.info('fee claim tick', r);
    }, controller.signal));
  }

  const buyerOn = Boolean(config.BUYER_SPENDING_LIMIT) || config.ONE_WALLET_BUYER === 'yes';
  if (mode === 'card-buyer' && !buyerOn) throw new Error('card-buyer needs BUYER_SPENDING_LIMIT and SQUADS_MULTISIG_ADDRESS (or ONE_WALLET_BUYER=yes)');
  if (mode === 'all' && !buyerOn) log.info('card buyer disabled: BUYER_SPENDING_LIMIT not set');
  if ((mode === 'all' || mode === 'card-buyer') && buyerOn) {
    let deps: Parameters<typeof runBuyTick>[0] | null = null;
    loops.push(loop('card-buyer', config.BUY_INTERVAL_MS, async () => {
      if (!deps) {
        const market = config.BUY_LISTING_SOURCE === 'chain'
          ? createOnChainListings({
            connection: new Connection(config.SOLANA_RPC_URL, 'confirmed'),
            collection: config.BUY_COLLECTION_ADDRESS!,
            getAssets: (ids) => dasGetAssetBatch(config.HELIUS_DAS_URL ?? config.SOLANA_RPC_URL, ids),
            maxPriceUsd: config.BUY_MAX_USD_PER_CARD,
            limit: config.BUY_CHAIN_LISTING_LIMIT,
          })
          : createCollectorCrypt({ collection: config.BUY_COLLECTION_ADDRESS!, pages: config.BUY_LISTING_PAGES, category: config.BUY_REQUIRED_TRAITS.Category });
        const buildBuyTx = createBuyCoreBuilder({ connection: new Connection(config.SOLANA_RPC_URL, 'confirmed'), collection: config.BUY_COLLECTION_ADDRESS! });
        const gateway = await createBuyerGateway({
          rpcUrl: config.SOLANA_RPC_URL,
          hot: Keypair.fromSecretKey(parseSecretKey(config.HOT_WALLET_SECRET_KEY)),
          multisigAddress: config.BUYER_SPENDING_LIMIT ? config.SQUADS_MULTISIG_ADDRESS : undefined,
          spendingLimitAddress: config.BUYER_SPENDING_LIMIT,
          allowMainnet: config.LOTUS_ALLOW_MAINNET,
          buildBuyTx,
          buildSwapTx: createJupiterSwap({ slippageBps: config.BUY_SWAP_SLIPPAGE_BPS }),
          solUsd: () => jupiterSolUsd(),
          solUsdBounds: [config.SOL_USD_MIN, config.SOL_USD_MAX],
          getOwner: async (mint) => (await chain.getAsset(mint))?.owner ?? null,
          getCard: async (mint) => {
            // Collection from chain state (verified only); traits and authorities from DAS.
            const [asset, das] = await Promise.all([chain.getAsset(mint), dasGetAsset(config.HELIUS_DAS_URL ?? config.SOLANA_RPC_URL, mint)]);
            if (!asset || !das) return null;
            const attributes: Record<string, string> = {};
            for (const a of das.content?.metadata?.attributes ?? []) attributes[a.trait_type] = String(a.value);
            return {
              collection: asset.collection,
              authorities: (das.authorities ?? []).map((a) => a.address),
              name: das.content?.metadata?.name ?? asset.name,
              image: das.content?.links?.image ?? null,
              attributes,
            };
          },
          collectionAddress: config.BUY_COLLECTION_ADDRESS!,
          updateAuthority: config.BUY_UPDATE_AUTHORITY!,
        });
        log.info('card buyer on', {
          spendingLimit: config.BUYER_SPENDING_LIMIT, limitSol: gateway.limit.amountSol, period: gateway.limit.period, collection: config.BUY_COLLECTION_ADDRESS,
        });
        deps = {
          store: new PgBuyerStore(db),
          gateway,
          market,
          policy: {
            tierMix: config.BUY_TIER_MIX,
            payoutDays: config.LOTUS_POOL_PAYOUT_DAYS,
            stockDays: config.BUY_STOCK_DAYS,
            tierMinUsd: config.BUY_TIER_MIN_USD,
            requiredTraits: config.BUY_REQUIRED_TRAITS,
            valueTrait: config.BUY_VALUE_TRAIT,
            gradeTrait: config.BUY_GRADE_TRAIT || null,
            maxPriceToValue: config.BUY_MAX_PRICE_TO_VALUE,
            maxLamportsPerCard: BigInt(Math.round(config.BUY_MAX_SOL_PER_CARD * 1e9)),
            maxCardsPerTick: config.BUY_MAX_CARDS_PER_TICK,
            maxOverheadBps: config.BUY_MAX_OVERHEAD_BPS,
            maxPriceUsd: config.BUY_MAX_USD_PER_CARD,
          },
          gasReserveLamports: BigInt(Math.round(config.BUY_GAS_RESERVE_SOL * 1e9)),
          weeklyMaxLamports: BigInt(Math.round(config.BUY_WEEKLY_MAX_SOL * 1e9)),
          log,
        };
      }
      const r = await runBuyTick(deps);
      if (r.kind !== 'idle' || r.reason !== 'stocked') log.info('card buyer tick', r);
    }, controller.signal));
  }

  await Promise.all(loops);
  if (releaseLock) await releaseLock();
  await db.end();
  if (lockLost) process.exitCode = 1;
}

main().catch((err) => {
  log.error('workers crashed', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
