import { randomInt, randomUUID } from "crypto";
import { haversineM, OPEN_RADIUS_M } from "../geo";
import { SERVICE_CITIES } from "../cities";
import type { AdminInventoryItem, Crate, FeedPull, FlaggedPlayer, HistoryEntry, OddsRow, Tier } from "../types";
import type { GameServer } from "./types";

// In-memory stand-in so the UI is fully usable before the real game server exists.
// Single process only; state resets on restart.
interface PlayerState { shards: number; tickets: number; history: HistoryEntry[]; opensToday: number; frozen: boolean; wallet: string }
const g = globalThis as unknown as { __lotusStub?: { players: Map<string, PlayerState>; byWallet: Map<string, string>; crates: Map<string, Crate & { playerId: string }>; odds: OddsRow[]; inventory: AdminInventoryItem[] } };
const db = (g.__lotusStub ??= <NonNullable<typeof g.__lotusStub>>{
  players: new Map(), byWallet: new Map(), crates: new Map(),
  odds: <OddsRow[]>[{ tier: "shards", weight: 850000 }, { tier: "common", weight: 90000 }, { tier: "uncommon", weight: 40000 }, { tier: "rare", weight: 18000 }, { tier: "grail", weight: 2000 }],
  inventory: [
    { id: "i1", nftMint: "DevMint1111111111111111111111111111111111", cardName: "Charizard Base Set Holo", grade: "PSA 7", valueUsd: 420, tier: "grail", status: "available" },
    { id: "i2", nftMint: "DevMint2222222222222222222222222222222222", cardName: "Pikachu Illustrator Promo", grade: "PSA 8", valueUsd: 120, tier: "rare", status: "available" },
    { id: "i3", nftMint: "DevMint3333333333333333333333333333333333", cardName: "Gengar Fossil Holo", grade: "BGS 8.5", valueUsd: 52, tier: "uncommon", status: "available" },
    { id: "i4", nftMint: "DevMint4444444444444444444444444444444444", cardName: "Squirtle Base Set", grade: "PSA 9", valueUsd: 18, tier: "common", status: "available" },
    { id: "i5", nftMint: "DevMint5555555555555555555555555555555555", cardName: "Eevee Jungle", grade: "CGC 9", valueUsd: 14, tier: "common", status: "available" },
  ],
});
const DAILY_CAP = 30;
const TIERS: Tier[] = ["common", "uncommon", "rare", "grail"];

function player(id: string): PlayerState {
  const p = db.players.get(id);
  if (!p) throw new Error("unknown player");
  return p;
}
function spawnAround(playerId: string, lat: number, lng: number): void {
  const mine = [...db.crates.values()].filter((c) => c.playerId === playerId && new Date(c.expiresAt) > new Date());
  const want = 6 - mine.length;
  for (let i = 0; i < want; i++) {
    // first crate sits at the player's feet (GoCollect pattern); others 30-400m away
    const dist = mine.length === 0 && i === 0 ? 8 : 30 + randomInt(370);
    const bearing = (randomInt(3600) / 10) * (Math.PI / 180);
    const dLat = (dist * Math.cos(bearing)) / 111320;
    const dLng = (dist * Math.sin(bearing)) / (111320 * Math.cos((lat * Math.PI) / 180));
    const id = randomUUID();
    db.crates.set(id, { id, playerId, lat: lat + dLat, lng: lng + dLng, expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(), kind: "standard" });
  }
}
// Demo pulls so the feed isn't empty in stub mode; real pulls from this process are added on top.
const BOOT = Date.now();
const DEMO_PULLS: FeedPull[] = ([
  ["Umbreon VMAX Alt Art Evolving Skies", "PSA 10", 640, "grail", 7, "ticket", "9xQe…Lk2P"],
  ["Charizard Base Set Holo", "PSA 7", 420, "grail", 52, "standard", "4w1x…Nm7z"],
  ["Mewtwo SV Black Star Promo", "PSA 9", 82, "rare", 18, "standard", "Dq8r…a1Fs"],
  ["Gengar Fossil Holo", "BGS 8.5", 52, "uncommon", 33, "standard", "7Hbn…pQ4e"],
  ["Lugia Neo Genesis", "CGC 8", 210, "rare", 140, "ticket", "Bv2k…r9Xa"],
  ["Squirtle Base Set", "PSA 9", 18, "common", 4, "standard", "Kp3m…Wc8d"],
  ["Pikachu Van Gogh Promo", "PSA 9", 96, "rare", 260, "standard", "4w1x…Nm7z"],
  ["Eevee Jungle", "CGC 9", 14, "common", 75, "standard", "Ht6y…Zz0q"],
  ["Monkey D. Luffy OP01 Leader", "PSA 10", 44, "uncommon", 410, "standard", "Dq8r…a1Fs"],
] as const).map(([cardName, grade, valueUsd, tier, minsAgo, crateKind, collector], i) => ({
  id: `demo${i}`, at: new Date(BOOT - minsAgo * 60_000).toISOString(), cardName, grade, valueUsd, tier, crateKind, collector,
}));

function roll(): "shards" | Tier {
  const total = db.odds.reduce((s, r) => s + r.weight, 0);
  let n = (randomInt(1_000_000) / 1_000_000) * total;
  for (const r of db.odds) { if ((n -= r.weight) < 0) return r.tier; }
  return "shards";
}

export const stubServer: GameServer = {
  async playerForWallet(address) {
    let id = db.byWallet.get(address);
    if (!id) {
      id = randomUUID();
      db.byWallet.set(address, id);
      db.players.set(id, { shards: 0, tickets: 0, history: [], opensToday: 0, frozen: false, wallet: address });
    }
    return id;
  },
  async nearbyCrates(playerId, ping) {
    player(playerId);
    // Same launch-city gate as the real server.
    const inCity = SERVICE_CITIES.some((c) => haversineM(c, ping) <= c.radiusKm * 1000);
    if (ping.anywhere || process.env.LOTUS_CITY_GATE === "off" || inCity) spawnAround(playerId, ping.lat, ping.lng);
    return [...db.crates.values()]
      .filter((c) => c.playerId === playerId && new Date(c.expiresAt) > new Date() && haversineM(c, ping) < 1500)
      .map(({ playerId: _p, ...c }) => c);
  },
  async openCrate(playerId, crateId, ping) {
    const p = player(playerId);
    const c = db.crates.get(crateId);
    if (p.frozen) return { kind: "rejected", code: "frozen", message: "Account frozen" };
    if (!c || c.playerId !== playerId) return { kind: "rejected", code: "not_found", message: "Crate not found" };
    if (new Date(c.expiresAt) < new Date()) return { kind: "rejected", code: "expired", message: "Crate expired" };
    if (haversineM(c, ping) > OPEN_RADIUS_M) return { kind: "rejected", code: "too_far", message: "Get closer to the crate" };
    if (p.opensToday >= DAILY_CAP) return { kind: "rejected", code: "anticheat", message: "Daily limit reached" };
    db.crates.delete(crateId);
    p.opensToday++;
    let r = roll();
    let result: HistoryEntry["result"];
    const item = r !== "shards" ? db.inventory.find((i) => i.tier === r && i.status === "available") : undefined;
    if (item) {
      item.status = "reserved";
      result = { kind: "card", tier: item.tier, cardName: item.cardName, grade: item.grade, valueUsd: item.valueUsd, nftMint: item.nftMint, status: "pending" };
    } else {
      const shards = 1 + randomInt(4);
      p.shards += shards;
      const gained = Math.floor(p.shards / 10);
      p.shards -= gained * 10;
      p.tickets += gained;
      result = { kind: "shards", shards, ticketsGained: gained, shardsTotal: p.shards, ticketsTotal: p.tickets };
    }
    p.history.unshift({ id: randomUUID(), at: new Date().toISOString(), result });
    return result;
  },
  async useTicket(playerId, ping) {
    const p = player(playerId);
    if (p.frozen) return { ok: false, code: "frozen" };
    if (p.tickets < 1) return { ok: false, code: "no_tickets" };
    p.tickets--;
    const id = randomUUID();
    const crate = { id, lat: ping.lat, lng: ping.lng, kind: "ticket" as const, expiresAt: new Date(Date.now() + 30 * 60_000).toISOString() };
    db.crates.set(id, { ...crate, playerId });
    return { ok: true, crate, tickets: p.tickets };
  },
  async balances(playerId) {
    const p = player(playerId);
    return { shards: p.shards, tickets: p.tickets };
  },
  async history(playerId) { return player(playerId).history.slice(0, 100); },
  async vaultStats() {
    const avail = db.inventory.filter((i) => i.status === "available");
    const total = db.odds.reduce((s, r) => s + r.weight, 0);
    const byTier = Object.fromEntries(TIERS.map((t) => [t, { count: avail.filter((i) => i.tier === t).length, odds: (db.odds.find((r) => r.tier === t)?.weight ?? 0) / total }])) as Record<Tier, { count: number; odds: number }>;
    return { cardsInVault: avail.length, cardsSent: db.inventory.filter((i) => i.status === "sent").length, totalValueUsd: avail.reduce((s, i) => s + i.valueUsd, 0), byTier, recentTreasury: [{ at: new Date().toISOString(), kind: "stub", note: "Stub data (devnet)" }] };
  },
  async feed() {
    const live: FeedPull[] = [];
    for (const p of db.players.values())
      for (const h of p.history)
        if (h.result.kind === "card") live.push({ id: h.id, at: h.at, cardName: h.result.cardName, grade: h.result.grade, valueUsd: h.result.valueUsd, tier: h.result.tier, imageUrl: h.result.imageUrl, collector: `${p.wallet.slice(0, 4)}…${p.wallet.slice(-4)}`, crateKind: "standard" });
    const all = [...live, ...DEMO_PULLS];
    const byCollector = new Map<string, { cards: number; totalUsd: number }>();
    for (const x of all) { const c = byCollector.get(x.collector) ?? { cards: 0, totalUsd: 0 }; c.cards++; c.totalUsd += x.valueUsd; byCollector.set(x.collector, c); }
    return {
      recent: [...all].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 20),
      biggest: [...all].sort((a, b) => b.valueUsd - a.valueUsd).slice(0, 20),
      collectors: [...byCollector].map(([collector, c]) => ({ collector, ...c })).sort((a, b) => b.totalUsd - a.totalUsd).slice(0, 20),
    };
  },
  admin: {
    async inventory() { return db.inventory; },
    async addItem(item) {
      const valueUsd = item.valueUsd;
      const tier: Tier = valueUsd >= 300 ? "grail" : valueUsd >= 75 ? "rare" : valueUsd >= 30 ? "uncommon" : "common";
      const id = randomUUID();
      db.inventory.push({ id, nftMint: item.nftMint, cardName: item.cardName, grade: item.grade ?? "", valueUsd, tier, status: "available" });
      return { id };
    },
    async setItemStatus(id, status) {
      const i = db.inventory.find((x) => x.id === id);
      if (i && (i.status === "available" || i.status === "withheld" as string)) (i as { status: string }).status = status === "removed" ? "removed" : status;
    },
    async odds() { return db.odds; },
    async setOdds(rows) { db.odds = rows; },
    async flagged(): Promise<FlaggedPlayer[]> {
      return [...db.players.entries()].filter(([, p]) => p.frozen || p.opensToday >= DAILY_CAP).map(([playerId, p]) => ({ playerId, wallet: p.wallet, reasons: p.frozen ? ["frozen"] : ["daily cap reached"], frozen: p.frozen, flaggedAt: new Date().toISOString() }));
    },
    async setFrozen(playerId, frozen) { player(playerId).frozen = frozen; },
  },
};
