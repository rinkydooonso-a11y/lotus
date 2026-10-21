import type { Pool, PoolClient } from 'pg';
import { GAME } from './config';
import { getPool } from './db';
import { secureRng, type Rng } from './rng';
import { SERVICE_CITIES, type ServiceCity } from './cities';
import { LatLngSchema } from './schemas';
import type { CrateView } from './types';
import { loadAreaFor, pickSpawnPoints, type AreaData, type LatLng } from './walkable';

/**
 * World crates. One shared set per launch city: a crate belongs to nobody, any player who reaches
 * it can open it, and opening it takes it off the map for everyone (see openCrate.ts). Placement is
 * the seeder worker's job, not something a player's location ping triggers, so the number of crates
 * in the world — and with it the most the game can pay out in a day — does not grow with players.
 */

const M_PER_DEG_LAT = 111_320;
/** Crates placed per Overpass lookup. Each lookup covers one ~400 m patch of walkable ground. */
const CRATES_PER_ANCHOR = 3;
/** Crates returned to one map view. */
const NEARBY_LIMIT = 60;

const CRATE_COLS = `id, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng, kind, expires_at, city`;

interface CrateRow {
  id: string;
  lat: number;
  lng: number;
  kind: CrateView['kind'];
  expires_at: Date;
  city: string | null;
}

function toCrateView(r: CrateRow): CrateView {
  return {
    id: r.id,
    lat: r.lat,
    lng: r.lng,
    kind: r.kind,
    expiresAt: new Date(r.expires_at).toISOString(),
    city: r.city ?? undefined,
  };
}

/** Start of the current UTC day, for the per-day creation ceiling. */
const UTC_DAY_START = `date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`;

/**
 * Crates on the map around a position. Read-only: it never creates anything, so a location ping
 * costs one indexed query and no Overpass call.
 */
export async function nearbyCrates(
  input: { lat: number; lng: number; radiusM?: number },
  db: Pool | PoolClient = getPool(),
): Promise<CrateView[]> {
  const { lat, lng } = LatLngSchema.parse(input);
  const radiusM = Math.min(Math.max(1, input.radiusM ?? GAME.nearbyRadiusM), GAME.nearbyRadiusM);
  const r = await db.query<CrateRow>(
    `SELECT ${CRATE_COLS}
       FROM crates
      WHERE status = 'active' AND expires_at > now() AND city IS NOT NULL
        AND ST_DWithin(location, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography, $3)
      ORDER BY location <-> ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
      LIMIT ${NEARBY_LIMIT}`,
    [lat, lng, radiusM],
  );
  return r.rows.map(toCrateView);
}

/** Pure: a point drawn uniformly over the area of the circle (not biased towards the centre). */
export function randomPointInCircle(center: LatLng, radiusM: number, rng: Rng): LatLng {
  const r = radiusM * Math.sqrt(rng(0, 1_000_000) / 1_000_000);
  const theta = (rng(0, 3_600_000) / 3_600_000) * 2 * Math.PI;
  return {
    lat: center.lat + (r * Math.cos(theta)) / M_PER_DEG_LAT,
    lng: center.lng + (r * Math.sin(theta)) / (M_PER_DEG_LAT * Math.cos((center.lat * Math.PI) / 180)),
  };
}

/**
 * Adds one crate, unless an active crate is already within crateMinSpacingM. The check is part of
 * the INSERT, so two seeder runs (or two anchors in one run) can't drop crates on the same corner.
 * Returns null when the spot was too close to something already on the map.
 */
async function insertWorldCrate(
  db: Pool | PoolClient,
  args: { lat: number; lng: number; city: string },
): Promise<CrateView | null> {
  const r = await db.query<CrateRow>(
    `INSERT INTO crates (location, city, kind, expires_at)
     SELECT p.geog, $3, 'standard', now() + make_interval(secs => $4)
       FROM (SELECT ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography AS geog) p
      WHERE NOT EXISTS (
        SELECT 1 FROM crates c WHERE c.status = 'active' AND ST_DWithin(c.location, p.geog, $5))
     RETURNING ${CRATE_COLS}`,
    [args.lat, args.lng, args.city, GAME.crateTtlMs / 1000, GAME.crateMinSpacingM],
  );
  return r.rows[0] ? toCrateView(r.rows[0]) : null;
}

export interface SeedOptions {
  cities?: readonly ServiceCity[];
  /** Overpass lookups allowed in one tick, across every city. Keeps a tick short and polite. */
  maxAnchors?: number;
  areaLoader?: (lat: number, lng: number) => Promise<AreaData | null>;
  /** Defaults to GAME.cratesPerCity. */
  cratesPerCity?: number;
  /** Defaults to GAME.maxWorldCratesPerDay. */
  maxPerDay?: number;
}

export interface SeedReport {
  created: number;
  byCity: Record<string, number>;
  /** Crates the cities were short of when the tick started. */
  shortfall: number;
  /** Crates still allowed to be created today when the tick finished. */
  budgetLeft: number;
  /** Anchors skipped because OpenStreetMap data was unavailable. */
  noAreaData: number;
}

/**
 * Tops every launch city up towards cratesPerCity, within the global per-day ceiling.
 * Run from the worker every few minutes; it converges over several ticks rather than doing
 * everything at once, because each placement needs a (rate limited, cached) Overpass lookup.
 *
 * Crates only ever land on walkable OpenStreetMap ground and never on water. When Overpass is
 * unavailable nothing is placed: an empty patch of map is better than a crate in a lake or on a
 * motorway, and crates already out live for crateTtlMs, which gives the next ticks time to work.
 */
export async function seedWorldCrates(
  opts: SeedOptions = {},
  db: Pool = getPool(),
  rng: Rng = secureRng,
): Promise<SeedReport> {
  const cities = opts.cities ?? SERVICE_CITIES;
  const maxAnchors = opts.maxAnchors ?? 8;
  const load = opts.areaLoader ?? loadAreaFor;
  const target = opts.cratesPerCity ?? GAME.cratesPerCity;
  const maxPerDay = opts.maxPerDay ?? GAME.maxWorldCratesPerDay;

  const createdToday = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM crates WHERE city IS NOT NULL AND spawned_at >= ${UTC_DAY_START}`,
  );
  let budgetLeft = Math.max(0, maxPerDay - (createdToday.rows[0]?.n ?? 0));

  const activeByCity = await db.query<{ city: string; n: number }>(
    `SELECT city, count(*)::int AS n FROM crates
      WHERE status = 'active' AND expires_at > now() AND city IS NOT NULL GROUP BY city`,
  );
  const have = new Map(activeByCity.rows.map((r) => [r.city, r.n]));

  const want = cities
    .map((city) => ({ city, short: Math.max(0, target - (have.get(city.name) ?? 0)) }))
    .filter((w) => w.short > 0)
    .sort((a, b) => b.short - a.short);

  const report: SeedReport = {
    created: 0,
    byCity: {},
    shortfall: want.reduce((n, w) => n + w.short, 0),
    budgetLeft,
    noAreaData: 0,
  };

  // Round robin over the cities that are short, so one big city can't use up the whole tick.
  let anchors = 0;
  while (anchors < maxAnchors && budgetLeft > 0 && want.some((w) => w.short > 0)) {
    for (const w of want) {
      if (w.short <= 0) continue;
      if (anchors >= maxAnchors || budgetLeft <= 0) break;
      anchors++;

      const anchor = randomPointInCircle(w.city, w.city.radiusKm * 1_000, rng);
      const area = await load(anchor.lat, anchor.lng);
      if (!area) {
        report.noAreaData++;
        continue;
      }
      const take = Math.min(w.short, budgetLeft, CRATES_PER_ANCHOR);
      const points = pickSpawnPoints(area, anchor, take, rng, {
        minM: 0,
        maxM: GAME.citySeedRadiusM,
        spacingM: GAME.crateMinSpacingM,
      });
      for (const pt of points) {
        if (budgetLeft <= 0) break;
        if (!(await insertWorldCrate(db, { ...pt, city: w.city.name }))) continue;
        w.short--;
        budgetLeft--;
        report.created++;
        report.byCity[w.city.name] = (report.byCity[w.city.name] ?? 0) + 1;
      }
    }
  }
  report.budgetLeft = budgetLeft;
  return report;
}

/** Marks every past-expiry active crate expired. Run from a worker every minute. */
export async function expireStaleCrates(db: Pool = getPool()): Promise<number> {
  const r = await db.query(`UPDATE crates SET status = 'expired' WHERE status = 'active' AND expires_at <= now()`);
  return r.rowCount ?? 0;
}

/** How many crates are on the map, by city. For the admin page. */
export async function crateCountsByCity(db: Pool = getPool()): Promise<{ city: string; active: number }[]> {
  const r = await db.query<{ city: string; active: number }>(
    `SELECT city, count(*)::int AS active FROM crates
      WHERE status = 'active' AND expires_at > now() AND city IS NOT NULL GROUP BY city ORDER BY city`,
  );
  return r.rows;
}
