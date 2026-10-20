import type { AntiCheatConfig } from "./config";
import { haversineM } from "./geo";
import type { Fix } from "./types";

export interface MovementVerdict {
  ok: boolean;
  distanceM: number;
  /** Speed after subtracting both fixes' accuracy radii (benefit of the doubt for GPS noise). */
  speedMps: number;
  detail?: string;
}

/**
 * Is moving from `prev` to `next` physically plausible?
 * Accuracy radii are subtracted from the distance so normal GPS jitter never trips it,
 * but accuracy is capped at maxAccuracyM so a client can't claim 50km accuracy to excuse a jump.
 */
export function checkMovement(prev: Fix, next: Fix, cfg: AntiCheatConfig): MovementVerdict {
  const distanceM = haversineM(prev, next);
  const slack =
    Math.min(prev.accuracyM, cfg.maxAccuracyM) + Math.min(next.accuracyM, cfg.maxAccuracyM);
  const effective = Math.max(0, distanceM - slack);
  const dtMs = Math.max(next.at - prev.at, cfg.minPingIntervalMs);
  const speedMps = effective / (dtMs / 1000);

  if (speedMps > cfg.maxSpeedMps) {
    const kind = effective >= cfg.teleportDistanceM ? "teleport" : "speed";
    return {
      ok: false,
      distanceM,
      speedMps,
      detail: `${kind}: ${Math.round(distanceM)}m in ${(dtMs / 1000).toFixed(1)}s (${speedMps.toFixed(1)} m/s)`,
    };
  }
  return { ok: true, distanceM, speedMps };
}

export interface WalkResult {
  trusted: Fix | null;
  /** Pings that could not be reached from the trusted position. */
  rejected: { fix: Fix; detail: string }[];
}

/**
 * Walks pings (oldest first) from the trusted position. A ping that is plausible from the
 * trusted position becomes the new trusted position; one that isn't is skipped. So a one-off
 * GPS glitch is ignored, while a teleport leaves every later ping (and the open) unreachable
 * until anchorResetMs has passed since the last trusted fix.
 */
export function walkPings(start: Fix | null, pings: Fix[], cfg: AntiCheatConfig): WalkResult {
  let trusted = start;
  const rejected: WalkResult["rejected"] = [];
  for (const p of pings) {
    if (p.accuracyM > cfg.maxAccuracyM) continue;
    if (!trusted || p.at - trusted.at >= cfg.anchorResetMs) {
      trusted = p;
      continue;
    }
    const v = checkMovement(trusted, p, cfg);
    if (v.ok) trusted = p;
    else rejected.push({ fix: p, detail: v.detail ?? "implausible" });
  }
  return { trusted, rejected };
}
