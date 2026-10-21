import type { Pool } from "pg";
import type { OpenContext, ValidateOpen, ValidateResult } from "../src/types";
import { loadConfig, type AntiCheatConfig } from "./config";
import { claimFlagSlot, pgFlags, type FlagSink } from "./flags";
import { consumeOpen, hitRequestLimit, releaseOpen as release } from "./limits";
import { checkMovement, walkPings } from "./movement";
import { pgPings, type PingSource } from "./pings";
import { upstashKV, type KV } from "./store";
import { scoreSybil } from "./sybil";
import { OpenContextDataSchema, type Anchor, type Fix } from "./types";
import { rpcWalletInfo, type WalletInfoSource } from "./walletinfo";

export { loadConfig, type AntiCheatConfig } from "./config";
export { MemoryKV, upstashKV, type KV } from "./store";
export { haversineM } from "./geo";

const ANCHOR_TTL_S = 7 * 24 * 3600;
const STRIKE_TTL_S = 24 * 3600;

export interface AntiCheatDeps {
  kv: KV;
  config?: AntiCheatConfig;
  /** Defaults read ctx.db (location_pings / player_flags). Tests inject fakes. */
  pings?: (db: Pool) => PingSource;
  flags?: (db: Pool) => FlagSink;
  walletInfo?: WalletInfoSource;
}

export function createAntiCheat({ kv, config = loadConfig(), pings = pgPings, flags = pgFlags, walletInfo }: AntiCheatDeps) {
  const cfg = config;
  const wallets = walletInfo ?? rpcWalletInfo(kv, cfg.keyPrefix, cfg.walletLookupTimeoutMs);
  const anchorKey = (playerId: string) => `${cfg.keyPrefix}anchor:${playerId}`;

  /** Records an admin-queue flag (deduped). Returns the flag for core to write on rejections. */
  async function flagOnce(sink: FlagSink, playerId: string, reason: string, details: Record<string, unknown>, now: number, write: boolean) {
    if (!(await claimFlagSlot(kv, cfg, playerId, reason, now))) return undefined;
    if (write) await sink.write(playerId, reason, details);
    return { reason, details };
  }

  /**
   * Movement plausibility: walk the pings since the last check from the trusted position,
   * then check the open fix itself. Returns a reject detail, or null when plausible.
   */
  async function checkPath(ctx: OpenContext, now: number, sink: FlagSink) {
    const raw = await kv.get(anchorKey(ctx.playerId));
    const anchor = raw ? (JSON.parse(raw) as Anchor) : null;
    const since = Math.max(anchor?.scannedThrough ?? 0, now - cfg.anchorResetMs);
    const newPings = await pings(ctx.db).since(ctx.playerId, since, cfg.maxPingsPerScan);

    const lastPingAt = newPings.at(-1)?.at ?? anchor?.scannedThrough ?? 0;
    if (cfg.maxLastPingAgeMs > 0 && now - lastPingAt > cfg.maxLastPingAgeMs) return { detail: "no_recent_ping" };

    const start = anchor && now - anchor.trusted.at < cfg.anchorResetMs ? anchor.trusted : null;
    const walk = newPings.length ? walkPings(start, newPings, cfg) : { trusted: start, rejected: [] };

    const openFix: Fix = { lat: ctx.client.lat, lng: ctx.client.lng, accuracyM: ctx.client.accuracyM, at: now };
    const v = walk.trusted ? checkMovement(walk.trusted, openFix, cfg) : { ok: true as const, detail: undefined };
    const trusted = v.ok ? openFix : walk.trusted;
    if (trusted) {
      const next: Anchor = { trusted, scannedThrough: Math.max(lastPingAt, anchor?.scannedThrough ?? 0) };
      await kv.set(anchorKey(ctx.playerId), JSON.stringify(next), { exSec: ANCHOR_TTL_S });
    }

    const strikes = walk.rejected.length + (v.ok ? 0 : 1);
    if (strikes > 0) {
      const key = `${cfg.keyPrefix}strikes:${ctx.playerId}`;
      let n = 0;
      for (let i = 0; i < strikes; i++) n = await kv.incr(key);
      await kv.expire(key, STRIKE_TTL_S);
      if (n >= cfg.movementStrikesToFlag) {
        const details = { strikes24h: n, last: v.ok ? walk.rejected.at(-1)?.detail : v.detail };
        // On a rejection core writes the flag; otherwise write it ourselves.
        const flag = await flagOnce(sink, ctx.playerId, "implausible_movement", details, now, v.ok);
        if (!v.ok) return { detail: v.detail ?? "implausible_movement", flag };
      }
    }
    return v.ok ? null : { detail: v.detail ?? "implausible_movement" };
  }

  /**
   * Called by core's openCrate after its own crate/distance checks, outside the open transaction.
   * Order: cheap checks, movement, sybil, then cooldowns/caps last so rejected opens don't burn quota.
   */
  const validateOpen: ValidateOpen = async (ctx): Promise<ValidateResult> => {
    const parsed = OpenContextDataSchema.safeParse(ctx);
    if (!parsed.success) return { ok: false, reason: "invalid_input" };
    const now = ctx.now.getTime();
    const sink = flags(ctx.db);

    if (await hitRequestLimit(kv, cfg, ctx.playerId, now)) return { ok: false, reason: "rate_limited" };
    if (ctx.client.accuracyM > cfg.maxAccuracyM) return { ok: false, reason: "bad_accuracy" };
    if (Math.abs(ctx.client.clientTs - now) > cfg.maxClockSkewMs) return { ok: false, reason: "clock_skew" };
    // Core already rejects > 40m; this keeps the gate honest if that check or the config ever drifts.
    if (ctx.distanceM > cfg.maxOpenDistanceM) return { ok: false, reason: "too_far" };

    const path = await checkPath(ctx, now, sink);
    if (path) {
      const reason = path.detail === "no_recent_ping" ? "no_recent_ping" : "implausible_movement";
      return { ok: false, reason, ...("flag" in path && path.flag ? { flag: path.flag } : {}) };
    }

    const info = await wallets.get(ctx.walletAddress);
    const syb = await scoreSybil(kv, cfg, { ...ctx, walletFirstTxAt: info?.firstTxAt, walletFunder: info?.funder }, now);
    if (syb.score >= cfg.sybilBlockScore) {
      const flag = await flagOnce(sink, ctx.playerId, "sybil", { score: syb.score, signals: syb.signals }, now, false);
      return { ok: false, reason: "sybil", ...(flag ? { flag } : {}) };
    }
    if (syb.score >= cfg.sybilFlagScore)
      await flagOnce(sink, ctx.playerId, "sybil", { score: syb.score, signals: syb.signals }, now, true);

    const c = await consumeOpen(kv, cfg, ctx.walletAddress, ctx.deviceId, now);
    // World crates are shared, so an open that passed every check can still not happen (another
    // player claimed the crate first). Hand core a way to give this quota back when that happens.
    return c.ok ? { ok: true, release: () => release(kv, cfg, c.reservation) } : { ok: false, reason: c.reason };
  };

  return {
    config: cfg,
    validateOpen,
    /** Give back a consumed cooldown/cap slot (wallet, device, UTC day yyyy-mm-dd). Optional; core doesn't call it yet. */
    releaseOpen: (walletAddress: string, deviceId: string, day: string) => release(kv, cfg, { walletAddress, deviceId, day }),
  };
}

export type AntiCheat = ReturnType<typeof createAntiCheat>;

let instance: AntiCheat | undefined;
/** Process-wide instance: Upstash (UPSTASH_REDIS_REST_URL/TOKEN), LOTUS_AC_* config, HELIUS_RPC_URL if set. */
export function antiCheat(): AntiCheat {
  return (instance ??= createAntiCheat({ kv: upstashKV() }));
}

export const validateOpen: ValidateOpen = (ctx) => antiCheat().validateOpen(ctx);
