import type pg from 'pg';
import type { DiscrepancyKind, OpenDiscrepancy, Snapshot, SyncStore, TrackedItem } from './inventorySync.js';
import type { PrizeTx, SignedTransfer, TxLog, TxState } from './types.js';

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
      value_usd: string;
      send_status: string | null;
    }>(
      `SELECT i.id, i.nft_mint, i.status, i.value_usd, ps.status AS send_status
         FROM inventory_items i
         LEFT JOIN prize_sends ps ON ps.inventory_item_id = i.id
        WHERE i.status <> 'removed'`,
    );
    return rows.map((r) => ({
      id: r.id,
      nftMint: r.nft_mint,
      status: r.status,
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

  async writeSnapshot(s: Snapshot): Promise<void> {
    await this.db.query(
      `INSERT INTO vault_snapshots (hot_wallet, held_count, tracked_count, available_count, available_value_usd)
       VALUES ($1, $2, $3, $4, $5)`,
      [s.hotWallet, s.heldCount, s.trackedCount, s.availableCount, s.availableValueUsd],
    );
  }
}

/**
 * Holds a session-level advisory lock on its own connection so only one prize sender runs.
 * Returns a release function, or null if another process holds the lock.
 */
export async function acquireSingletonLock(db: pg.Pool, name: string): Promise<(() => Promise<void>) | null> {
  const client = await db.connect();
  const { rows } = await client.query<{ ok: boolean }>(`SELECT pg_try_advisory_lock(hashtext($1)) AS ok`, [name]);
  if (!rows[0]?.ok) {
    client.release();
    return null;
  }
  return async () => {
    try {
      await client.query(`SELECT pg_advisory_unlock(hashtext($1))`, [name]);
    } finally {
      client.release();
    }
  };
}
