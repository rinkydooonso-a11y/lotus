import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { GAME } from '../src/config';
import { nearbyCrates, welcomeCrate } from '../src/crates';
import { openCrate } from '../src/openCrate';
import { addCards, allow, crateAt, forcedRng, LAT, LNG, newPlayer, pool, reset, ROLL_COMMON, ROLL_SHARDS } from './helpers';

const req = (crateId: string, p: { playerId: string; address: string }, lat = LAT, lng = LNG) => ({
  crateId, lat, lng, accuracyM: 5, clientTs: Date.now(), deviceId: 'dev-1', playerId: p.playerId, walletAddress: p.address, ip: '127.0.0.1',
});
const deps = (rng: number) => ({ validateOpen: allow, db: pool, rng: forcedRng(rng) });

const distanceM = async (lat: number, lng: number) =>
  Number((await pool.query(`SELECT ST_Distance(ST_SetSRID(ST_MakePoint($2,$1),4326)::geography, ST_SetSRID(ST_MakePoint($4,$3),4326)::geography) AS d`, [LAT, LNG, lat, lng])).rows[0].d);

beforeEach(reset);
afterAll(() => pool.end());

describe('welcome crate', () => {
  it('appears right next to the player, once, and is not a world crate', async () => {
    const p = await newPlayer();
    const c = (await welcomeCrate({ playerId: p.playerId, lat: LAT, lng: LNG }, pool))!;
    expect(c.welcome).toBe(true);
    expect(c.city).toBeUndefined();
    expect(await distanceM(c.lat, c.lng)).toBeLessThanOrEqual(31);
    expect(await distanceM(c.lat, c.lng)).toBeGreaterThanOrEqual(14);

    // Pinging again returns the same crate, not a second one.
    const again = await welcomeCrate({ playerId: p.playerId, lat: LAT + 0.0001, lng: LNG }, pool);
    expect(again?.id).toBe(c.id);
    expect((await pool.query(`SELECT count(*)::int AS n FROM crates WHERE welcome`)).rows[0].n).toBe(1);

    // Nobody else sees it on the map.
    expect(await nearbyCrates({ lat: LAT, lng: LNG }, pool)).toEqual([]);
  });

  it('always pays shards, whatever the roll, and costs no open or ticket', async () => {
    await addCards(5);
    const p = await newPlayer();
    const c = (await welcomeCrate({ playerId: p.playerId, lat: LAT, lng: LNG }, pool))!;
    const r = await openCrate(req(c.id, p, c.lat, c.lng), deps(ROLL_COMMON));
    expect(r).toMatchObject({ ok: true, outcome: 'shards', ticketSpent: false });
    expect((await pool.query(`SELECT count(*)::int AS n FROM inventory_items WHERE status <> 'available'`)).rows[0].n).toBe(0);
    expect((await pool.query(`SELECT count(*)::int AS n FROM player_open_days`)).rows[0].n).toBe(0);
    expect((await pool.query(`SELECT result, roll_kind FROM crate_openings`)).rows[0]).toMatchObject({ result: 'shards', roll_kind: 'standard' });
    expect((await pool.query(`SELECT shards FROM players WHERE id = $1`, [p.playerId])).rows[0].shards).toBeGreaterThan(0);

    // All ten free opens are still there.
    for (let i = 0; i < GAME.freeOpensPerDay; i++) {
      const w = await openCrate(req(await crateAt(), p), deps(ROLL_SHARDS));
      expect(w.ok).toBe(true);
    }
  });

  it('is never offered again once opened', async () => {
    const p = await newPlayer();
    const c = (await welcomeCrate({ playerId: p.playerId, lat: LAT, lng: LNG }, pool))!;
    await openCrate(req(c.id, p, c.lat, c.lng), deps(ROLL_SHARDS));
    expect(await welcomeCrate({ playerId: p.playerId, lat: LAT, lng: LNG }, pool)).toBeNull();
    expect((await pool.query(`SELECT count(*)::int AS n FROM crates WHERE welcome`)).rows[0].n).toBe(1);
    // Even elsewhere, even after a restart-style repeat call.
    expect(await welcomeCrate({ playerId: p.playerId, lat: LAT + 1, lng: LNG }, pool)).toBeNull();
  });

  it('can only be opened by its owner', async () => {
    const owner = await newPlayer();
    const other = await newPlayer();
    const c = (await welcomeCrate({ playerId: owner.playerId, lat: LAT, lng: LNG }, pool))!;
    const r = await openCrate(req(c.id, other, c.lat, c.lng), deps(ROLL_SHARDS));
    expect(r).toMatchObject({ ok: false, code: 'not_found' });
    expect((await pool.query(`SELECT status FROM crates WHERE id = $1`, [c.id])).rows[0].status).toBe('active');
  });

  it('follows the player if they are far from it and it is still unopened', async () => {
    const p = await newPlayer();
    const first = (await welcomeCrate({ playerId: p.playerId, lat: LAT, lng: LNG }, pool))!;
    const moved = (await welcomeCrate({ playerId: p.playerId, lat: LAT + 0.5, lng: LNG }, pool))!;
    expect(moved.id).toBe(first.id);
    expect(moved.lat).toBeGreaterThan(LAT + 0.49);
  });

  it('still needs the player to be close', async () => {
    const p = await newPlayer();
    const c = (await welcomeCrate({ playerId: p.playerId, lat: LAT, lng: LNG }, pool))!;
    const r = await openCrate(req(c.id, p, LAT + 0.01, LNG), deps(ROLL_SHARDS));
    expect(r).toMatchObject({ ok: false, code: 'too_far' });
  });
});
