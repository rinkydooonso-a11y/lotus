import { z } from "zod";

// Every threshold is a config value. Defaults are tuned for a walking game;
// override with LOTUS_AC_* env vars (see .env.example).
export const AntiCheatConfigSchema = z.object({
  /** Max distance (m) between the player and the crate when opening. */
  maxOpenDistanceM: z.number().positive().default(40),
  /** Reject a fix whose reported GPS accuracy is worse than this (m). */
  maxAccuracyM: z.number().positive().default(50),
  /** Max plausible ground speed (m/s) between two fixes. ~43 m/s = 155 km/h. */
  maxSpeedMps: z.number().positive().default(43),
  /** Any jump bigger than this (m) is a teleport unless enough time has passed for maxSpeedMps. */
  teleportDistanceM: z.number().positive().default(1000),
  /** Floor for the time between fixes, so two pings in the same second don't divide by ~0. */
  minPingIntervalMs: z.number().int().positive().default(1000),
  /** Opening requires a ping no older than this. 0 disables the requirement. */
  maxLastPingAgeMs: z.number().int().nonnegative().default(5 * 60_000),
  /** Allowed gap (ms) between client timestamp and server clock. */
  maxClockSkewMs: z.number().int().positive().default(30_000),
  /** If the last accepted ping is older than this, the next ping starts a fresh anchor (legit flights, phone off overnight). */
  anchorResetMs: z.number().int().positive().default(6 * 3600_000),
  /** Max pings read per open (newest kept). */
  maxPingsPerScan: z.number().int().positive().default(2000),
  /** Implausible-movement strikes in 24h before the player is auto-flagged. */
  movementStrikesToFlag: z.number().int().positive().default(3),

  /** Minimum seconds between opens, per wallet and per device. */
  walletCooldownS: z.number().int().nonnegative().default(20),
  deviceCooldownS: z.number().int().nonnegative().default(20),
  /** Max opens per UTC day. */
  walletDailyCap: z.number().int().positive().default(50),
  deviceDailyCap: z.number().int().positive().default(60),
  /** Max validateOpen calls (including rejected ones) per player per minute. */
  requestsPerMinute: z.number().int().positive().default(30),

  /** Sybil: wallets seen on one device / one IP (30 days) before signals fire. */
  maxWalletsPerDevice: z.number().int().positive().default(3),
  maxWalletsPerIp: z.number().int().positive().default(8),
  /** Sybil: wallets funded by the same source address before signal fires. */
  maxWalletsPerFunder: z.number().int().positive().default(5),
  /** Sybil: wallets younger than this (hours) count as fresh. */
  minWalletAgeH: z.number().nonnegative().default(24),
  /** Sum of signal weights at which the player is flagged for review / blocked from opening. */
  sybilFlagScore: z.number().positive().default(2),
  sybilBlockScore: z.number().positive().default(4),

  /** Same player+reason is written to player_flags at most once per this window. */
  flagDedupeS: z.number().int().positive().default(3600),
  /** Timeout for the on-chain wallet age/funder lookup; on timeout the signal is skipped. */
  walletLookupTimeoutMs: z.number().int().positive().default(1500),

  /** Redis key prefix so environments can share one Upstash db. */
  keyPrefix: z.string().default("lotus:ac:"),
});

export type AntiCheatConfig = z.infer<typeof AntiCheatConfigSchema>;

const ENV_KEYS: Record<string, keyof AntiCheatConfig> = {
  LOTUS_AC_MAX_OPEN_DISTANCE_M: "maxOpenDistanceM",
  LOTUS_AC_MAX_ACCURACY_M: "maxAccuracyM",
  LOTUS_AC_MAX_SPEED_MPS: "maxSpeedMps",
  LOTUS_AC_TELEPORT_DISTANCE_M: "teleportDistanceM",
  LOTUS_AC_MAX_LAST_PING_AGE_MS: "maxLastPingAgeMs",
  LOTUS_AC_MAX_CLOCK_SKEW_MS: "maxClockSkewMs",
  LOTUS_AC_ANCHOR_RESET_MS: "anchorResetMs",
  LOTUS_AC_MAX_PINGS_PER_SCAN: "maxPingsPerScan",
  LOTUS_AC_FLAG_DEDUPE_S: "flagDedupeS",
  LOTUS_AC_WALLET_LOOKUP_TIMEOUT_MS: "walletLookupTimeoutMs",
  LOTUS_AC_MOVEMENT_STRIKES_TO_FLAG: "movementStrikesToFlag",
  LOTUS_AC_WALLET_COOLDOWN_S: "walletCooldownS",
  LOTUS_AC_DEVICE_COOLDOWN_S: "deviceCooldownS",
  LOTUS_AC_WALLET_DAILY_CAP: "walletDailyCap",
  LOTUS_AC_DEVICE_DAILY_CAP: "deviceDailyCap",
  LOTUS_AC_REQUESTS_PER_MINUTE: "requestsPerMinute",
  LOTUS_AC_MAX_WALLETS_PER_DEVICE: "maxWalletsPerDevice",
  LOTUS_AC_MAX_WALLETS_PER_IP: "maxWalletsPerIp",
  LOTUS_AC_MAX_WALLETS_PER_FUNDER: "maxWalletsPerFunder",
  LOTUS_AC_MIN_WALLET_AGE_H: "minWalletAgeH",
  LOTUS_AC_SYBIL_FLAG_SCORE: "sybilFlagScore",
  LOTUS_AC_SYBIL_BLOCK_SCORE: "sybilBlockScore",
};

export function loadConfig(
  env: Record<string, string | undefined> = process.env,
  overrides: Partial<AntiCheatConfig> = {},
): AntiCheatConfig {
  const fromEnv: Record<string, unknown> = {};
  for (const [envKey, field] of Object.entries(ENV_KEYS)) {
    const raw = env[envKey];
    if (raw !== undefined && raw !== "") fromEnv[field] = Number(raw);
  }
  if (env.LOTUS_AC_KEY_PREFIX) fromEnv.keyPrefix = env.LOTUS_AC_KEY_PREFIX;
  return AntiCheatConfigSchema.parse({ ...fromEnv, ...overrides });
}
