#!/usr/bin/env node
/**
 * Load test: simulated players sign in with throwaway wallets, walk toward the nearest crate at walking
 * speed, ping like the map does, and open crates when in range. Writes real rows, so it only runs
 * against localhost unless LOADTEST_ALLOW_REMOTE=1 is set for a preview that has its OWN database.
 * It refuses the production URL outright.
 *
 *   node run.mjs --url http://localhost:3000 --players 200 --minutes 5 [--ping-ms 15000] [--ramp-s 60]
 */
import nacl from "tweetnacl";
import bs58 from "bs58";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const URL_ = (args.url ?? "http://localhost:3000").replace(/\/$/, "");
const PLAYERS = Number(args.players ?? 50);
const MINUTES = Number(args.minutes ?? 3);
const PING_MS = Number(args["ping-ms"] ?? 15_000);
const RAMP_S = Number(args["ramp-s"] ?? 30);
const WALK_MPS = 1.4;
const OPEN_RANGE_M = 30;
const OPEN_COOLDOWN_MS = 21_000;

const PROD_HOSTS = ["lotus-liart-psi.vercel.app"];
const host = new URL(URL_).hostname;
if (PROD_HOSTS.includes(host)) throw new Error(`refusing to load test production (${host})`);
if (!["localhost", "127.0.0.1"].includes(host) && process.env.LOADTEST_ALLOW_REMOTE !== "1")
  throw new Error("remote target: set LOADTEST_ALLOW_REMOTE=1, and only for a preview with its own database");

// Launch-city centres (server/src/cities.ts); players start within 3 km of one.
const CITIES = [[51.5074, -0.1278], [48.8566, 2.3522], [52.52, 13.405], [40.7128, -74.006], [34.0522, -118.2437], [35.6762, 139.6503]];

const stats = new Map(); // endpoint -> { lat: number[], codes: Map }
const outcomes = new Map();
function record(name, ms, code) {
  let s = stats.get(name);
  if (!s) stats.set(name, (s = { lat: [], codes: new Map() }));
  s.lat.push(ms);
  s.codes.set(code, (s.codes.get(code) ?? 0) + 1);
}
const bump = (k) => outcomes.set(k, (outcomes.get(k) ?? 0) + 1);

async function call(name, path, { method = "GET", body, cookie, ip } = {}) {
  const t = performance.now();
  try {
    const res = await fetch(URL_ + path, {
      method,
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), "x-forwarded-for": ip },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    record(name, performance.now() - t, res.status);
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { res, json };
  } catch (err) {
    record(name, performance.now() - t, err.name === "TimeoutError" ? "timeout" : "neterr");
    return { res: null, json: null };
  }
}

const cookieOf = (res, name) => res?.headers.getSetCookie().find((c) => c.startsWith(name + "="))?.split(";")[0];
const distM = (a, b) => {
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function player(i, deadline) {
  const kp = nacl.sign.keyPair();
  const address = bs58.encode(kp.publicKey);
  const ip = `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`;
  const deviceId = `loadtest-device-${i}-${Math.random().toString(36).slice(2, 10)}`;

  const n = await call("auth/nonce", "/api/auth/nonce", { ip });
  if (!n.json) return;
  const sig = bs58.encode(nacl.sign.detached(new TextEncoder().encode(n.json.message), kp.secretKey));
  const v = await call("auth/verify", "/api/auth/verify", { method: "POST", ip, cookie: cookieOf(n.res, "lotus_nonce"), body: { address, signature: sig, nonce: n.json.nonce } });
  const cookie = cookieOf(v.res, "lotus_session");
  if (!cookie) return bump("signin_failed");

  const [cLat, cLng] = CITIES[i % CITIES.length];
  const pos = { lat: cLat + (Math.random() - 0.5) * 0.05, lng: cLng + (Math.random() - 0.5) * 0.05 };
  let target = null, lastOpen = 0, lastTick = Date.now();
  const fix = () => ({ lat: pos.lat, lng: pos.lng, accuracyM: 8, ts: Date.now(), deviceId });

  while (Date.now() < deadline) {
    const now = Date.now();
    if (target) {
      const d = distM(pos, target), step = Math.min(d, (WALK_MPS * (now - lastTick)) / 1000);
      if (d > 0) { pos.lat += ((target.lat - pos.lat) * step) / d; pos.lng += ((target.lng - pos.lng) * step) / d; }
    }
    lastTick = now;
    const r = await call("crates", "/api/crates", { method: "POST", ip, cookie, body: fix() });
    const crates = r.json?.crates ?? [];
    target = crates.slice().sort((a, b) => distM(pos, a) - distM(pos, b))[0] ?? null;
    if (target && distM(pos, target) <= OPEN_RANGE_M && now - lastOpen > OPEN_COOLDOWN_MS) {
      lastOpen = now;
      const o = await call("crates/open", "/api/crates/open", { method: "POST", ip, cookie, body: { crateId: target.id, ...fix() } });
      const res = o.json?.result;
      bump(res ? (res.kind === "rejected" ? `rejected:${res.code}:${res.message}` : res.kind) : "open_no_result");
    }
    await sleep(PING_MS * (0.9 + Math.random() * 0.2));
  }
}

const pct = (a, p) => (a.length ? a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))] : 0);
async function main() {
  const start = Date.now();
  const deadline = start + MINUTES * 60_000;
  console.log(`load test: ${PLAYERS} players, ${MINUTES} min, ping every ${PING_MS} ms, ramp ${RAMP_S}s -> ${URL_}`);
  const vus = [];
  for (let i = 0; i < PLAYERS; i++) {
    vus.push(sleep((RAMP_S * 1000 * i) / PLAYERS).then(() => player(i, deadline)));
  }
  const ticker = setInterval(() => {
    const c = stats.get("crates");
    console.log(`  t=${Math.round((Date.now() - start) / 1000)}s crates calls=${c?.lat.length ?? 0}`);
  }, 30_000);
  await Promise.all(vus);
  clearInterval(ticker);
  const secs = (Date.now() - start) / 1000;
  const report = {};
  for (const [name, s] of stats) {
    s.lat.sort((a, b) => a - b);
    const ok = [...s.codes].filter(([c]) => c === 200).reduce((n, [, v]) => n + v, 0);
    report[name] = {
      calls: s.lat.length, rps: +(s.lat.length / secs).toFixed(1), errorRate: +(1 - ok / s.lat.length).toFixed(4),
      p50: Math.round(pct(s.lat, 50)), p95: Math.round(pct(s.lat, 95)), p99: Math.round(pct(s.lat, 99)), max: Math.round(s.lat.at(-1)),
      codes: Object.fromEntries(s.codes),
    };
  }
  console.table(Object.fromEntries(Object.entries(report).map(([k, v]) => [k, { ...v, codes: JSON.stringify(v.codes) }])));
  console.log("open outcomes:", Object.fromEntries(outcomes));
  console.log(JSON.stringify({ players: PLAYERS, minutes: MINUTES, pingMs: PING_MS, report, outcomes: Object.fromEntries(outcomes) }));
}
main();
