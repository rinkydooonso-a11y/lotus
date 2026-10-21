export type RejectCode = "not_found" | "not_yours" | "expired" | "already_opened" | "too_far" | "frozen" | "anticheat" | "invalid_input" | "unavailable";
export type Tier = "common" | "uncommon" | "rare" | "grail";

export interface Crate {
  id: string;
  lat: number;
  lng: number;
  expiresAt: string;
  kind: "standard" | "ticket";
}

export interface LocationPing {
  lat: number;
  lng: number;
  accuracyM: number;
  ts: number;
  deviceId: string;
  /** Set by route handlers from request headers, never from the client body. */
  ip?: string | null;
  /** Set by route handlers for admins only (skips the launch-city gate), never from the client body. */
  anywhere?: boolean;
}

export type OpenResult =
  | { kind: "card"; tier: Tier; cardName: string; grade: string; valueUsd: number; imageUrl?: string; nftMint: string; status: "pending" | "sent" | "failed"; txSignature?: string }
  | { kind: "shards"; shards: number; ticketsGained: number; shardsTotal: number; ticketsTotal: number }
  | { kind: "rejected"; code: RejectCode; message: string };

export interface Balances {
  shards: number;
  tickets: number;
}

export interface HistoryEntry {
  id: string;
  at: string;
  result: Exclude<OpenResult, { kind: "rejected" }>;
}

export interface VaultStats {
  cardsInVault: number;
  cardsSent: number;
  totalValueUsd: number;
  byTier: Record<Tier, { count: number; odds: number }>;
  recentTreasury: { at: string; kind: string; note: string; txSignature?: string }[];
}

export interface AdminInventoryItem {
  id: string;
  nftMint: string;
  cardName: string;
  grade: string;
  valueUsd: number;
  tier: Tier;
  status: "available" | "reserved" | "sent" | "withheld" | "removed";
  /** "vault" = in the Squads vault, not awardable until a top-up lands it in the hot wallet. Missing = hot. */
  location?: "hot" | "vault";
}

export interface OddsRow { tier: Tier | "shards"; weight: number }

export interface FlaggedPlayer {
  playerId: string;
  wallet: string;
  reasons: string[];
  frozen: boolean;
  flaggedAt: string;
}

/** A public card pull for the live feed. Wallets are masked server-side. */
export interface FeedPull {
  id: string;
  at: string;
  cardName: string;
  grade: string;
  valueUsd: number;
  tier: Tier;
  imageUrl?: string;
  collector: string;
  crateKind: Crate["kind"];
}

export interface FeedCollector {
  collector: string;
  cards: number;
  totalUsd: number;
}

export interface Feed {
  /** All-time totals for the live stats strip. */
  totals: { collectors: number; cardsPulled: number; wonUsd: number };
  recent: FeedPull[];
  biggest: FeedPull[];
  collectors: FeedCollector[];
}
