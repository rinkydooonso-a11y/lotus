import "server-only";
import * as srv from "@lotus/server";
import { validateOpen } from "@lotus/anticheat";
import type { PrizeItemView } from "@lotus/server";
import type { AdminInventoryItem, Crate, OpenResult, Tier } from "../types";
import type { GameServer } from "./types";

/** Adapter over `@lotus/server` (see /lotus/docs/contracts.md). */
const crateView = (c: srv.CrateView): Crate => ({ id: c.id, lat: c.lat, lng: c.lng, kind: c.kind, expiresAt: c.expiresAt });
const cardResult = (item: PrizeItemView, status: string): Extract<OpenResult, { kind: "card" }> => ({
  kind: "card", tier: item.tier, cardName: item.cardName, grade: item.grade ?? "Graded", valueUsd: item.valueUsd, imageUrl: item.imageUrl ?? undefined, nftMint: item.nftMint,
  status: status === "sent" ? "sent" : status === "failed" ? "failed" : "pending",
});

export const realServer: GameServer = {
  async playerForWallet(address) {
    return (await srv.upsertPlayerByWallet({ address, type: "external" })).playerId;
  },
  async nearbyCrates(playerId, p) {
    await srv.recordLocationPing({ playerId, lat: p.lat, lng: p.lng, accuracyM: p.accuracyM, clientTs: p.ts, deviceId: p.deviceId, ip: p.ip ?? null });
    return (await srv.spawnCratesNear({ playerId, lat: p.lat, lng: p.lng })).map(crateView);
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
  async useTicket(playerId, p) {
    const r = await srv.useTicket({ playerId, lat: p.lat, lng: p.lng });
    return r.ok ? { ok: true, crate: crateView(r.crate), tickets: r.tickets } : { ok: false, code: r.code };
  },
  async balances(playerId) {
    const pl = await srv.getPlayer(playerId);
    return { shards: pl?.shards ?? 0, tickets: pl?.tickets ?? 0 };
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
  admin: {
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
