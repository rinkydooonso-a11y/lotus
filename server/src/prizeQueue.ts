import type { Pool, PoolClient } from 'pg';
import { getPool, withTx } from './db';
import type { PrizeSendJob } from './types';

const JOB_COLS = `id, opening_id, inventory_item_id, nft_mint, recipient_address, attempts, status, tx_signature`;

function toJob(r: any): PrizeSendJob {
  return {
    id: r.id,
    openingId: r.opening_id,
    inventoryItemId: r.inventory_item_id,
    nftMint: r.nft_mint,
    recipientAddress: r.recipient_address,
    attempts: r.attempts,
    status: r.status,
    txSignature: r.tx_signature,
  };
}

/** Outbox insert. Must run inside the opening's transaction. */
export async function enqueuePrizeSend(
  c: PoolClient,
  job: { openingId: string; inventoryItemId: string; playerId: string; nftMint: string; recipientAddress: string },
): Promise<{ id: string }> {
  const r = await c.query<{ id: string }>(
    `INSERT INTO prize_sends (opening_id, inventory_item_id, player_id, nft_mint, recipient_address)
     VALUES ($1, $2, $3, $4, $5) ON CONFLICT (opening_id) DO NOTHING RETURNING id`,
    [job.openingId, job.inventoryItemId, job.playerId, job.nftMint, job.recipientAddress],
  );
  if (r.rows[0]) return r.rows[0];
  const existing = await c.query<{ id: string }>('SELECT id FROM prize_sends WHERE opening_id = $1', [job.openingId]);
  return existing.rows[0]!;
}

/**
 * Claims the oldest sendable job: queued, or processing/submitted with an expired lock (crashed worker).
 * Frozen players' jobs are skipped. If the returned job has txSignature, check it on chain before re-sending.
 */
export async function claimNextPrizeSend(
  opts: { lockMs?: number; maxAttempts?: number } = {},
  db: Pool = getPool(),
): Promise<PrizeSendJob | null> {
  const lockMs = opts.lockMs ?? 120_000;
  const maxAttempts = opts.maxAttempts ?? 10;
  const r = await db.query(
    `UPDATE prize_sends
        SET status = 'processing', attempts = attempts + 1, updated_at = now(),
            locked_until = now() + make_interval(secs => $1::double precision / 1000)
      WHERE id = (
        SELECT ps.id FROM prize_sends ps JOIN players p ON p.id = ps.player_id
         WHERE p.status = 'active' AND ps.attempts < $2
           AND (ps.status = 'queued'
                OR (ps.status IN ('processing', 'submitted') AND coalesce(ps.locked_until, '-infinity') < now()))
         ORDER BY ps.created_at
         LIMIT 1
         FOR UPDATE OF ps SKIP LOCKED)
      RETURNING ${JOB_COLS}`,
    [lockMs, maxAttempts],
  );
  return r.rows[0] ? toJob(r.rows[0]) : null;
}

/** Call after signing, before broadcasting, so a crash can't lead to a blind re-send. */
export async function recordSubmittedSignature(jobId: string, signature: string, db: Pool = getPool()): Promise<void> {
  const r = await db.query(
    `UPDATE prize_sends SET tx_signature = $2, status = 'submitted', updated_at = now()
      WHERE id = $1 AND status IN ('processing', 'submitted')`,
    [jobId, signature],
  );
  if (r.rowCount !== 1) throw new Error(`prize send ${jobId} is not in a submittable state`);
}

/** Records a confirmed transfer. Idempotent; applies whatever the job's status, since the chain is the truth. */
export async function markPrizeSent(jobId: string, signature: string, db: Pool = getPool()): Promise<void> {
  await withTx(db, async (c) => {
    const r = await c.query<{ opening_id: string; inventory_item_id: string }>(
      `UPDATE prize_sends
          SET status = 'sent', tx_signature = $2, locked_until = NULL, last_error = NULL,
              sent_at = coalesce(sent_at, now()), updated_at = now()
        WHERE id = $1 RETURNING opening_id, inventory_item_id`,
      [jobId, signature],
    );
    const row = r.rows[0];
    if (!row) throw new Error(`prize send ${jobId} not found`);
    await c.query(`UPDATE crate_openings SET status = 'sent', tx_signature = $2 WHERE id = $1`, [row.opening_id, signature]);
    await c.query(
      `UPDATE inventory_items SET status = 'sent', sent_at = coalesce(sent_at, now()) WHERE id = $1`,
      [row.inventory_item_id],
    );
  });
}

/**
 * Transient failure: back to 'queued' (or 'submitted' if a signature exists, so the next claim checks the chain).
 * Permanent, or attempts used up: 'failed'. The card stays reserved for the player either way.
 */
export async function markPrizeFailed(
  jobId: string,
  error: string,
  opts: { permanent?: boolean; maxAttempts?: number } = {},
  db: Pool = getPool(),
): Promise<void> {
  await withTx(db, async (c) => {
    const r = await c.query<{ status: string; opening_id: string }>(
      `UPDATE prize_sends
          SET last_error = left($2, 2000), locked_until = NULL, updated_at = now(),
              status = (CASE WHEN $3 OR attempts >= $4 THEN 'failed'
                             WHEN tx_signature IS NOT NULL THEN 'submitted'
                             ELSE 'queued' END)::prize_send_status
        WHERE id = $1 AND status IN ('processing', 'submitted')
        RETURNING status, opening_id`,
      [jobId, error, opts.permanent ?? false, opts.maxAttempts ?? 10],
    );
    const row = r.rows[0];
    if (row?.status === 'failed') {
      await c.query(`UPDATE crate_openings SET status = 'failed' WHERE id = $1`, [row.opening_id]);
    }
  });
}

/** Admin: retry a failed or stuck job. Keeps any signature so the worker checks the chain first. */
export async function requeuePrizeSend(jobId: string, db: Pool = getPool()): Promise<void> {
  await withTx(db, async (c) => {
    const r = await c.query<{ opening_id: string }>(
      `UPDATE prize_sends SET status = 'queued', attempts = 0, locked_until = NULL, updated_at = now()
        WHERE id = $1 AND status IN ('failed', 'processing', 'submitted') RETURNING opening_id`,
      [jobId],
    );
    if (r.rows[0]) {
      await c.query(`UPDATE crate_openings SET status = 'pending' WHERE id = $1`, [r.rows[0].opening_id]);
    }
  });
}
