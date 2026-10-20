import type pg from 'pg';
import type { DiscrepancyKind, OpenDiscrepancy, Snapshot, SyncStore, TrackedItem } from './inventorySync.js';
import type { Logger, PrizeTx, SignedTransfer, TxLog, TxState } from './types.js';
import type { OpenProposal, Tier, TopUpStore, VaultCard } from './topUp.js';
import type { ClaimLog } from './feeClaimer.js';

export class PgTxLog implements TxLog {
  constructor(private readonly db: pg.Pool) {}

  async list(prizeSendId: string): Promise<PrizeTx[]> {
    const { rows } = await this.db.query<{
      signature: string;
      last_valid_block_height: string;
      tx_base64: string;
      state: TxState;
    }>(
      `SELECT signature, last_valid_block_height, tx_base64, state
         FROM prize_send_txs WHERE prize_send_id = $1 ORDER BY created_at`,
      [prizeSendId],
    );
    return rows.map((r) => ({
      signature: r.signature,
      lastValidBlockHeight: Number(r.last_valid_block_height),
      txBase64: r.tx_base64,
      state: r.state,
    }));
  }

  /** Throws if another tx for this prize is still pending (unique partial index), so nothing is broadcast. */
  async insert(prizeSendId: string, tx: SignedTransfer): Promise<void> {
    await this.db.query(
      `INSERT INTO prize_send_txs (signature, prize_send_id, last_valid_block_height, tx_base64)
       VALUES ($1, $2, $3, $4)`,
      [tx.signature, prizeSendId, tx.lastValidBlockHeight, tx.txBase64],
    );
  }

  async setState(signature: string, state: TxState): Promise<void> {
    await this.db.query(`UPDATE prize_send_txs SET state = $2, updated_at = now() WHERE signature = $1`, [
      signature,
      state,
    ]);
  }
}

export class PgSyncStore implements SyncStore {
  constructor(private readonly db: pg.Pool) {}

  async listItems(): Promise<TrackedItem[]> {
    const { rows } = await this.db.query<{
      id: string;
      nft_mint: string;
      status: TrackedItem['status'];
      location: TrackedItem['location'];
      value_usd: string;
      send_status: string | null;
    }>(
      `SELECT i.id, i.nft_mint, i.status, i.location, i.value_usd, ps.status AS send_status
         FROM inventory_items i
         LEFT JOIN prize_sends ps ON ps.inventory_item_id = i.id
        WHERE i.status <> 'removed'`,
    );
    return rows.map((r) => ({
      id: r.id,
      nftMint: r.nft_mint,
      status: r.status,
      location: r.location,
      valueUsd: Number(r.value_usd),
      sendStatus: r.send_status,
    }));
  }

  async listOpenDiscrepancies(): Promise<OpenDiscrepancy[]> {
    const { rows } = await this.db.query<{
      id: string;
      nft_mint: string;
      kind: DiscrepancyKind;
      inventory_item_id: string | null;
      auto_withheld: boolean;
    }>(`SELECT id, nft_mint, kind, inventory_item_id, auto_withheld FROM inventory_discrepancies WHERE resolved_at IS NULL`);
    return rows.map((r) => ({
      id: String(r.id),
      nftMint: r.nft_mint,
      kind: r.kind,
      inventoryItemId: r.inventory_item_id,
      autoWithheld: r.auto_withheld,
    }));
  }

  async upsertDiscrepancy(d: {
    nftMint: string;
    kind: DiscrepancyKind;
    inventoryItemId: string | null;
    autoWithheld: boolean;
    details: Record<string, unknown>;
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO inventory_discrepancies (nft_mint, kind, inventory_item_id, auto_withheld, details)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (nft_mint, kind) WHERE resolved_at IS NULL
       DO UPDATE SET last_seen_at = now(), details = EXCLUDED.details,
                     auto_withheld = inventory_discrepancies.auto_withheld OR EXCLUDED.auto_withheld`,
      [d.nftMint, d.kind, d.inventoryItemId, d.autoWithheld, JSON.stringify(d.details)],
    );
  }

  async resolveDiscrepancy(id: string): Promise<void> {
    await this.db.query(`UPDATE inventory_discrepancies SET resolved_at = now() WHERE id = $1`, [id]);
  }

  async moveToHot(id: string): Promise<boolean> {
    const r = await this.db.query(
      `UPDATE inventory_items SET location = 'hot', status = 'available'
        WHERE id = $1 AND location = 'vault' AND status = 'withheld'`,
      [id],
    );
    return r.rowCount === 1;
  }

  async writeSnapshot(s: Snapshot): Promise<void> {
    await this.db.query(
      `INSERT INTO vault_snapshots (hot_wallet, held_count, tracked_count, available_count, available_value_usd)
       VALUES ($1, $2, $3, $4, $5)`,
      [s.hotWallet, s.heldCount, s.trackedCount, s.availableCount, s.availableValueUsd],
    );
  }
}

/** The dedicated connection that holds the prize-sender lock (a pg.Client in production, a fake in tests). */
export interface LockConnection {
  query<R = any>(sql: string, params?: unknown[]): Promise<{ rows: R[] }>;
  on(event: 'error', fn: (err: Error) => void): unknown;
  on(event: 'end', fn: () => void): unknown;
  end(): Promise<void>;
}

export interface SingletonLockOptions {
  /** Called once if the lock may no longer be held (connection died or stopped answering). Stop sending. */
  onLost: (reason: string) => void;
  log: Logger;
  /** Keep retrying for this long before giving up (another sender is really running). */
  maxWaitMs?: number;
  /** How often to confirm the lock is still held on its connection. */
  heartbeatMs?: number;
  /** Aborting (SIGTERM during a deploy) stops the retry loop; acquire then returns null. */
  signal?: AbortSignal;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const HEARTBEAT_TIMEOUT_MS = 10_000;

/**
 * Takes a session-level advisory lock on its own dedicated connection, so only one prize sender runs.
 *
 * Startup retries with backoff instead of failing at once: after a deploy, the old machine's lock can
 * linger on the session pooler for a few seconds after that process is gone. Only pg_try_advisory_lock
 * ever grants the lock, so retrying never weakens the single-sender guarantee; if it is still held after
 * maxWaitMs, another sender really is running and this throws.
 *
 * Once held, the lock lives as long as this connection. A heartbeat confirms it is still granted; if the
 * connection errors, closes, or stops answering, onLost fires so the caller stops sending and exits.
 * Returns a release function, or null when the signal aborted before the lock was taken.
 */
export async function acquireSingletonLock(
  connect: () => Promise<LockConnection>,
  name: string,
  opts: SingletonLockOptions,
): Promise<(() => Promise<void>) | null> {
  const { onLost, log, maxWaitMs = 120_000, heartbeatMs = 15_000, signal } = opts;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const started = now();
  let delay = 1_000;
  let client: LockConnection | null = null;

  for (let attempt = 1; ; attempt++) {
    if (signal?.aborted) {
      await client?.end().catch(() => {});
      return null;
    }
    let reason: string;
    try {
      if (!client) {
        const c = await connect();
        // Until the lock is held a dead connection just means "connect again"; this keeps 'error' from crashing.
        c.on('error', () => {});
        client = c;
      }
      const { rows } = await client.query<{ ok: boolean }>('SELECT pg_try_advisory_lock(hashtext($1)) AS ok', [name]);
      if (rows[0]?.ok) break;
      reason = 'held by another session';
    } catch (err) {
      reason = `connection failed: ${err instanceof Error ? err.message : String(err)}`;
      await client?.end().catch(() => {});
      client = null;
    }
    const waited = now() - started;
    if (waited + delay > maxWaitMs) {
      await client?.end().catch(() => {});
      throw new Error(`could not take the ${name} lock after ${Math.round(waited / 1000)}s (${reason}); another prize sender may be running`);
    }
    log.warn('prize-sender lock not available yet, retrying', { attempt, reason, retryInMs: delay });
    await sleep(delay);
    delay = Math.min(delay * 2, 15_000);
  }

  const held = client!;
  let done = false;
  const lose = (reason: string) => {
    if (done) return;
    done = true;
    clearInterval(timer);
    held.end().catch(() => {});
    onLost(reason);
  };
  held.on('error', (err) => lose(`lock connection error: ${err.message}`));
  held.on('end', () => lose('lock connection closed'));

  const timer = setInterval(() => {
    // This connection holds nothing but this lock, so any granted advisory lock on its backend is ours.
    const check = held.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND granted AND pid = pg_backend_pid()`,
    );
    const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('heartbeat timed out')), HEARTBEAT_TIMEOUT_MS));
    Promise.race([check, timeout]).then(
      (r) => { if (!((r.rows[0]?.n ?? 0) > 0)) lose('lock no longer granted'); },
      (err) => lose(`lock heartbeat failed: ${err instanceof Error ? err.message : String(err)}`),
    );
  }, heartbeatMs);
  timer.unref?.();

  return async () => {
    if (done) return;
    done = true;
    clearInterval(timer);
    try {
      await held.query('SELECT pg_advisory_unlock_all()');
    } finally {
      await held.end().catch(() => {});
    }
  };
}

export class PgTopUpStore implements TopUpStore {
  constructor(private readonly db: pg.Pool, private readonly multisig: string) {}

  async openProposal(): Promise<OpenProposal | null> {
    const { rows } = await this.db.query<{ id: string; transaction_index: string; status: 'creating' | 'active'; created_at: Date }>(
      `SELECT id, transaction_index, status, created_at FROM topup_proposals
        WHERE multisig = $1 AND status IN ('creating', 'active') ORDER BY id LIMIT 1`,
      [this.multisig],
    );
    const r = rows[0];
    return r ? { id: String(r.id), transactionIndex: BigInt(r.transaction_index), status: r.status, createdAt: r.created_at } : null;
  }

  async vaultCandidates(): Promise<VaultCard[]> {
    const { rows } = await this.db.query<{ id: string; nft_mint: string; tier: Tier; value_usd: string }>(
      `SELECT i.id, i.nft_mint, i.tier, i.value_usd FROM inventory_items i
        WHERE i.location = 'vault' AND i.status = 'withheld'
          AND NOT EXISTS (
            SELECT 1 FROM topup_proposal_items pi JOIN topup_proposals p ON p.id = pi.proposal_id
             WHERE pi.inventory_item_id = i.id AND p.status IN ('creating', 'active', 'executed'))
        ORDER BY i.acquired_at, i.id`,
    );
    return rows.map((r) => ({ id: r.id, nftMint: r.nft_mint, tier: r.tier, valueUsd: Number(r.value_usd) }));
  }

  async availableByTier(): Promise<Record<Tier, number>> {
    const { rows } = await this.db.query<{ tier: Tier; n: number }>(
      `SELECT i.tier, count(*)::int AS n FROM inventory_items i
        WHERE i.status = 'available'
           OR (i.location = 'vault' AND i.status = 'withheld' AND EXISTS (
                SELECT 1 FROM topup_proposal_items pi JOIN topup_proposals p ON p.id = pi.proposal_id
                 WHERE pi.inventory_item_id = i.id AND p.status = 'executed'))
        GROUP BY i.tier`,
    );
    const out: Record<Tier, number> = { common: 0, uncommon: 0, rare: 0, grail: 0 };
    for (const r of rows) out[r.tier] = r.n;
    return out;
  }

  async insertProposal(p: { transactionIndex: bigint; solLamports: bigint; cards: VaultCard[] }): Promise<string> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO topup_proposals (multisig, transaction_index, sol_lamports) VALUES ($1, $2, $3) RETURNING id`,
        [this.multisig, p.transactionIndex.toString(), p.solLamports.toString()],
      );
      const id = String(rows[0]!.id);
      for (const c of p.cards) {
        await client.query(
          `INSERT INTO topup_proposal_items (proposal_id, inventory_item_id, nft_mint) VALUES ($1, $2, $3)`,
          [id, c.id, c.nftMint],
        );
      }
      await client.query('COMMIT');
      return id;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async setStatus(id: string, status: 'active' | 'rejected' | 'cancelled' | 'stale' | 'abandoned', note?: string): Promise<void> {
    await this.db.query(
      `UPDATE topup_proposals SET status = $2, note = COALESCE($3, note), updated_at = now()
        WHERE id = $1 AND status IN ('creating', 'active')`,
      [id, status, note ?? null],
    );
  }

  async markExecuted(id: string): Promise<void> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{ transaction_index: string; sol_lamports: string }>(
        `UPDATE topup_proposals SET status = 'executed', updated_at = now()
          WHERE id = $1 AND status IN ('creating', 'active') RETURNING transaction_index, sol_lamports`,
        [id],
      );
      const p = rows[0];
      if (p) {
        const note = `Squads transaction #${p.transaction_index}`;
        await client.query(
          `INSERT INTO treasury_events (kind, amount, asset, usd_value, note, inventory_item_id)
           SELECT 'topup', 1, pi.nft_mint, i.value_usd, $2, i.id
             FROM topup_proposal_items pi JOIN inventory_items i ON i.id = pi.inventory_item_id
            WHERE pi.proposal_id = $1`,
          [id, note],
        );
        if (BigInt(p.sol_lamports) > 0n) {
          await client.query(
            `INSERT INTO treasury_events (kind, amount, asset, note) VALUES ('topup', $1::numeric / 1e9, 'SOL', $2)`,
            [p.sol_lamports, note],
          );
        }
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

export class PgClaimLog implements ClaimLog {
  constructor(private readonly db: pg.Pool) {}

  async recordClaim(e: { signature: string; amount: string | null; asset: string; note: string }): Promise<void> {
    await this.db.query(
      `INSERT INTO treasury_events (kind, amount, asset, tx_signature, note) VALUES ('claim', $1, $2, $3, $4)`,
      [e.amount, e.asset, e.signature, e.note],
    );
  }
}
