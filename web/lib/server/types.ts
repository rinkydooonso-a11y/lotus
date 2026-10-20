import type { AdminInventoryItem, Balances, Crate, FlaggedPlayer, HistoryEntry, LocationPing, OddsRow, OpenResult, VaultStats } from "../types";

/**
 * The only surface the web app uses to talk to the game server.
 * Adapt `lib/server/real.ts` to /lotus/docs/contracts.md once it lands;
 * route handlers never import anything else for game logic.
 */
export interface GameServer {
  playerForWallet(address: string): Promise<string>;
  nearbyCrates(playerId: string, ping: LocationPing): Promise<Crate[]>;
  openCrate(playerId: string, crateId: string, ping: LocationPing): Promise<OpenResult>;
  useTicket(playerId: string, ping: LocationPing): Promise<{ ok: true; crate: Crate; tickets: number } | { ok: false; code: "no_tickets" | "frozen" }>;
  balances(playerId: string): Promise<Balances>;
  history(playerId: string): Promise<HistoryEntry[]>;
  vaultStats(): Promise<VaultStats>;
  admin: {
    inventory(): Promise<AdminInventoryItem[]>;
    addItem(item: { nftMint: string; cardName: string; grade?: string; valueUsd: number; imageUrl?: string }): Promise<{ id: string }>;
    setItemStatus(id: string, status: "available" | "withheld" | "removed"): Promise<void>;
    odds(): Promise<OddsRow[]>;
    setOdds(rows: OddsRow[]): Promise<void>;
    flagged(): Promise<FlaggedPlayer[]>;
    setFrozen(playerId: string, frozen: boolean): Promise<void>;
  };
}
