import { describe, expect, it } from 'vitest';
import { cityFor, SERVICE_CITIES } from '../src/cities';

describe('cityFor', () => {
  it('finds a launch city and rejects places outside every service area', () => {
    expect(cityFor(40.7128, -74.006)?.name).toBe('New York');
    expect(cityFor(51.52, -0.12)?.name).toBe('London');
    expect(cityFor(40.0821, -74.2097)).toBeNull(); // Lakewood NJ, ~90 km from New York
    expect(cityFor(0, 0)).toBeNull();
  });

  it('is the only place world crates are seeded, so every city needs a sane radius', () => {
    expect(SERVICE_CITIES.length).toBeGreaterThan(0);
    for (const c of SERVICE_CITIES) {
      expect(c.radiusKm).toBeGreaterThan(1);
      expect(c.radiusKm).toBeLessThanOrEqual(60);
      expect(cityFor(c.lat, c.lng)?.name).toBe(c.name);
    }
  });
});
