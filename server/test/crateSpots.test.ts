import { describe, expect, it } from 'vitest';
import { SERVICE_CITIES } from '../src/cities';
import { spotsFor } from '../src/crateSpots';
import { GAME } from '../src/config';

const distKm = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const rad = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lng - a.lng) * rad) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
};

describe('crate spots', () => {
  it.each(SERVICE_CITIES.map((c) => [c.name, c] as const))('%s has plenty of spots, all inside its service area', (_name, city) => {
    const spots = spotsFor(city);
    // Far more candidates than the 60 crates a city holds, even after water is cut out of the core.
    expect(spots.length).toBeGreaterThan(GAME.cratesPerCity * 4);
    for (const s of spots) expect(distKm(s, city)).toBeLessThanOrEqual(city.radiusKm);
  });

  it.each(SERVICE_CITIES.map((c) => [c.name, c] as const))('%s keeps spots out of its avoid boxes and inside its core', (_name, city) => {
    const core = city.core ?? { lat: city.lat, lng: city.lng, radiusKm: Math.min(city.radiusKm, 4) };
    for (const s of spotsFor(city)) {
      expect(distKm(s, core)).toBeLessThanOrEqual(core.radiusKm + 0.01);
      for (const b of core.avoid ?? []) {
        const inside = s.lat >= b.minLat && s.lat <= b.maxLat && s.lng >= b.minLng && s.lng <= b.maxLng;
        expect(inside).toBe(false);
      }
    }
  });

  it('is deterministic, so every worker agrees on the same grid', () => {
    const [first] = SERVICE_CITIES;
    expect(spotsFor(first!)).toEqual(spotsFor(first!));
    expect(spotsFor(first!).length).toBe(spotsFor(first!).length);
  });

  it('leaves room for a full set of crates at the minimum spacing', () => {
    for (const city of SERVICE_CITIES) {
      // Greedy fill by the same rule the INSERT enforces. If a core can't hold the target, the map
      // would sit short of 60 crates for a reason no amount of re-seeding can fix.
      const placed: { lat: number; lng: number }[] = [];
      for (const s of spotsFor(city)) {
        if (placed.every((p) => distKm(p, s) * 1_000 >= GAME.crateMinSpacingM)) placed.push(s);
        if (placed.length >= GAME.cratesPerCity) break;
      }
      expect(placed.length, city.name).toBe(GAME.cratesPerCity);
    }
  });
});
