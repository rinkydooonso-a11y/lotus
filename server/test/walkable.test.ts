import { describe, expect, it, vi } from 'vitest';
import { secureRng } from '../src/rng';
import { createOverpassLoader, isWater, parseOverpass, pickSpawnPoints, type AreaData } from '../src/walkable';

const C = { lat: 53.35, lng: -6.26 };
const mLat = (m: number) => m / 111_320;
const mLng = (m: number) => m / (111_320 * Math.cos((C.lat * Math.PI) / 180));
const sq = (x0: number, y0: number, x1: number, y1: number) =>
  [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]].map(([x, y]) => ({ lat: C.lat + mLat(y!), lng: C.lng + mLng(x!) }));
const distM = (p: { lat: number; lng: number }) => Math.hypot((p.lat - C.lat) * 111_320, (p.lng - C.lng) * 111_320 * Math.cos((C.lat * Math.PI) / 180));
const empty: AreaData = { lines: [], areas: [], waterAreas: [], waterLines: [] };

describe('pickSpawnPoints', () => {
  it('stays on footpaths and parks, in range, never in a lake', () => {
    const lake = sq(100, -300, 300, 300); // east of centre
    const area: AreaData = {
      ...empty,
      lines: [[{ lat: C.lat + mLat(100), lng: C.lng - mLng(300) }, { lat: C.lat + mLat(100), lng: C.lng + mLng(300) }]], // crosses the lake
      areas: [sq(-200, -200, -60, -60)],
      waterAreas: [lake],
    };
    for (let run = 0; run < 20; run++) {
      const pts = pickSpawnPoints(area, C, 2, secureRng);
      expect(pts).toHaveLength(2);
      for (const p of pts) {
        expect(isWater(area, p)).toBe(false);
        expect(distM(p)).toBeGreaterThanOrEqual(39);
        expect(distM(p)).toBeLessThanOrEqual(251);
      }
    }
  });

  it('returns nothing when there is no walkable ground nearby', () => {
    expect(pickSpawnPoints(empty, C, 3, secureRng)).toEqual([]);
  });

  it('keeps picked points apart', () => {
    const area: AreaData = { ...empty, areas: [sq(-240, -240, 240, 240)] };
    const [a, b, c] = pickSpawnPoints(area, C, 3, secureRng);
    for (const [p, q] of [[a, b], [b, c], [a, c]] as const) {
      expect(Math.hypot((p!.lat - q!.lat) * 111_320, (p!.lng - q!.lng) * 70_000)).toBeGreaterThan(25);
    }
  });
});

describe('parseOverpass', () => {
  const g = (r: { lat: number; lng: number }[]) => r.map((p) => ({ lat: p.lat, lon: p.lng }));
  it('keeps sidewalks and parks, drops crossings, bridges, private and motorway ways', () => {
    const line = g([{ lat: 1, lng: 1 }, { lat: 1, lng: 2 }]);
    const park = g(sq(0, 0, 10, 10));
    const a = parseOverpass([
      { type: 'way', tags: { highway: 'footway', footway: 'sidewalk' }, geometry: line },
      { type: 'way', tags: { highway: 'footway', footway: 'crossing' }, geometry: line },
      { type: 'way', tags: { highway: 'footway', bridge: 'yes' }, geometry: line },
      { type: 'way', tags: { highway: 'footway', access: 'private' }, geometry: line },
      { type: 'way', tags: { highway: 'motorway' }, geometry: line },
      { type: 'way', tags: { leisure: 'park' }, geometry: park },
      { type: 'way', tags: { leisure: 'park', access: 'private' }, geometry: park },
      { type: 'way', tags: { natural: 'water' }, geometry: park },
      { type: 'way', tags: { waterway: 'river' }, geometry: line },
      { type: 'relation', tags: { leisure: 'park' }, members: [{ type: 'way', role: 'outer', geometry: park }, { type: 'way', role: 'inner', geometry: park }] },
    ]);
    expect(a.lines).toHaveLength(1);
    expect(a.areas).toHaveLength(2);
    expect(a.waterAreas).toHaveLength(1);
    expect(a.waterLines).toHaveLength(1);
  });
});

describe('overpass loader', () => {
  const ok = () => new Response(JSON.stringify({ elements: [{ type: 'way', tags: { highway: 'footway' }, geometry: [{ lat: 1, lon: 1 }, { lat: 1, lon: 2 }] }] }));
  const opts = { endpoints: ['http://a', 'http://b'], minGapMs: 0 };

  it('caches by grid cell so repeat pings do not hit Overpass', async () => {
    const f = vi.fn(async () => ok());
    const load = createOverpassLoader({ ...opts, fetchImpl: f as never });
    expect((await load(C.lat, C.lng))?.lines).toHaveLength(1);
    await load(C.lat + 0.0001, C.lng);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('tries the mirror when the first endpoint fails', async () => {
    const f = vi.fn(async (u: string) => (u === 'http://a' ? new Response('busy', { status: 429 }) : ok()));
    const load = createOverpassLoader({ ...opts, fetchImpl: f as never });
    expect(await load(C.lat, C.lng)).not.toBeNull();
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('returns null when Overpass is down and then stops calling it during the cooldown', async () => {
    let t = 0;
    const f = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
    const load = createOverpassLoader({ ...opts, fetchImpl: f as never, now: () => t, cooldownMs: 60_000 });
    expect(await load(C.lat, C.lng)).toBeNull();
    const calls = f.mock.calls.length;
    expect(await load(C.lat + 1, C.lng)).toBeNull();
    expect(f).toHaveBeenCalledTimes(calls);
    t = 61_000;
    await load(C.lat + 1, C.lng);
    expect(f.mock.calls.length).toBeGreaterThan(calls);
  });
});
