import type { AdminInventoryItem, Balances, Crate, Feed, FlaggedPlayer, HistoryEntry, LocationPing, OddsRow, OpenResult, VaultStats } from "../types";

/**
 * The only surface the web app uses to talk to the game server.
 * Adapt `lib/server/real.ts` to /lotus/docs/contracts.md once it lands;
 * route handlers never import anything else for game logic.
 */
export interface GameServer {
  playerForWallet(address: string): Promise<string>;
  /** Records the location ping and returns the world crates around it. Creates nothing. */
  nearbyCrates(playerId: string, ping: LocationPing): Promise<Crate[]>;
  openCrate(playerId: string, crateId: string, ping: LocationPing): Promise<OpenResult>;
  balances(playerId: string): Promise<Balances>;
  history(playerId: string): Promise<HistoryEntry[]>;
  vaultStats(): Promise<VaultStats>;
  /** Public, read-only feed of recent and biggest card pulls. */
  feed(): Promise<Feed>;
  admin: {
    inventory(): Promise<AdminInventoryItem[]>;
    addItem(item: { nftMint: string; cardName: string; grade?: string; valueUsd: number; imageUrl?: string; location?: "hot" | "vault"; costUsd?: number; purchaseTxSignature?: string }): Promise<{ id: string }>;
    setItemStatus(id: string, status: "available" | "withheld" | "removed"): Promise<void>;
    odds(): Promise<OddsRow[]>;
    setOdds(rows: OddsRow[]): Promise<void>;
    flagged(): Promise<FlaggedPlayer[]>;
    setFrozen(playerId: string, frozen: boolean): Promise<void>;
  };
}
