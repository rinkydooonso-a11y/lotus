import type pg from 'pg';
import type { DiscrepancyKind, OpenDiscrepancy, Snapshot, SyncStore, TrackedItem } from './inventorySync.js';
import type { PrizeTx, SignedTransfer, TxLog, TxState } from './types.js';
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

  async recordClaim(e: { signature: string; amount: string; asset: string; note: string }): Promise<void> {
    await this.db.query(
      `INSERT INTO treasury_events (kind, amount, asset, tx_signature, note) VALUES ('claim', $1, $2, $3, $4)`,
      [e.amount, e.asset, e.signature, e.note],
    );
  }
}
