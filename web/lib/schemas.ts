import { z } from "zod";

export const pingSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracyM: z.number().min(0).max(100000),
  ts: z.number().int(),
  deviceId: z.string().min(8).max(128),
});

export const nearbyQuery = pingSchema;
export const openBody = pingSchema.extend({ crateId: z.string().min(1).max(64) });

export const verifyBody = z.object({
  address: z.string().min(32).max(44),
  signature: z.string().min(64).max(100),
  nonce: z.string().min(16).max(128),
});

export const oddsBody = z.object({
  rows: z.array(z.object({ tier: z.enum(["common", "uncommon", "rare", "grail", "shards"]), weight: z.number().min(0).max(1_000_000) })).min(1),
});
export const freezeBody = z.object({ playerId: z.string().min(1), frozen: z.boolean() });

export const coinBody = z.object({ mint: z.string().trim().min(32).max(44).nullable(), gate: z.enum(["on", "off"]) });
