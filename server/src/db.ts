import pg from 'pg';
import type { Pool, PoolClient } from 'pg';
import { pgSsl } from './pgSsl';

let pool: Pool | null = null;

/** Shared pool from DATABASE_URL, created on first use. */
export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is not set');
    // Fail fast under load: a request that can't get a connection errors in seconds instead of piling up.
    // On Vercel each instance gets a small pool (through the transaction pooler).
    pool = new pg.Pool({
      connectionString,
      ssl: pgSsl(connectionString),
      max: Number(process.env.PG_POOL_MAX ?? (process.env.VERCEL ? 3 : 10)),
      connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS ?? 5_000),
      idleTimeoutMillis: 10_000,
    });
    // The pooler drops idle connections; without a listener that error would crash the process.
    pool.on('error', (err) => console.error('pg pool idle client error', err.message));
  }
  return pool;
}

const TX_STATEMENT_TIMEOUT_MS = Math.max(1000, Math.floor(Number(process.env.PG_TX_TIMEOUT_MS) || 10_000));

/**
 * Runs fn inside BEGIN/COMMIT, rolling back on any throw. Statements inside are cancelled by the server
 * after PG_TX_TIMEOUT_MS (SET LOCAL works through the transaction pooler), so a stuck lock aborts the
 * whole transaction cleanly instead of holding row locks while requests pile up.
 */
export async function withTx<T>(db: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL statement_timeout = ${TX_STATEMENT_TIMEOUT_MS}`);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
