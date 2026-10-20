import type { Pool } from "pg";
import type { Fix } from "./types";

/** Reads location pings the core server stored (recordLocationPing). */
export interface PingSource {
  /** Pings for the player with recorded_at > sinceMs, oldest first. */
  since(playerId: string, sinceMs: number, limit: number): Promise<Fix[]>;
}

export function pgPings(db: Pool): PingSource {
  return {
    async since(playerId, sinceMs, limit) {
      // Take the newest `limit` rows (index player_id, recorded_at DESC), then return them oldest first.
      const { rows } = await db.query<{ lat: number; lng: number; accuracy_m: number; at_ms: string }>(
        `SELECT lat, lng, accuracy_m, at_ms FROM (
           SELECT ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng, accuracy_m,
                  (extract(epoch FROM recorded_at) * 1000)::bigint AS at_ms, recorded_at
             FROM location_pings
            WHERE player_id = $1 AND recorded_at > to_timestamp($2::double precision / 1000)
            ORDER BY recorded_at DESC
            LIMIT $3
         ) t ORDER BY recorded_at ASC`,
        [playerId, sinceMs, limit],
      );
      return rows.map((r) => ({ lat: Number(r.lat), lng: Number(r.lng), accuracyM: Number(r.accuracy_m), at: Number(r.at_ms) }));
    },
  };
}
