import { z } from 'zod';

export const LatSchema = z.number().finite().min(-90).max(90);
export const LngSchema = z.number().finite().min(-180).max(180);

/** Body the client sends to open a crate. */
export const OpenCrateRequestSchema = z.object({
  crateId: z.string().uuid(),
  lat: LatSchema,
  lng: LngSchema,
  accuracyM: z.number().finite().min(0).max(100_000),
  clientTs: z.number().int().positive(),
  deviceId: z.string().min(1).max(200),
});
export type OpenCrateRequest = z.infer<typeof OpenCrateRequestSchema>;

/** Fields the server adds from the authenticated session. Never from the request body. */
export const OpenCrateSessionSchema = z.object({
  playerId: z.string().uuid(),
  walletAddress: z.string().min(32).max(64),
  ip: z.string().max(64).nullable().optional(),
});

export const OpenCrateInputSchema = OpenCrateRequestSchema.merge(OpenCrateSessionSchema);
export type OpenCrateInput = z.infer<typeof OpenCrateInputSchema>;

export const LatLngSchema = z.object({ lat: LatSchema, lng: LngSchema });

export const PositionSchema = z.object({
  playerId: z.string().uuid(),
  lat: LatSchema,
  lng: LngSchema,
});

export const PingSchema = z.object({
  playerId: z.string().uuid(),
  lat: LatSchema,
  lng: LngSchema,
  accuracyM: z.number().finite().min(0).max(100_000),
  clientTs: z.number().int().positive(),
  deviceId: z.string().min(1).max(200),
  ip: z.string().max(64).nullable().optional(),
});

// Solana base58 address, 32-44 chars.
export const SolanaAddressSchema = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, 'invalid Solana address');

export const WalletLoginSchema = z.object({
  address: SolanaAddressSchema,
  type: z.enum(['external', 'embedded']),
});

export const CardTierSchema = z.enum(['common', 'uncommon', 'rare', 'grail']);

export const NewInventoryItemSchema = z.object({
  nftMint: SolanaAddressSchema,
  cardName: z.string().min(1).max(300),
  grade: z.string().max(50).nullable().optional(),
  valueUsd: z.number().finite().min(0).max(10_000_000),
  tier: CardTierSchema.optional(),
  imageUrl: z.string().url().nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
  location: z.enum(['hot', 'vault']).optional(),
  costUsd: z.number().finite().min(0).max(10_000_000).nullable().optional(),
  purchaseTxSignature: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,90}$/).nullable().optional(),
});

export const OddsWeightsSchema = z.object({
  common: z.number().int().min(0),
  uncommon: z.number().int().min(0),
  rare: z.number().int().min(0),
  grail: z.number().int().min(0),
  shards: z.number().int().min(0),
});

export const NewTreasuryEventSchema = z.object({
  kind: z.enum(['claim', 'purchase', 'topup', 'other']),
  amount: z.number().finite().nullable().optional(),
  asset: z.string().max(50).nullable().optional(),
  usdValue: z.number().finite().nullable().optional(),
  txSignature: z.string().max(120).nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
});
