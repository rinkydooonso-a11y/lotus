import { GAME } from './config';
import type { Rng } from './rng';

/**
 * Walkable-ground spawn points from OpenStreetMap (Overpass API), no account or key needed.
 * Data is fetched per ~400 m grid cell, cached in memory, rate limited, and falls back to
 * "unavailable" (null) when Overpass is slow or down; the spawner then uses a short nudge.
 */

export type LatLng = { lat: number; lng: number };
export type Ring = LatLng[];
/** Everything near a point that matters for placement. Lines/areas are walkable; water is forbidden. */
export interface AreaData {
  lines: Ring[]; // footways, pedestrian streets, paths, cycleways
  areas: Ring[]; // parks, gardens, playgrounds, squares, pedestrian plazas (closed rings)
  waterAreas: Ring[]; // lakes, riverbanks, sea bays
  waterLines: Ring[]; // rivers, canals, coastline (rejected within WATER_BUFFER_M)
}
export type AreaLoader = (lat: number, lng: number) => Promise<AreaData | null>;

const WATER_LINE_BUFFER_M = 12;
/** Range pickSpawnPoints searches when the caller doesn't say. The crate seeder passes its own. */
const DEFAULT_MIN_M = 40;
const DEFAULT_MAX_M = 250;
const LINE_STEP_M = 12;
const AREA_STEP_M = 20;
const MAX_CANDIDATES = 6_000;
const M_PER_DEG_LAT = 111_320;

// ---------- geometry (local equirectangular projection around an origin) ----------

type XY = { x: number; y: number };
const project = (o: LatLng) => {
  const kx = M_PER_DEG_LAT * Math.cos((o.lat * Math.PI) / 180);
  return {
    to: (p: LatLng): XY => ({ x: (p.lng - o.lng) * kx, y: (p.lat - o.lat) * M_PER_DEG_LAT }),
    from: (p: XY): LatLng => ({ lat: o.lat + p.y / M_PER_DEG_LAT, lng: o.lng + p.x / kx }),
  };
};

function inRing(p: XY, ring: XY[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function distToSegment(p: XY, a: XY, b: XY): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Pure: true if the point is inside a water area or within a few metres of a river/coastline. */
export function isWater(area: AreaData, p: LatLng): boolean {
  const pr = project(p);
  const xy = { x: 0, y: 0 };
  for (const ring of area.waterAreas) if (ring.length >= 3 && inRing(xy, ring.map((q) => pr.to(q)))) return true;
  for (const line of area.waterLines) {
    const pts = line.map((q) => pr.to(q));
    for (let i = 1; i < pts.length; i++) if (distToSegment(xy, pts[i - 1]!, pts[i]!) <= WATER_LINE_BUFFER_M) return true;
  }
  return false;
}

/**
 * Pure: up to `count` points on walkable ground, `minM`..`maxM` from `center`, not in water,
 * at least `spacingM` apart. May return fewer (or none) when the surroundings have nothing walkable.
 */
export function pickSpawnPoints(
  area: AreaData,
  center: LatLng,
  count: number,
  rng: Rng,
  opts: { minM?: number; maxM?: number; spacingM?: number } = {},
): LatLng[] {
  const minM = opts.minM ?? DEFAULT_MIN_M;
  const maxM = opts.maxM ?? DEFAULT_MAX_M;
  const spacingM = opts.spacingM ?? 30;
  const pr = project(center);
  const inRange = (p: XY) => {
    const d = Math.hypot(p.x, p.y);
    return d >= minM && d <= maxM;
  };

  let cands: XY[] = [];
  for (const line of area.lines) {
    const pts = line.map((q) => pr.to(q));
    for (let i = 1; i < pts.length && cands.length < MAX_CANDIDATES; i++) {
      const a = pts[i - 1]!, b = pts[i]!;
      const n = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / LINE_STEP_M));
      for (let k = 0; k <= n; k++) {
        const p = { x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n };
        if (inRange(p)) cands.push(p);
      }
    }
  }
  for (const ring of area.areas) {
    if (ring.length < 3 || cands.length >= MAX_CANDIDATES) continue;
    const pts = ring.map((q) => pr.to(q));
    for (let x = -maxM; x <= maxM && cands.length < MAX_CANDIDATES; x += AREA_STEP_M) {
      for (let y = -maxM; y <= maxM; y += AREA_STEP_M) {
        const p = { x, y };
        if (inRange(p) && inRing(p, pts)) cands.push(p);
      }
    }
  }
  cands = cands.filter((c) => !isWater(area, pr.from(c)));

  const out: LatLng[] = [];
  while (out.length < count && cands.length > 0) {
    const pick = cands[rng(0, cands.length)]!;
    out.push(pr.from(pick));
    cands = cands.filter((c) => Math.hypot(c.x - pick.x, c.y - pick.y) >= spacingM);
  }
  return out;
}

// ---------- Overpass loader ----------

type OsmGeom = { lat: number; lon: number }[];
type OsmEl = {
  type: 'way' | 'relation';
  tags?: Record<string, string>;
  geometry?: OsmGeom;
  members?: { type: string; role: string; geometry?: OsmGeom }[];
};

const WALK_HIGHWAYS = new Set(['footway', 'pedestrian', 'path', 'living_street', 'cycleway']);
const PARK_LEISURE = new Set(['park', 'garden', 'playground', 'common']);
const PARK_LANDUSE = new Set(['recreation_ground', 'village_green']);
const toRing = (g: OsmGeom): Ring => g.map((p) => ({ lat: p.lat, lng: p.lon }));
const isClosed = (g: OsmGeom) => g.length >= 4 && g[0]!.lat === g.at(-1)!.lat && g[0]!.lon === g.at(-1)!.lon;

/** Pure: Overpass `out geom` elements -> AreaData. Exported for tests. */
export function parseOverpass(elements: OsmEl[]): AreaData {
  const out: AreaData = { lines: [], areas: [], waterAreas: [], waterLines: [] };
  for (const el of elements) {
    const t = el.tags ?? {};
    const rings: OsmGeom[] =
      el.type === 'way'
        ? el.geometry ? [el.geometry] : []
        : (el.members ?? []).filter((m) => m.type === 'way' && m.role === 'outer' && m.geometry).map((m) => m.geometry!);

    const water = t.natural === 'water' || t.natural === 'bay' || t.waterway === 'riverbank' || t.landuse === 'reservoir';
    if (water) {
      for (const g of rings) if (isClosed(g)) out.waterAreas.push(toRing(g));
      continue;
    }
    if (t.natural === 'coastline' || t.waterway === 'river' || t.waterway === 'canal') {
      for (const g of rings) out.waterLines.push(toRing(g));
      continue;
    }
    if (t.access === 'private' || t.access === 'no' || t.indoor) continue;

    if (t.highway && WALK_HIGHWAYS.has(t.highway)) {
      // Crossings and bridges/tunnels sit on or over roads and water.
      if (t.foot === 'no' || t.footway === 'crossing' || t.footway === 'traffic_island') continue;
      if ((t.bridge && t.bridge !== 'no') || (t.tunnel && t.tunnel !== 'no') || (t.layer && Number(t.layer) !== 0)) continue;
      for (const g of rings) {
        if (t.highway === 'pedestrian' && isClosed(g)) out.areas.push(toRing(g));
        else out.lines.push(toRing(g));
      }
      continue;
    }
    if (PARK_LEISURE.has(t.leisure ?? '') || PARK_LANDUSE.has(t.landuse ?? '') || t.place === 'square') {
      for (const g of rings) if (isClosed(g)) out.areas.push(toRing(g));
    }
  }
  return out;
}

export interface OverpassOptions {
  endpoints: string[];
  fetchImpl?: typeof fetch;
  now?: () => number;
  requestTimeoutMs?: number; // per HTTP attempt
  cacheTtlMs?: number;
  cooldownMs?: number; // after every endpoint failed, skip Overpass entirely for this long
  maxCells?: number;
  minGapMs?: number; // minimum spacing between request starts (rate limit)
  cellM?: number;
}

const bboxQuery = (s: number, w: number, n: number, e: number) => {
  const b = `${s.toFixed(6)},${w.toFixed(6)},${n.toFixed(6)},${e.toFixed(6)}`;
  return `[out:json][timeout:10];(
way["highway"~"^(footway|pedestrian|path|living_street|cycleway)$"]["access"!~"^(private|no)$"]["foot"!="no"](${b});
way["leisure"~"^(park|garden|playground|common)$"]["access"!~"^(private|no)$"](${b});
way["landuse"~"^(recreation_ground|village_green|reservoir)$"](${b});
way["place"="square"](${b});
way["natural"~"^(water|bay|coastline)$"](${b});
way["waterway"~"^(riverbank|river|canal)$"](${b});
relation["leisure"~"^(park|garden|common)$"](${b});
relation["natural"="water"](${b});
);out geom;`;
};

export function createOverpassLoader(opts: OverpassOptions): AreaLoader {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;
  const timeoutMs = opts.requestTimeoutMs ?? 8_000;
  const ttl = opts.cacheTtlMs ?? 6 * 3_600_000;
  const cooldownMs = opts.cooldownMs ?? 60_000;
  const maxCells = opts.maxCells ?? 600;
  const minGap = opts.minGapMs ?? 600;
  const cellM = opts.cellM ?? 400;
  const pad = GAME.citySeedRadiusM + 60;

  const cache = new Map<string, { at: number; data: AreaData }>(); // insertion order = LRU order
  const inflight = new Map<string, Promise<AreaData | null>>();
  let downUntil = 0;
  let nextSlot = 0;

  async function request(query: string): Promise<AreaData | null> {
    for (const url of opts.endpoints) {
      const wait = Math.max(0, nextSlot - now());
      nextSlot = Math.max(nextSlot, now()) + minGap;
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      try {
        const res = await fetchImpl(url, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'lotus-spawner/1.0' },
          body: `data=${encodeURIComponent(query)}`,
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) continue; // 429/504 etc: try the next mirror
        const json = (await res.json()) as { elements?: OsmEl[]; remark?: string };
        if (!Array.isArray(json.elements) || (json.remark && /timed out|out of memory/i.test(json.remark))) continue;
        return parseOverpass(json.elements);
      } catch {
        // timeout / network error: next mirror
      }
    }
    return null;
  }

  return async (lat, lng) => {
    const cosLat = Math.max(0.05, Math.cos((Math.round(lat) * Math.PI) / 180));
    const latStep = cellM / M_PER_DEG_LAT;
    const lngStep = cellM / (M_PER_DEG_LAT * cosLat);
    const cy = Math.floor(lat / latStep), cx = Math.floor(lng / lngStep);
    const key = `${cy}:${cx}`;

    const hit = cache.get(key);
    if (hit && now() - hit.at < ttl) {
      cache.delete(key);
      cache.set(key, hit);
      return hit.data;
    }
    if (now() < downUntil) return null;
    const existing = inflight.get(key);
    if (existing) return existing;

    const dLat = pad / M_PER_DEG_LAT, dLng = pad / (M_PER_DEG_LAT * cosLat);
    const p = request(bboxQuery((cy) * latStep - dLat, cx * lngStep - dLng, (cy + 1) * latStep + dLat, (cx + 1) * lngStep + dLng))
      .then((data) => {
        if (!data) downUntil = now() + cooldownMs;
        else {
          cache.set(key, { at: now(), data });
          while (cache.size > maxCells) cache.delete(cache.keys().next().value!);
        }
        return data;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  };
}

// ---------- module-level wiring used by the spawner ----------

const DEFAULT_ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

function defaultLoader(): AreaLoader | null {
  if (process.env.WALKABLE_SPAWNS === 'off') return null;
  if (process.env.VITEST && process.env.WALKABLE_SPAWNS !== 'on') return null; // keep unit tests off the network
  const endpoints = process.env.OVERPASS_URLS?.split(',').map((s) => s.trim()).filter(Boolean);
  return createOverpassLoader({ endpoints: endpoints?.length ? endpoints : DEFAULT_ENDPOINTS });
}

let loader: AreaLoader | null | undefined;
export function setAreaLoader(l: AreaLoader | null): void {
  loader = l;
}

/** Longest the spawner will wait for Overpass before using the fallback nudge. */
const LOAD_BUDGET_MS = 3_000;

/** Area data around the player, or null when unavailable (disabled, slow, down). Never throws. */
export async function loadAreaFor(lat: number, lng: number): Promise<AreaData | null> {
  if (loader === undefined) loader = defaultLoader();
  if (!loader) return null;
  try {
    return await Promise.race([
      loader(lat, lng),
      new Promise<null>((r) => setTimeout(() => r(null), LOAD_BUDGET_MS).unref?.()),
    ]);
  } catch {
    return null;
  }
}
