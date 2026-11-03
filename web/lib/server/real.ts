import "server-only";
import * as srv from "@lotus/server";
import { validateOpen } from "@lotus/anticheat";
import type { PrizeItemView } from "@lotus/server";
import type { AdminInventoryItem, Crate, FeedPull, OpenResult, Tier } from "../types";
import type { GameServer } from "./types";

/** Adapter over `@lotus/server` (see /lotus/docs/contracts.md). */
const crateView = (c: srv.CrateView): Crate => ({ id: c.id, lat: c.lat, lng: c.lng, kind: c.kind, expiresAt: c.expiresAt, city: c.city, welcome: c.welcome });
const cardResult = (item: PrizeItemView, status: string): Extract<OpenResult, { kind: "card" }> => ({
  kind: "card", tier: item.tier, cardName: item.cardName, grade: item.grade ?? "Graded", valueUsd: item.valueUsd, imageUrl: item.imageUrl ?? undefined, nftMint: item.nftMint,
  status: status === "sent" ? "sent" : status === "failed" ? "failed" : "pending",
});

const maskWallet = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
interface PullRow { id: string; created_at: Date; wallet_address: string; card_name: string; grade: string | null; value_usd: string; tier: Tier; image_url: string | null; kind: Crate["kind"] }
// roll_kind, not the crate: every world crate is the same, the odds differ when a ticket was spent.
const PULLS_SQL = `SELECT o.id, o.created_at, o.wallet_address, i.card_name, i.grade, i.value_usd, i.tier, i.image_url, o.roll_kind AS kind
  FROM crate_openings o JOIN inventory_items i ON i.id = o.inventory_item_id
  WHERE o.result = 'card' AND o.status <> 'withheld'`;
const pullView = (r: PullRow): FeedPull => ({
  id: r.id, at: r.created_at.toISOString(), cardName: r.card_name, grade: r.grade ?? "Graded", valueUsd: Number(r.value_usd), tier: r.tier,
  imageUrl: r.image_url ?? undefined, collector: maskWallet(r.wallet_address), crateKind: r.kind,
});

export const realServer: GameServer = {
  async playerForWallet(address) {
    return (await srv.upsertPlayerByWallet({ address, type: "external" })).playerId;
  },
  async nearbyCrates(playerId, p) {
    // The ping still matters: anti-cheat walks it to check the player really travelled here.
    await srv.recordLocationPing({ playerId, lat: p.lat, lng: p.lng, accuracyM: p.accuracyM, clientTs: p.ts, deviceId: p.deviceId, ip: p.ip ?? null });
    const [world, welcome] = await Promise.all([
      srv.nearbyCrates({ lat: p.lat, lng: p.lng }),
      srv.welcomeCrate({ playerId, lat: p.lat, lng: p.lng }), // the player's own first crate, until they open it
    ]);
    return [...(welcome ? [welcome] : []), ...world].map(crateView);
  },
  async openCrate(playerId, crateId, p) {
    const player = await srv.getPlayer(playerId);
    const walletAddress = player?.wallets.find((w) => w.isPrimary)?.address ?? player?.wallets[0]?.address;
    if (!walletAddress) return { kind: "rejected", code: "not_found", message: "No wallet" };
    const r = await srv.openCrate({ crateId, lat: p.lat, lng: p.lng, accuracyM: p.accuracyM, clientTs: p.ts, deviceId: p.deviceId, playerId, walletAddress, ip: p.ip ?? null }, { validateOpen });
    if (!r.ok) return { kind: "rejected", code: r.code, message: r.message };
    if (r.outcome === "card") return cardResult(r.item, r.prizeStatus);
    return { kind: "shards", shards: r.shardsAwarded, ticketsGained: r.ticketsAwarded, shardsTotal: r.shards, ticketsTotal: r.tickets };
  },
  async balances(playerId) {
    // The hold status is a single indexed read of the player's own window: no RPC, no price feed.
    const [pl, a, hold] = await Promise.all([
      srv.getPlayer(playerId), srv.getAllowance(playerId), srv.getCoinHoldStatus(playerId),
    ]);
    return {
      shards: pl?.shards ?? 0,
      tickets: a.tickets,
      freeOpensLeft: a.freeOpensLeft,
      nextOpenCostsTicket: a.nextOpenCostsTicket,
      opensLeft: a.opensLeft,
      freeOpensPerDay: a.freeOpensPerDay,
      shardsPerTicket: a.shardsPerTicket,
      coinHold: hold,
    };
  },
  async history(playerId) {
    const rows = await srv.getPlayerHistory(playerId, { limit: 100 });
    return rows.map((o) => ({
      id: o.id,
      at: o.createdAt,
      result: o.outcome === "card" && o.item ? cardResult(o.item, o.status) : { kind: "shards" as const, shards: o.shardsAwarded, ticketsGained: o.ticketsAwarded, shardsTotal: 0, ticketsTotal: 0 },
    }));
  },
  async vaultStats() {
    const [v, odds, treasury] = await Promise.all([srv.getVaultStats(), srv.getPublicOdds("standard"), srv.getPool().query<{ kind: string; note: string | null; tx_signature: string | null; created_at: Date }>("SELECT kind, note, tx_signature, created_at FROM treasury_events ORDER BY created_at DESC LIMIT 10")]);
    const byTier = {} as Record<Tier, { count: number; odds: number }>;
    for (const t of srv.CARD_TIERS) byTier[t] = { count: v.byTier.find((b) => b.tier === t)?.available ?? 0, odds: odds.find((o) => o.tier === t)?.probability ?? 0 };
    return {
      cardsInVault: v.totalAvailable, cardsSent: v.totalSent, totalValueUsd: v.totalAvailableValueUsd, byTier,
      recentTreasury: treasury.rows.map((r) => ({ at: r.created_at.toISOString(), kind: r.kind, note: r.note ?? "", txSignature: r.tx_signature ?? undefined })),
    };
  },
  async coinMint() {
    return srv.currentCoinMint();
  },
  async feed() {
    const db = srv.getPool();
    const [recent, biggest, collectors, totals] = await Promise.all([
      db.query<PullRow>(`${PULLS_SQL} ORDER BY o.created_at DESC LIMIT 20`),
      db.query<PullRow>(`${PULLS_SQL} AND o.created_at > now() - interval '30 days' ORDER BY i.value_usd DESC LIMIT 20`),
      db.query<{ wallet_address: string; cards: number; total: string }>(`SELECT o.wallet_address, count(*)::int AS cards, sum(i.value_usd) AS total
        FROM crate_openings o JOIN inventory_items i ON i.id = o.inventory_item_id
        WHERE o.result = 'card' AND o.status <> 'withheld' GROUP BY o.wallet_address ORDER BY total DESC LIMIT 20`),
      db.query<{ collectors: number; pulled: number; won: string | null }>(`SELECT (SELECT count(*)::int FROM players) AS collectors, count(*)::int AS pulled, sum(i.value_usd) AS won
        FROM crate_openings o JOIN inventory_items i ON i.id = o.inventory_item_id WHERE o.result = 'card' AND o.status <> 'withheld'`),
    ]);
    const t = totals.rows[0];
    return {
      totals: { collectors: t?.collectors ?? 0, cardsPulled: t?.pulled ?? 0, wonUsd: Number(t?.won ?? 0) },
      recent: recent.rows.map(pullView),
      biggest: biggest.rows.map(pullView),
      collectors: collectors.rows.map((r) => ({ collector: maskWallet(r.wallet_address), cards: r.cards, totalUsd: Number(r.total) })),
    };
  },
  admin: {
    async coinSettings() {
      const s = await srv.readCoinSettings();
      return { mint: s.mint, gate: s.gateOff ? "off" : "on" };
    },
    async setCoin(input) { return srv.setCoinSettings(input); },
    async inventory() {
      const { rows } = await srv.getPool().query("SELECT id, nft_mint, card_name, grade, value_usd, tier, status, location FROM inventory_items ORDER BY acquired_at DESC LIMIT 500");
      return rows.map((r): AdminInventoryItem => ({ id: r.id, nftMint: r.nft_mint, cardName: r.card_name, grade: r.grade ?? "", valueUsd: Number(r.value_usd), tier: r.tier, status: r.status, location: r.location }));
    },
    async addItem(item) { return srv.addInventoryItem({ nftMint: item.nftMint, cardName: item.cardName, grade: item.grade, valueUsd: item.valueUsd, imageUrl: item.imageUrl, location: item.location, costUsd: item.costUsd, purchaseTxSignature: item.purchaseTxSignature }); },
    async setItemStatus(id, status) { await srv.setInventoryStatus(id, status); },
    async odds() {
      const { rows } = await srv.getPool().query<{ tier: string; weight: number }>("SELECT tier, weight FROM odds_config WHERE crate_kind = 'standard'");
      return rows.map((r) => ({ tier: r.tier as Tier | "shards", weight: r.weight }));
    },
    async setOdds(rows) {
      await srv.setOdds("standard", Object.fromEntries(rows.map((r) => [r.tier, r.weight])) as Record<srv.RollTier, number>);
    },
    async flagged() {
      return (await srv.listFlaggedPlayers()).map((f) => ({ playerId: f.playerId, wallet: f.wallets[0] ?? "", reasons: [`${f.openFlags} open flag(s)`, f.lastReason], frozen: f.status === "frozen", flaggedAt: f.lastFlagAt }));
    },
    async setFrozen(playerId, frozen) {
      if (frozen) await srv.freezePlayer(playerId, "admin"); else await srv.unfreezePlayer(playerId);
    },
  },
};
