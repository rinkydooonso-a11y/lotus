import { Redis } from "@upstash/redis";

/**
 * The few Redis commands anti-cheat uses. Values are plain strings.
 * Upstash in production; MemoryKV in tests and local dev.
 */
export interface KV {
  get(key: string): Promise<string | null>;
  /** Returns true if the value was written (false when nx and the key exists). */
  set(key: string, value: string, opts?: { exSec?: number; nx?: boolean }): Promise<boolean>;
  incr(key: string): Promise<number>;
  decr(key: string): Promise<number>;
  expire(key: string, sec: number): Promise<void>;
  del(key: string): Promise<void>;
  sadd(key: string, member: string): Promise<number>;
  scard(key: string): Promise<number>;
  sismember(key: string, member: string): Promise<boolean>;
  srem(key: string, member: string): Promise<void>;
  zadd(key: string, score: number, member: string): Promise<void>;
  zrem(key: string, member: string): Promise<void>;
  /** Members by score, highest first. */
  zrevrange(key: string, start: number, stop: number): Promise<string[]>;
}

/** Env: UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN. */
export function upstashKV(
  url = process.env.UPSTASH_REDIS_REST_URL,
  token = process.env.UPSTASH_REDIS_REST_TOKEN,
): KV {
  if (!url || !token) throw new Error("UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN not set");
  const r = new Redis({ url, token, automaticDeserialization: false });
  return {
    get: async (k) => {
      const v = await r.get<string>(k);
      return v == null ? null : String(v);
    },
    set: async (k, v, o = {}) => {
      const res =
        o.exSec && o.nx
          ? await r.set(k, v, { ex: o.exSec, nx: true })
          : o.exSec
            ? await r.set(k, v, { ex: o.exSec })
            : o.nx
              ? await r.set(k, v, { nx: true })
              : await r.set(k, v);
      return res === "OK";
    },
    incr: (k) => r.incr(k),
    decr: (k) => r.decr(k),
    expire: async (k, s) => {
      await r.expire(k, s);
    },
    del: async (k) => {
      await r.del(k);
    },
    sadd: (k, m) => r.sadd(k, m),
    scard: (k) => r.scard(k),
    sismember: async (k, m) => (await r.sismember(k, m)) === 1,
    srem: async (k, m) => {
      await r.srem(k, m);
    },
    zadd: async (k, score, member) => {
      await r.zadd(k, { score, member });
    },
    zrem: async (k, m) => {
      await r.zrem(k, m);
    },
    zrevrange: async (k, a, b) => (await r.zrange<string[]>(k, a, b, { rev: true })).map(String),
  };
}

/** In-memory KV with TTLs driven by an injectable clock. Single process only. */
export class MemoryKV implements KV {
  private data = new Map<string, { v: unknown; exp?: number }>();
  constructor(private now: () => number = Date.now) {}

  private live<T>(k: string): T | undefined {
    const e = this.data.get(k);
    if (!e) return undefined;
    if (e.exp !== undefined && e.exp <= this.now()) {
      this.data.delete(k);
      return undefined;
    }
    return e.v as T;
  }
  private put(k: string, v: unknown, keepTtl = true) {
    const exp = keepTtl ? this.data.get(k)?.exp : undefined;
    this.data.set(k, { v, exp });
  }

  async get(k: string) {
    const v = this.live<string>(k);
    return typeof v === "string" ? v : null;
  }
  async set(k: string, v: string, o: { exSec?: number; nx?: boolean } = {}) {
    if (o.nx && this.live(k) !== undefined) return false;
    this.data.set(k, { v, exp: o.exSec ? this.now() + o.exSec * 1000 : undefined });
    return true;
  }
  async incr(k: string) {
    const n = Number(this.live<string>(k) ?? 0) + 1;
    this.put(k, String(n));
    return n;
  }
  async decr(k: string) {
    const n = Number(this.live<string>(k) ?? 0) - 1;
    this.put(k, String(n));
    return n;
  }
  async expire(k: string, s: number) {
    const e = this.data.get(k);
    if (e && this.live(k) !== undefined) e.exp = this.now() + s * 1000;
  }
  async del(k: string) {
    this.data.delete(k);
  }
  private setOf(k: string) {
    let s = this.live<Set<string>>(k);
    if (!s) {
      s = new Set();
      this.put(k, s, false);
    }
    return s;
  }
  async sadd(k: string, m: string) {
    const s = this.setOf(k);
    const had = s.has(m);
    s.add(m);
    return had ? 0 : 1;
  }
  async scard(k: string) {
    return this.live<Set<string>>(k)?.size ?? 0;
  }
  async sismember(k: string, m: string) {
    return this.live<Set<string>>(k)?.has(m) ?? false;
  }
  async srem(k: string, m: string) {
    this.live<Set<string>>(k)?.delete(m);
  }
  private zsetOf(k: string) {
    let z = this.live<Map<string, number>>(k);
    if (!z) {
      z = new Map();
      this.put(k, z, false);
    }
    return z;
  }
  async zadd(k: string, score: number, m: string) {
    this.zsetOf(k).set(m, score);
  }
  async zrem(k: string, m: string) {
    this.live<Map<string, number>>(k)?.delete(m);
  }
  async zrevrange(k: string, a: number, b: number) {
    const z = this.live<Map<string, number>>(k);
    if (!z) return [];
    const sorted = [...z.entries()].sort((x, y) => y[1] - x[1]).map(([m]) => m);
    return sorted.slice(a, b < 0 ? sorted.length + b + 1 : b + 1);
  }
}
