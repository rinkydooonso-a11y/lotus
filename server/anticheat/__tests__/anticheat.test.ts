import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import type { OpenContext } from "../../src/types";
import { createAntiCheat, haversineM, loadConfig, MemoryKV } from "../index";
import type { Fix } from "../types";
import type { WalletInfo } from "../walletinfo";

const T0 = Date.UTC(2026, 9, 20, 12, 0, 0);
const WALLET = "So1anaWa11etAddressAAAAAAAAAAAAAAAAAAAAAAAA";
const FUNDER = "FunderAddressFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF";
const DEVICE = "device-fingerprint-1";
const CRATE = { lat: 53.3498, lng: -6.2603 }; // Dublin
const north = (m: number, p = CRATE) => ({ lat: p.lat + m / 111_195, lng: p.lng });
const wallet = (i: number) => WALLET.slice(0, -2) + String(i).padStart(2, "0");

function setup(overrides = {}, walletInfo: Record<string, WalletInfo> = {}) {
  let t = T0;
  const kv = new MemoryKV(() => t);
  const pings: Fix[] = [];
  const written: { playerId: string; reason: string }[] = [];
  const ac = createAntiCheat({
    kv,
    config: loadConfig({}, overrides),
    pings: () => ({ since: async (_p, since, limit) => pings.filter((x) => x.at > since).slice(-limit) }),
    flags: () => ({ write: async (playerId, reason) => void written.push({ playerId, reason }) }),
    walletInfo: { get: async (a) => walletInfo[a] ?? null },
  });
  const advance = (ms: number) => (t += ms);
  const ping = (pos: { lat: number; lng: number }, accuracyM = 5) => pings.push({ ...pos, accuracyM, at: t });
  const open = (pos: { lat: number; lng: number }, extra: Partial<OpenContext> = {}, accuracyM = 5) =>
    ac.validateOpen({
      db: {} as Pool,
      now: new Date(t),
      playerId: "p1",
      walletAddress: WALLET,
      deviceId: DEVICE,
      ip: "203.0.113.7",
      client: { ...pos, accuracyM, clientTs: t },
      crate: { id: "c1", ...CRATE, kind: "standard", spawnedAt: new Date(t), expiresAt: new Date(t + 1_800_000) },
      distanceM: haversineM(pos, CRATE),
      ...extra,
    });
  return { advance, ping, open, written };
}

const noCooldown = { walletCooldownS: 0, deviceCooldownS: 0 };

describe("basic gate", () => {
  it("allows a normal open", async () => {
    const s = setup();
    s.ping(north(30));
    expect(await s.open(north(10))).toEqual({ ok: true });
  });
  it("rejects distance over 40m, poor accuracy, skewed clock, junk input", async () => {
    const s = setup(noCooldown);
    s.ping(CRATE);
    expect(await s.open(north(45))).toMatchObject({ ok: false, reason: "too_far" });
    expect(await s.open(CRATE, {}, 500)).toMatchObject({ reason: "bad_accuracy" });
    expect(await s.open(CRATE, { client: { ...CRATE, accuracyM: 5, clientTs: T0 - 120_000 } })).toMatchObject({ reason: "clock_skew" });
    expect(await s.open(CRATE, { client: { lat: 999, lng: 0, accuracyM: 5, clientTs: T0 } })).toMatchObject({ reason: "invalid_input" });
  });
});

describe("movement plausibility", () => {
  it("requires a recent ping", async () => {
    const s = setup();
    expect(await s.open(CRATE)).toMatchObject({ ok: false, reason: "no_recent_ping" });
    s.ping(CRATE);
    s.advance(10 * 60_000);
    expect(await s.open(CRATE)).toMatchObject({ ok: false, reason: "no_recent_ping" });
  });

  it("accepts walking up to a crate", async () => {
    const s = setup();
    for (let i = 10; i >= 1; i--) {
      s.ping(north(i * 50));
      s.advance(30_000); // 50m / 30s = 1.7 m/s
    }
    expect(await s.open(north(10))).toEqual({ ok: true });
  });

  it("rejects a teleport in the pings, and stays rejected at the spoofed spot", async () => {
    const s = setup(noCooldown);
    s.ping({ lat: 40.7128, lng: -74.006 }); // New York
    s.advance(60_000);
    s.ping(north(20)); // suddenly Dublin
    s.advance(5_000);
    expect(await s.open(north(10))).toMatchObject({ ok: false, reason: "implausible_movement" });
    s.ping(north(15));
    s.advance(60_000);
    expect(await s.open(north(10))).toMatchObject({ ok: false, reason: "implausible_movement" });
  });

  it("rejects an open far from the last ping even if the crate is close", async () => {
    const s = setup();
    s.ping(north(3000));
    s.advance(10_000);
    expect(await s.open(CRATE)).toMatchObject({ ok: false, reason: "implausible_movement" });
  });

  it("ignores a single GPS glitch and normal jitter", async () => {
    const s = setup();
    s.ping(CRATE);
    s.advance(5_000);
    s.ping(north(2000)); // one bad fix
    s.advance(5_000);
    s.ping(north(8)); // jitter
    s.advance(5_000);
    expect(await s.open(north(5))).toEqual({ ok: true });
  });

  it("flags after repeated strikes and hands the flag to core", async () => {
    const s = setup({ ...noCooldown, movementStrikesToFlag: 3 });
    s.ping(CRATE);
    for (let i = 1; i <= 2; i++) {
      s.advance(2_000);
      s.ping(north(5000 * i));
    }
    s.advance(2_000);
    const r = await s.open(north(30_000), { distanceM: 10 }); // crate spoofed next to the fake fix
    expect(r).toMatchObject({ ok: false, reason: "implausible_movement", flag: { reason: "implausible_movement" } });
  });

  it("lets a traveller play again after the anchor resets", async () => {
    const s = setup({ anchorResetMs: 6 * 3600_000 });
    s.ping({ lat: 40.7128, lng: -74.006 });
    s.advance(7 * 3600_000); // a flight
    s.ping(north(20));
    s.advance(5_000);
    expect(await s.open(north(10))).toEqual({ ok: true });
  });
});

describe("cooldowns and caps", () => {
  it("enforces wallet cooldown, then allows after it expires", async () => {
    const s = setup({ walletCooldownS: 20, deviceCooldownS: 0 });
    s.ping(CRATE);
    expect((await s.open(CRATE)).ok).toBe(true);
    s.advance(5_000);
    expect(await s.open(CRATE)).toMatchObject({ reason: "wallet_cooldown" });
    s.advance(20_000);
    expect((await s.open(CRATE)).ok).toBe(true);
  });

  it("enforces device cooldown across wallets", async () => {
    const s = setup({ walletCooldownS: 0, deviceCooldownS: 20 });
    s.ping(CRATE);
    expect((await s.open(CRATE)).ok).toBe(true);
    expect(await s.open(CRATE, { walletAddress: wallet(2) })).toMatchObject({ reason: "device_cooldown" });
  });

  it("enforces the daily cap and resets the next UTC day", async () => {
    const s = setup({ ...noCooldown, walletDailyCap: 2 });
    s.ping(CRATE);
    await s.open(CRATE);
    await s.open(CRATE);
    expect(await s.open(CRATE)).toMatchObject({ reason: "wallet_daily_cap" });
    s.advance(24 * 3600_000);
    s.ping(CRATE);
    expect((await s.open(CRATE)).ok).toBe(true);
  });

  it("rejected opens don't burn quota", async () => {
    const s = setup({ walletDailyCap: 1 });
    s.ping(CRATE);
    await s.open(CRATE, {}, 500);
    expect((await s.open(CRATE)).ok).toBe(true);
  });
});

describe("sybil", () => {
  it("flags many wallets on one device, blocks when the funder cluster joins in", async () => {
    const info: Record<string, WalletInfo> = {};
    for (let i = 0; i < 12; i++) info[wallet(i)] = { firstTxAt: T0 - 3600_000, funder: FUNDER };
    const s = setup({ ...noCooldown, maxWalletsPerDevice: 2, maxWalletsPerFunder: 5, sybilFlagScore: 2, sybilBlockScore: 4 }, info);
    s.ping(CRATE);
    // wallets 0-1: only fresh_wallet (1) -> fine, no flag
    for (let i = 0; i < 2; i++) expect(await s.open(CRATE, { walletAddress: wallet(i) })).toEqual({ ok: true });
    expect(s.written).toHaveLength(0);
    // wallet 2: device(2) + fresh(1) = 3 -> allowed but flagged
    expect(await s.open(CRATE, { walletAddress: wallet(2) })).toEqual({ ok: true });
    expect(s.written).toEqual([{ playerId: "p1", reason: "sybil" }]);
    // wallet 5+: device(2) + funder(2) + fresh(1) = 5 -> blocked
    for (let i = 3; i < 5; i++) await s.open(CRATE, { walletAddress: wallet(i) });
    expect(await s.open(CRATE, { walletAddress: wallet(5) })).toMatchObject({ ok: false, reason: "sybil" });
  });
});
