import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pruneLocationPings, recordLocationPing } from '../src/players';
import { LAT, LNG, newPlayer, pool, reset } from './helpers';

describe('pruneLocationPings', () => {
  beforeEach(reset);
  afterAll(() => pool.end());

  it('deletes only pings older than the retention window, across batches', async () => {
    const { playerId } = await newPlayer();
    for (let i = 0; i < 7; i++) {
      await recordLocationPing({ playerId, lat: LAT, lng: LNG, accuracyM: 10, clientTs: Date.now(), deviceId: 'dev-1' }, pool);
    }
    // Oldest 5 are 40 days old, newest 2 are fresh.
    await pool.query(`UPDATE location_pings SET recorded_at = now() - interval '40 days'
                       WHERE id IN (SELECT id FROM location_pings ORDER BY id LIMIT 5)`);

    expect(await pruneLocationPings({ retentionDays: 30, batchSize: 2 }, pool)).toBe(5);
    const { rows } = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM location_pings');
    expect(rows[0]!.n).toBe(2);
    expect(await pruneLocationPings({ retentionDays: 30, batchSize: 2 }, pool)).toBe(0);
  });
});
