import { z } from "zod";

const lat = z.number().finite().min(-90).max(90);
const lng = z.number().finite().min(-180).max(180);

/** The plain-data part of the contract's OpenContext, re-validated here as defense in depth. */
export const OpenContextDataSchema = z.object({
  now: z.date(),
  playerId: z.string().min(1).max(128),
  walletAddress: z.string().min(32).max(64),
  deviceId: z.string().min(1).max(256),
  ip: z.string().max(64).nullable(),
  client: z.object({
    lat,
    lng,
    accuracyM: z.number().finite().nonnegative(),
    clientTs: z.number().finite().positive(),
  }),
  crate: z.object({ id: z.string().min(1), lat, lng }).passthrough(),
  distanceM: z.number().finite().nonnegative(),
});

export interface Fix {
  lat: number;
  lng: number;
  accuracyM: number;
  /** Server time, epoch ms. */
  at: number;
}

/** Trusted movement state per player, kept in Redis. */
export interface Anchor {
  /** Last position we believe. */
  trusted: Fix;
  /** Pings up to this time (epoch ms) have already been walked. */
  scannedThrough: number;
}
