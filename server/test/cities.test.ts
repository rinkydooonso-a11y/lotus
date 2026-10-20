import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { cityFor } from '../src/cities';
import { spawnCratesNear } from '../src/crates';

describe('cityFor', () => {
  it('finds a launch city and rejects places outside every service area', () => {
    expect(cityFor(40.7128, -74.006)?.name).toBe('New York');
    expect(cityFor(51.52, -0.12)?.name).toBe('London');
    expect(cityFor(40.0821, -74.2097)).toBeNull(); // Lakewood NJ, ~90 km from New York
    expect(cityFor(0, 0)).toBeNull();
  });
});

describe('spawnCratesNear city gate', () => {
  afterEach(() => vi.unstubAllEnvs());
  // Outside the gate it returns before touching the pool, so a dummy pool proves no DB work happens.
  const noDb = {} as unknown as Pool;
  const player = '00000000-0000-0000-0000-000000000000';

  it('spawns nothing outside launch cities', async () => {
    vi.stubEnv('LOTUS_CITY_GATE', 'on');
    expect(await spawnCratesNear({ playerId: player, lat: 53.3498, lng: -6.2603 }, noDb)).toEqual([]);
  });

  it('is skipped for admins (anywhere) so the pool is reached', async () => {
    vi.stubEnv('LOTUS_CITY_GATE', 'on');
    await expect(spawnCratesNear({ playerId: player, lat: 53.3498, lng: -6.2603, anywhere: true }, noDb)).rejects.toThrow();
  });
});
