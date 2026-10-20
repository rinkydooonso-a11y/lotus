import type { AntiCheatConfig } from "./config";
import type { KV } from "./store";
export type LimitReason = "wallet_cooldown" | "device_cooldown" | "wallet_daily_cap" | "device_daily_cap";

export interface Reservation {
  walletAddress: string;
  deviceId: string;
  day: string;
}

const DAY_TTL_S = 36 * 3600;

export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Cheap per-player request throttle, counted before any other check (rejected attempts count too). */
export async function hitRequestLimit(
  kv: KV,
  cfg: AntiCheatConfig,
  playerId: string,
  now: number,
): Promise<boolean> {
  const key = `${cfg.keyPrefix}rpm:${playerId}:${Math.floor(now / 60_000)}`;
  const n = await kv.incr(key);
  if (n === 1) await kv.expire(key, 120);
  return n > cfg.requestsPerMinute;
}

/**
 * Atomically-enough consume one open for wallet + device: cooldown via SET NX EX,
 * daily cap via INCR (rolled back on overflow). Call last, after all pure checks pass,
 * so rejected opens don't burn the player's quota.
 */
export async function consumeOpen(
  kv: KV,
  cfg: AntiCheatConfig,
  walletAddress: string,
  deviceId: string,
  now: number,
): Promise<{ ok: true; reservation: Reservation } | { ok: false; reason: LimitReason }> {
  const p = cfg.keyPrefix;
  const day = utcDay(now);
  const wCool = `${p}cd:w:${walletAddress}`;
  const dCool = `${p}cd:d:${deviceId}`;

  if (cfg.walletCooldownS > 0 && !(await kv.set(wCool, "1", { exSec: cfg.walletCooldownS, nx: true })))
    return { ok: false, reason: "wallet_cooldown" };
  if (cfg.deviceCooldownS > 0 && !(await kv.set(dCool, "1", { exSec: cfg.deviceCooldownS, nx: true }))) {
    await kv.del(wCool);
    return { ok: false, reason: "device_cooldown" };
  }

  const wCap = `${p}cap:w:${walletAddress}:${day}`;
  const dCap = `${p}cap:d:${deviceId}:${day}`;
  const w = await kv.incr(wCap);
  if (w === 1) await kv.expire(wCap, DAY_TTL_S);
  if (w > cfg.walletDailyCap) {
    await kv.decr(wCap);
    await kv.del(wCool);
    await kv.del(dCool);
    return { ok: false, reason: "wallet_daily_cap" };
  }
  const d = await kv.incr(dCap);
  if (d === 1) await kv.expire(dCap, DAY_TTL_S);
  if (d > cfg.deviceDailyCap) {
    await kv.decr(dCap);
    await kv.decr(wCap);
    await kv.del(wCool);
    await kv.del(dCool);
    return { ok: false, reason: "device_daily_cap" };
  }
  return { ok: true, reservation: { walletAddress, deviceId, day } };
}

/** Undo consumeOpen when the open fails after validation (e.g. DB transaction rolled back). */
export async function releaseOpen(kv: KV, cfg: AntiCheatConfig, r: Reservation): Promise<void> {
  const p = cfg.keyPrefix;
  await kv.decr(`${p}cap:w:${r.walletAddress}:${r.day}`);
  await kv.decr(`${p}cap:d:${r.deviceId}:${r.day}`);
  await kv.del(`${p}cd:w:${r.walletAddress}`);
  await kv.del(`${p}cd:d:${r.deviceId}`);
}
