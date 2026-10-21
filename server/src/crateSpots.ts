import type { LatLngBox, ServiceCity } from './cities';

/**
 * Where crates can go. A fixed, deterministic grid of spots inside each launch city's core, worked
 * out from the city's own definition with no network and no data file: nothing here can be down.
 *
 * This replaced a live OpenStreetMap lookup for walkable ground. Crates are allowed to sit anywhere
 * inside a major city, and a lookup that could fail under load made "are there crates today" depend
 * on a third party's uptime. The cost is that a spot can occasionally land somewhere you can't
 * stand, a river or a rooftop. That is accepted: such a crate is simply never opened, expires after
 * `crateTtlMs`, and the seeder puts a fresh one somewhere else.
 *
 * Water is kept out the cheap way: each core is chosen to sit on land, and the few that touch a
 * harbour, bay or lake have a hand-drawn `avoid` box. Narrow rivers are not excluded.
 */

const M_PER_DEG_LAT = 111_320;
/** Distance between neighbouring spots. Closer than the crate spacing guard, so there is always choice. */
const SPOT_SPACING_M = 200;
const DEFAULT_CORE_KM = 4;

export interface Spot { lat: number; lng: number }

const inBox = (p: Spot, b: LatLngBox) =>
  p.lat >= b.minLat && p.lat <= b.maxLat && p.lng >= b.minLng && p.lng <= b.maxLng;

const cache = new Map<string, readonly Spot[]>();

/** Every crate spot for a city, in a fixed order. Computed once per process. */
export function spotsFor(city: ServiceCity): readonly Spot[] {
  const core = city.core ?? { lat: city.lat, lng: city.lng, radiusKm: Math.min(city.radiusKm, DEFAULT_CORE_KM) };
  const key = `${city.name}|${core.lat}|${core.lng}|${core.radiusKm}|${core.avoid?.length ?? 0}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const radiusM = core.radiusKm * 1_000;
  const dLat = SPOT_SPACING_M / M_PER_DEG_LAT;
  const dLng = SPOT_SPACING_M / (M_PER_DEG_LAT * Math.cos((core.lat * Math.PI) / 180));
  const steps = Math.floor(radiusM / SPOT_SPACING_M);
  const out: Spot[] = [];
  for (let iy = -steps; iy <= steps; iy++) {
    for (let ix = -steps; ix <= steps; ix++) {
      // Every other row is shifted half a step, so the grid reads as a scatter rather than a
      // chessboard. The radius test uses the shifted position, or edge spots poke past the core.
      const x = ix + (iy % 2 === 0 ? 0 : 0.5);
      if (Math.hypot(x, iy) * SPOT_SPACING_M > radiusM) continue;
      const p: Spot = { lat: core.lat + iy * dLat, lng: core.lng + x * dLng };
      if (core.avoid?.some((b) => inBox(p, b))) continue;
      out.push(p);
    }
  }
  cache.set(key, out);
  return out;
}
