import pg from 'pg';
import type { Pool, PoolClient } from 'pg';

let pool: Pool | null = null;

/** Shared pool from DATABASE_URL, created on first use. */
export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is not set');
    pool = new pg.Pool({ connectionString, max: Number(process.env.PG_POOL_MAX ?? 10) });
  }
  return pool;
}

/** Runs fn inside BEGIN/COMMIT, rolling back on any throw. */
export async function withTx<T>(db: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
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
