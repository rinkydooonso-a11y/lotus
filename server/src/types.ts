import type { Pool } from 'pg';

export const CARD_TIERS = ['common', 'uncommon', 'rare', 'grail'] as const;
export type CardTier = (typeof CARD_TIERS)[number];
export type RollTier = CardTier | 'shards';
export const ROLL_TIERS: readonly RollTier[] = ['grail', 'rare', 'uncommon', 'common', 'shards'];

export type CrateKind = 'standard' | 'ticket';
export type WalletType = 'external' | 'embedded';
export type InventoryStatus = 'available' | 'reserved' | 'sent' | 'withheld' | 'removed';
export type InventoryLocation = 'hot' | 'vault';
export type OpeningStatus = 'complete' | 'pending' | 'sent' | 'failed' | 'withheld';
export type PrizeSendStatus = 'queued' | 'processing' | 'submitted' | 'sent' | 'failed' | 'withheld';

export interface CrateView {
  id: string;
  lat: number;
  lng: number;
  kind: CrateKind;
  expiresAt: string;
}

export interface PlayerSummary {
  id: string;
  status: 'active' | 'frozen';
  shards: number;
  tickets: number;
  createdAt: string;
  wallets: { address: string; type: WalletType; isPrimary: boolean }[];
}

export interface PingInput {
  playerId: string;
  lat: number;
  lng: number;
  accuracyM: number;
  clientTs: number;
  deviceId: string;
  ip?: string | null;
}

export interface PrizeItemView {
  id: string;
  nftMint: string;
  cardName: string;
  grade: string | null;
  valueUsd: number;
  tier: CardTier;
  imageUrl: string | null;
}

export type OpenRejectCode =
  | 'not_found'
  | 'not_yours'
  | 'expired'
  | 'already_opened'
  | 'too_far'
  | 'frozen'
  | 'anticheat'
  | 'invalid_input';

export type OpenCrateResult =
  | {
      ok: true;
      openingId: string;
      replayed: boolean;
      outcome: 'card';
      item: PrizeItemView;
      prizeStatus: OpeningStatus;
    }
  | {
      ok: true;
      openingId: string;
      replayed: boolean;
      outcome: 'shards';
      shardsAwarded: number;
      ticketsAwarded: number;
      shards: number;
      tickets: number;
      downgraded: boolean;
    }
  | { ok: false; code: OpenRejectCode; message: string };

// Anti-cheat hook ---------------------------------------------------------------

export interface OpenContext {
  /** Pool, not the open transaction. */
  db: Pool;
  now: Date;
  playerId: string;
  walletAddress: string;
  deviceId: string;
  ip: string | null;
  client: { lat: number; lng: number; accuracyM: number; clientTs: number };
  crate: { id: string; lat: number; lng: number; kind: CrateKind; spawnedAt: Date; expiresAt: Date };
  /** Server-computed distance from client position to crate, metres. */
  distanceM: number;
}

export type ValidateResult =
  | { ok: true }
  | { ok: false; reason: string; flag?: { reason: string; details?: Record<string, unknown> } };

export type ValidateOpen = (ctx: OpenContext) => Promise<ValidateResult>;

// History / stats -----------------------------------------------------------------

export interface OpeningView {
  id: string;
  crateId: string;
  createdAt: string;
  outcome: 'card' | 'shards';
  downgraded: boolean;
  shardsAwarded: number;
  ticketsAwarded: number;
  status: OpeningStatus;
  txSignature: string | null;
  item: PrizeItemView | null;
}

export interface VaultStats {
  byTier: { tier: CardTier; available: number; reserved: number; sent: number; availableValueUsd: number }[];
  totalAvailable: number;
  totalAvailableValueUsd: number;
  totalSent: number;
  totalSentValueUsd: number;
  totalOpenings: number;
  recentWinners: { wallet: string; cardName: string; tier: CardTier; valueUsd: number; at: string }[];
}

export interface OddsView {
  tier: RollTier;
  /** Configured weight, parts per 1,000,000. */
  baseWeight: number;
  /** Effective probability 0..1 after zeroing tiers with no inventory. */
  probability: number;
}

export interface FlaggedPlayer {
  playerId: string;
  status: 'active' | 'frozen';
  openFlags: number;
  lastFlagAt: string;
  lastReason: string;
  wallets: string[];
}

export interface NewInventoryItem {
  nftMint: string;
  cardName: string;
  grade?: string | null;
  valueUsd: number;
  tier?: CardTier;
  imageUrl?: string | null;
  metadata?: Record<string, unknown>;
  /** 'vault' = held in the Squads vault, tracked but not awardable until a top-up lands it in the hot wallet. Default 'hot'. */
  location?: InventoryLocation;
  /** What we paid. When given, a 'purchase' treasury event is written with the item. */
  costUsd?: number | null;
  purchaseTxSignature?: string | null;
}

export interface NewTreasuryEvent {
  kind: 'claim' | 'purchase' | 'topup' | 'other';
  amount?: number | null;
  asset?: string | null;
  usdValue?: number | null;
  txSignature?: string | null;
  note?: string | null;
}

export interface PrizeSendJob {
  id: string;
  openingId: string;
  inventoryItemId: string;
  nftMint: string;
  recipientAddress: string;
  attempts: number;
  status: PrizeSendStatus;
  txSignature: string | null;
}
