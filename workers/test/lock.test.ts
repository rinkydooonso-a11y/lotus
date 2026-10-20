import pg from 'pg';
import { afterEach, describe, expect, it } from 'vitest';
import { acquireSingletonLock, type LockConnection } from '../src/pg.js';

const quiet = { info() {}, warn() {}, error() {} };
const NAME = `lotus:test-lock:${process.pid}`;

/** Fake connection: grants the lock once `freeAfter` attempts have failed. */
function fakeConn(state: { attempts: number; freeAfter: number; fail?: boolean }): LockConnection {
  const handlers: Record<string, ((e?: any) => void)[]> = {};
  return {
    async query(sql: string) {
      if (sql.includes('pg_try_advisory_lock')) {
        if (state.fail) throw new Error('boom');
        state.attempts++;
        return { rows: [{ ok: state.attempts > state.freeAfter }] as any };
      }
      return { rows: [{ n: 1 }] as any };
    },
    on(event: string, fn: (e?: any) => void) {
      (handlers[event] ??= []).push(fn);
      return this;
    },
    async end() {},
  } as LockConnection;
}

describe('acquireSingletonLock (fakes)', () => {
  it('retries with backoff until the old holder lets go', async () => {
    const state = { attempts: 0, freeAfter: 3 };
    const waits: number[] = [];
    const release = await acquireSingletonLock(async () => fakeConn(state), NAME, {
      log: quiet, onLost: () => {}, sleep: async (ms) => { waits.push(ms); }, heartbeatMs: 60_000,
    });
    expect(release).toBeTypeOf('function');
    expect(state.attempts).toBe(4);
    expect(waits).toEqual([1000, 2000, 4000]);
    await release!();
  });

  it('gives up (throws) when the lock stays held past maxWaitMs', async () => {
    let t = 0;
    const state = { attempts: 0, freeAfter: Infinity };
    await expect(acquireSingletonLock(async () => fakeConn(state), NAME, {
      log: quiet, onLost: () => {}, maxWaitMs: 30_000, now: () => t, sleep: async (ms) => { t += ms; },
    })).rejects.toThrow(/another prize sender may be running/);
  });

  it('reconnects when the connection fails while waiting', async () => {
    const state = { attempts: 0, freeAfter: 0, fail: true };
    let connects = 0;
    const release = await acquireSingletonLock(async () => { if (++connects > 1) state.fail = false; return fakeConn(state); }, NAME, {
      log: quiet, onLost: () => {}, sleep: async () => {}, heartbeatMs: 60_000,
    });
    expect(connects).toBe(2);
    await release!();
  });

  it('releases the lock and throws when verify fails', async () => {
    const state = { attempts: 0, freeAfter: 0 };
    const seen: string[] = [];
    const conn = fakeConn(state);
    const query = conn.query.bind(conn);
    conn.query = (async (sql: string, params?: unknown[]) => { seen.push(sql); return query(sql, params); }) as LockConnection['query'];
    await expect(acquireSingletonLock(async () => conn, NAME, {
      log: quiet, onLost: () => {}, sleep: async () => {}, verify: async () => { throw new Error('wrong database'); },
    })).rejects.toThrow('wrong database');
    expect(seen).toContain('SELECT pg_advisory_unlock_all()');
  });

  it('returns null when aborted while waiting', async () => {
    const ac = new AbortController();
    const state = { attempts: 0, freeAfter: Infinity };
    const release = await acquireSingletonLock(async () => fakeConn(state), NAME, {
      log: quiet, onLost: () => {}, signal: ac.signal, sleep: async () => { ac.abort(); },
    });
    expect(release).toBeNull();
  });
});

// Real Postgres: two sessions racing for the same advisory lock. Runs only when DATABASE_URL is set (local db).
describe.skipIf(!process.env.DATABASE_URL)('acquireSingletonLock (postgres)', () => {
  const clients: pg.Client[] = [];
  const connect = async () => {
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    clients.push(c);
    return c;
  };
  afterEach(async () => {
    await Promise.all(clients.splice(0).map((c) => c.end().catch(() => {})));
  });

  it('never grants a second holder; the waiter gets it after the first releases', async () => {
    const first = await acquireSingletonLock(connect, NAME, { log: quiet, onLost: () => {}, heartbeatMs: 60_000 });
    expect(first).toBeTypeOf('function');
    let secondGot = false;
    const second = acquireSingletonLock(connect, NAME, {
      log: quiet, onLost: () => {}, heartbeatMs: 60_000, sleep: (ms) => new Promise((r) => setTimeout(r, ms / 10)),
    }).then((r) => { secondGot = true; return r; });
    await new Promise((r) => setTimeout(r, 500));
    expect(secondGot).toBe(false);
    await first!();
    const rel = await second;
    expect(rel).toBeTypeOf('function');
    await rel!();
  });

  it('verify sees the lock from a second connection to the same database', async () => {
    const other = await connect();
    const release = await acquireSingletonLock(connect, NAME, {
      log: quiet, onLost: () => {}, heartbeatMs: 60_000,
      verify: async (conn) => {
        const { rows } = await conn.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
        const r = await other.query<{ seen: boolean }>(
          `SELECT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND granted AND pid = $1
                    AND database = (SELECT oid FROM pg_database WHERE datname = current_database())) AS seen`,
          [rows[0]!.pid],
        );
        if (!r.rows[0]!.seen) throw new Error('not seen');
      },
    });
    expect(release).toBeTypeOf('function');
    await release!();
  });

  it('reports the lock as lost when its connection is killed', async () => {
    const lost: string[] = [];
    const release = await acquireSingletonLock(connect, NAME, { log: quiet, onLost: (r) => lost.push(r), heartbeatMs: 200 });
    const holder = clients[0]!;
    const { rows } = await holder.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
    const admin = await connect();
    await admin.query('SELECT pg_terminate_backend($1)', [rows[0]!.pid]);
    await new Promise((r) => setTimeout(r, 800));
    expect(lost.length).toBe(1);
    await release!(); // no-op after loss
  });
});
