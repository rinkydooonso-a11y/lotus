import type { Pool } from "pg";
import type { AntiCheatConfig } from "./config";
import type { KV } from "./store";

/**
 * Writes to player_flags (source 'anticheat'), the admin review queue. Freezing and
 * withholding prizes are core's freezePlayer/unfreezePlayer, which the admin page calls.
 */
export interface FlagSink {
  write(playerId: string, reason: string, details: Record<string, unknown>): Promise<void>;
}

export function pgFlags(db: Pool): FlagSink {
  return {
    async write(playerId, reason, details) {
      await db.query(
        `INSERT INTO player_flags (player_id, source, reason, details) VALUES ($1, 'anticheat', $2, $3::jsonb)`,
        [playerId, reason, JSON.stringify(details)],
      );
    },
  };
}

/** True once per player+reason per dedupe window, so one cheater doesn't fill the queue. */
export async function claimFlagSlot(kv: KV, cfg: AntiCheatConfig, playerId: string, reason: string, now: number) {
  return kv.set(`${cfg.keyPrefix}flag:${reason}:${playerId}`, String(now), { exSec: cfg.flagDedupeS, nx: true });
}
