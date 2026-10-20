import { NextResponse } from "next/server";
import { getPool } from "@lotus/server";
import { upstashKV } from "@lotus/anticheat";

export const dynamic = "force-dynamic";

const CHECK_TIMEOUT_MS = 3_000;
/** Inventory sync writes a vault snapshot every 2 min; no snapshot for this long means the worker is down. */
const WORKER_MAX_AGE_S = Number(process.env.HEALTH_WORKER_MAX_AGE_S ?? 900);
/** A prize queued longer than this means sends are stuck. */
const QUEUE_MAX_AGE_S = Number(process.env.HEALTH_QUEUE_MAX_AGE_S ?? 900);

type Check = { ok: boolean; ms?: number; [k: string]: unknown };

async function timed(fn: () => Promise<Check>): Promise<Check> {
  const t = Date.now();
  try {
    const r = await Promise.race([
      fn(),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), CHECK_TIMEOUT_MS)),
    ]);
    return { ...r, ms: Date.now() - t };
  } catch (err) {
    return { ok: false, ms: Date.now() - t, error: err instanceof Error && err.message === "timeout" ? "timeout" : "error" };
  }
}

/**
 * Uptime monitors poll this. 200 when the database, Redis and the worker are healthy, 503 otherwise.
 * Returns only booleans and ages, never connection details or error text.
 */
export async function GET() {
  if (process.env.LOTUS_USE_STUB !== "0") return NextResponse.json({ ok: true, mode: "stub" }, { headers: { "cache-control": "no-store" } });

  const [db, redis] = await Promise.all([
    timed(async () => {
      const { rows } = await getPool().query<{ snapshot_age_s: number | null; oldest_queued_s: number | null }>(
        `SELECT (SELECT extract(epoch FROM now() - max(taken_at)) FROM vault_snapshots)::float8 AS snapshot_age_s,
                (SELECT extract(epoch FROM now() - min(created_at)) FROM prize_sends WHERE status IN ('queued', 'processing'))::float8 AS oldest_queued_s`,
      );
      return { ok: true, ...rows[0] };
    }),
    timed(async () => {
      await upstashKV().get("lotus:health");
      return { ok: true };
    }),
  ]);

  const snapshotAge = typeof db.snapshot_age_s === "number" ? Math.round(db.snapshot_age_s) : null;
  const queuedAge = typeof db.oldest_queued_s === "number" ? Math.round(db.oldest_queued_s) : null;
  const checks = {
    db: { ok: db.ok, ms: db.ms },
    redis: { ok: redis.ok, ms: redis.ms },
    worker: { ok: db.ok && snapshotAge !== null && snapshotAge <= WORKER_MAX_AGE_S, lastSnapshotAgeS: snapshotAge },
    prizeQueue: { ok: db.ok && (queuedAge === null || queuedAge <= QUEUE_MAX_AGE_S), oldestQueuedAgeS: queuedAge },
  };
  const ok = Object.values(checks).every((c) => c.ok);
  return NextResponse.json({ ok, checks }, { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } });
}
