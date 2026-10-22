import type { Pool, PoolClient } from 'pg';
import { GAME } from './config';
import { getPool } from './db';
import { secureRng, type Rng } from './rng';
import { SERVICE_CITIES, type ServiceCity } from './cities';
import { spotsFor, type Spot } from './crateSpots';
import { LatLngSchema } from './schemas';
import type { CrateView } from './types';

/**
 * World crates. One shared set per launch city: a crate belongs to nobody, any player who reaches
 * it can open it, and opening it takes it off the map for everyone (see openCrate.ts). Placement is
 * the seeder worker's job, not something a player's location ping triggers, so the number of crates
 * in the world — and with it the most the game can pay out in a day — does not grow with players.
 *
 * Spots come from a fixed grid inside each city's core (crateSpots.ts), so seeding makes no network
 * calls and cannot be stopped by an outage.
 */

/** Candidate spots tried per crate still needed. Spots too close to a live crate are skipped. */
const TRIES_PER_CRATE = 12;
/** Crates returned to one map view. */
const NEARBY_LIMIT = 60;

const CRATE_COLS = `id, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng, kind, expires_at, city, welcome`;

interface CrateRow {
  id: string;
  lat: number;
  lng: number;
  kind: CrateView['kind'];
  expires_at: Date;
  city: string | null;
  welcome: boolean;
}

function toCrateView(r: CrateRow): CrateView {
  return {
    id: r.id,
    lat: r.lat,
    lng: r.lng,
    kind: r.kind,
    expiresAt: new Date(r.expires_at).toISOString(),
    city: r.city ?? undefined,
    welcome: r.welcome || undefined,
  };
}

/** A welcome crate is placed this far from the player's first ping: close, but not on top of them. */
const WELCOME_MIN_M = 15;
const WELCOME_MAX_M = 30;
/** Long enough that a player who installs now and walks out next week still finds it. */
const WELCOME_TTL_DAYS = 30;

/** Start of the current UTC day, for the per-day creation ceiling. */
const UTC_DAY_START = `date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`;

/**
 * Crates on the map around a position. Read-only: it never creates anything, so a location ping
 * costs one indexed query and nothing else.
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

/**
 * The player's welcome crate, created on their first call. One per player for good: the unique
 * index lets only the first insert through, so a later ping never makes another, even after the
 * crate is opened or lapses. While it is unopened it follows the player: if they are further than
 * the map radius from it (they moved city, or connected from home), it is moved next to them.
 * Returns null once it has been opened.
 */
export async function welcomeCrate(
  input: { playerId: string; lat: number; lng: number },
  db: Pool | PoolClient = getPool(),
  rng: Rng = secureRng,
): Promise<CrateView | null> {
  const { lat, lng } = LatLngSchema.parse({ lat: input.lat, lng: input.lng });
  const dist = rng(WELCOME_MIN_M, WELCOME_MAX_M + 1);
  const bearing = (rng(0, 360) * Math.PI) / 180;
  const dLat = (dist * Math.cos(bearing)) / 111_320;
  const dLng = (dist * Math.sin(bearing)) / (111_320 * Math.max(0.01, Math.cos((lat * Math.PI) / 180)));
  const placed = [lat + dLat, lng + dLng];
  const geog = `ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography`;
  const r = await db.query<CrateRow>(
    `INSERT INTO crates (spawned_for_player_id, welcome, location, kind, expires_at)
     VALUES ($1, true, ${geog}, 'standard', now() + make_interval(days => $4))
     ON CONFLICT (spawned_for_player_id) WHERE welcome DO UPDATE
        SET location = EXCLUDED.location, status = 'active', expires_at = EXCLUDED.expires_at
      WHERE crates.status <> 'opened'
        AND (crates.status = 'expired' OR crates.expires_at <= now()
             OR NOT ST_DWithin(crates.location, ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography, $7))
     RETURNING ${CRATE_COLS}`,
    [input.playerId, placed[0], placed[1], WELCOME_TTL_DAYS, lng, lat, GAME.nearbyRadiusM],
  );
  if (r.rows[0]) return toCrateView(r.rows[0]);
  const cur = await db.query<CrateRow>(
    `SELECT ${CRATE_COLS} FROM crates
      WHERE spawned_for_player_id = $1 AND welcome AND status = 'active' AND expires_at > now()`,
    [input.playerId],
  );
  return cur.rows[0] ? toCrateView(cur.rows[0]) : null;
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
  /** Cities where every candidate spot tried was too close to a live crate. */
  noRoom: number;
}

/** In place, with the supplied integer source. */
function shuffle<T>(items: T[], rng: Rng): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = rng(0, i + 1);
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items;
}

/**
 * Tops every launch city up to cratesPerCity, within the global per-day ceiling. Run from the
 * worker every few minutes. Needs only the database: a city is filled from its fixed spot grid, so
 * a tick finishes the whole job rather than converging over several.
 */
export async function seedWorldCrates(
  opts: SeedOptions = {},
  db: Pool = getPool(),
  rng: Rng = secureRng,
): Promise<SeedReport> {
  const cities = opts.cities ?? SERVICE_CITIES;
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
    noRoom: 0,
  };

  // Round robin, one crate per city per pass, so a day-ceiling that runs out part way through is
  // shared out evenly instead of going to whichever city came first.
  const queues = new Map<string, Spot[]>();
  for (const w of want) queues.set(w.city.name, shuffle([...spotsFor(w.city)], rng).slice(0, w.short * TRIES_PER_CRATE));

  while (budgetLeft > 0 && want.some((w) => w.short > 0)) {
    let placedThisPass = false;
    for (const w of want) {
      if (w.short <= 0 || budgetLeft <= 0) continue;
      const queue = queues.get(w.city.name)!;
      let placed = false;
      // The spacing check is in the INSERT, so a spot too close to a live crate just returns null.
      while (!placed && queue.length > 0) {
        const spot = queue.pop()!;
        placed = (await insertWorldCrate(db, { ...spot, city: w.city.name })) !== null;
      }
      if (!placed) {
        w.short = 0;
        report.noRoom++;
        continue;
      }
      w.short--;
      budgetLeft--;
      report.created++;
      report.byCity[w.city.name] = (report.byCity[w.city.name] ?? 0) + 1;
      placedThisPass = true;
    }
    if (!placedThisPass) break;
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
