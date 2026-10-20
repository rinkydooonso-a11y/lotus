import type { Pool, PoolClient } from 'pg';
import { GAME } from './config';
import { getPool, withTx } from './db';
import { secureRng, type Rng } from './rng';
import { PositionSchema } from './schemas';
import type { CrateKind, CrateView } from './types';
import { isWater, loadAreaFor, pickSpawnPoints, type AreaData } from './walkable';

/** Active crates far from the player's current position are retired so new ones spawn nearby. */
const RETIRE_BEYOND_M = 2_000;

const CRATE_VIEW_SQL = `SELECT id, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng, kind, expires_at
  FROM crates WHERE spawned_for_player_id = $1 AND status = 'active' AND expires_at > now()
  ORDER BY spawned_at`;

function toCrateView(r: { id: string; lat: number; lng: number; kind: CrateKind; expires_at: Date }): CrateView {
  return { id: r.id, lat: r.lat, lng: r.lng, kind: r.kind, expiresAt: new Date(r.expires_at).toISOString() };
}

export async function getActiveCrates(playerId: string, db: Pool | PoolClient = getPool()): Promise<CrateView[]> {
  const r = await db.query(CRATE_VIEW_SQL, [playerId]);
  return r.rows.map(toCrateView);
}

/** Random distance in [min, max] metres, uniform over the ring's area, and a random bearing in radians. */
export function randomOffset(rng: Rng): { distanceM: number; azimuthRad: number } {
  const u = rng(0, 1_000_000) / 1_000_000;
  const { spawnMinDistanceM: min, spawnMaxDistanceM: max } = GAME;
  const distanceM = Math.sqrt(u * (max * max - min * min) + min * min);
  const azimuthRad = (rng(0, 3_600_000) / 3_600_000) * 2 * Math.PI;
  return { distanceM, azimuthRad };
}

/** Fallback when walkable data is unavailable: a short hop from the player, who is presumably on walkable ground. */
const NUDGE_MAX_M = 90;
export function nudgeOffset(rng: Rng): { distanceM: number; azimuthRad: number } {
  const distanceM = GAME.spawnMinDistanceM + rng(0, (NUDGE_MAX_M - GAME.spawnMinDistanceM) * 100) / 100;
  return { distanceM, azimuthRad: (rng(0, 3_600_000) / 3_600_000) * 2 * Math.PI };
}

/** Nudge that avoids known water when we have map data; after a few tries the player's own spot. */
function safeNudge(lat: number, lng: number, area: AreaData | null, rng: Rng) {
  for (let i = 0; i < 6; i++) {
    const off = nudgeOffset(rng);
    if (!area) return off;
    const dLat = (off.distanceM * Math.cos(off.azimuthRad)) / 111_320;
    const dLng = (off.distanceM * Math.sin(off.azimuthRad)) / (111_320 * Math.cos((lat * Math.PI) / 180));
    if (!isWater(area, { lat: lat + dLat, lng: lng + dLng })) return off;
  }
  return undefined;
}

export async function insertCrate(
  c: PoolClient,
  args: { playerId: string; lat: number; lng: number; kind: CrateKind; offset?: { distanceM: number; azimuthRad: number } },
): Promise<CrateView> {
  const off = args.offset ?? { distanceM: 0, azimuthRad: 0 };
  const r = await c.query(
    `INSERT INTO crates (location, spawned_for_player_id, kind, expires_at)
     VALUES (ST_Project(ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography, $3::float8, $4::float8), $5, $6,
             now() + make_interval(secs => $7))
     RETURNING id, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng, kind, expires_at`,
    [args.lat, args.lng, off.distanceM, off.azimuthRad, args.playerId, args.kind, GAME.crateTtlMs / 1000],
  );
  return toCrateView(r.rows[0]);
}

/**
 * Tops the player up to the active-crate cap around (lat, lng) and returns all their active crates.
 * First-ever crate lands on the player's position. The rest land on OSM walkable ground (footways, parks,
 * plazas) and never on water; if OSM data is unavailable they are a short nudge from the player (see decisions.md).
 */
export async function spawnCratesNear(
  input: { playerId: string; lat: number; lng: number },
  db: Pool = getPool(),
  rng: Rng = secureRng,
): Promise<CrateView[]> {
  const { playerId, lat, lng } = PositionSchema.parse(input);
  // Fetched before the transaction so a slow Overpass never holds the player row lock. Null = unavailable.
  const area = await loadAreaFor(lat, lng);
  return withTx(db, async (c) => {
    const p = await c.query<{ status: string; first_crate_spawned: boolean }>(
      'SELECT status, first_crate_spawned FROM players WHERE id = $1 FOR UPDATE',
      [playerId],
    );
    const player = p.rows[0];
    if (!player || player.status !== 'active') return [];

    await c.query(
      `UPDATE crates SET status = 'expired'
        WHERE spawned_for_player_id = $1 AND status = 'active'
          AND (expires_at <= now()
               OR (kind = 'standard' AND NOT ST_DWithin(location, ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography, $4)))`,
      [playerId, lat, lng, RETIRE_BEYOND_M],
    );

    const counts = await c.query<{ active: number; today: number }>(
      `SELECT count(*) FILTER (WHERE status = 'active' AND kind = 'standard')::int AS active,
              count(*) FILTER (WHERE kind = 'standard' AND spawned_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')::int AS today
         FROM crates WHERE spawned_for_player_id = $1`,
      [playerId],
    );
    const { active, today } = counts.rows[0]!;
    const toSpawn = Math.max(0, Math.min(GAME.maxActiveCratesPerPlayer - active, GAME.maxSpawnsPerPlayerPerDay - today));

    let first = !player.first_crate_spawned;
    const points = area ? pickSpawnPoints(area, { lat, lng }, Math.max(0, toSpawn - (first ? 1 : 0)), rng) : [];
    for (let i = 0; i < toSpawn; i++) {
      if (first) {
        await insertCrate(c, { playerId, lat, lng, kind: 'standard' });
        await c.query('UPDATE players SET first_crate_spawned = true WHERE id = $1', [playerId]);
        first = false;
        continue;
      }
      const pt = points.shift();
      if (pt) await insertCrate(c, { playerId, lat: pt.lat, lng: pt.lng, kind: 'standard' });
      else await insertCrate(c, { playerId, lat, lng, kind: 'standard', offset: safeNudge(lat, lng, area, rng) });
    }
    return getActiveCrates(playerId, c);
  });
}

/** Marks every past-expiry active crate expired. Run from a worker every minute. */
export async function expireStaleCrates(db: Pool = getPool()): Promise<number> {
  const r = await db.query(`UPDATE crates SET status = 'expired' WHERE status = 'active' AND expires_at <= now()`);
  return r.rowCount ?? 0;
}
