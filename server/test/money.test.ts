import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { openCrate } from '../src/openCrate';
import { claimNextPrizeSend, markPrizeFailed, markPrizeSent, recordSubmittedSignature } from '../src/prizeQueue';
import { freezePlayer, unfreezePlayer } from '../src/admin';
import { spawnCratesNear } from '../src/crates';
import { useTicket } from '../src/tickets';
import { addCards, allow, crateAt, forcedRng, LAT, LNG, newPlayer, pool, reset, ROLL_COMMON, ROLL_SHARDS } from './helpers';

const req = (crateId: string, p: { playerId: string; address: string }, lat = LAT, lng = LNG) => ({
  crateId,
  lat,
  lng,
  accuracyM: 5,
  clientTs: Date.now(),
  deviceId: 'dev-1',
  playerId: p.playerId,
  walletAddress: p.address,
  ip: '127.0.0.1',
});

beforeEach(reset);
afterAll(() => pool.end());

describe('inventory reservation', () => {
  it('never awards more cards than the vault holds under concurrent opens', async () => {
    await addCards(3);
    const players = await Promise.all(Array.from({ length: 20 }, newPlayer));
    const crates = await Promise.all(players.map((p) => crateAt(p.playerId)));
    const results = await Promise.all(
      players.map((p, i) => openCrate(req(crates[i]!, p), { validateOpen: allow, db: pool, rng: forcedRng(ROLL_COMMON) })),
    );

    const cards = results.filter((r) => r.ok && r.outcome === 'card');
    const shards = results.filter((r) => r.ok && r.outcome === 'shards');
    expect(cards).toHaveLength(3);
    expect(shards).toHaveLength(17);

    const items = await pool.query(`SELECT status, reserved_by_opening_id FROM inventory_items`);
    expect(items.rows.every((r) => r.status === 'reserved')).toBe(true);
    expect(new Set(items.rows.map((r) => r.reserved_by_opening_id)).size).toBe(3);
    const sends = await pool.query(`SELECT count(*)::int AS n FROM prize_sends`);
    expect(sends.rows[0].n).toBe(3);
  });

  it('downgrades to shards when the rolled tier is empty', async () => {
    const p = await newPlayer();
    const r = await openCrate(req(await crateAt(p.playerId), p), { validateOpen: allow, db: pool, rng: forcedRng(ROLL_COMMON) });
    expect(r).toMatchObject({ ok: true, outcome: 'shards', shardsAwarded: 1 });
    const sends = await pool.query(`SELECT count(*)::int AS n FROM prize_sends`);
    expect(sends.rows[0].n).toBe(0);
  });

  it('opens a crate once even when the same request races itself, and replays the result', async () => {
    await addCards(5);
    const p = await newPlayer();
    const crate = await crateAt(p.playerId);
    const deps = { validateOpen: allow, db: pool, rng: forcedRng(ROLL_COMMON) };
    const [a, b] = await Promise.all([openCrate(req(crate, p), deps), openCrate(req(crate, p), deps)]);
    expect(a.ok && b.ok).toBe(true);
    expect([a, b].filter((r) => r.ok && r.replayed)).toHaveLength(1);
    const reserved = await pool.query(`SELECT count(*)::int AS n FROM inventory_items WHERE status = 'reserved'`);
    expect(reserved.rows[0].n).toBe(1);
  });
});

describe('open validation', () => {
  it('rejects opens beyond 40 m and other players crates', async () => {
    const p = await newPlayer();
    const other = await newPlayer();
    const crate = await crateAt(p.playerId);
    const far = await openCrate(req(crate, p, LAT + 0.001), { validateOpen: allow, db: pool }); // ~111 m
    expect(far).toMatchObject({ ok: false, code: 'too_far' });
    const notMine = await openCrate(req(crate, other), { validateOpen: allow, db: pool });
    expect(notMine).toMatchObject({ ok: false, code: 'not_yours' });
  });

  it('records the anti-cheat flag and awards nothing on rejection', async () => {
    await addCards(1);
    const p = await newPlayer();
    const crate = await crateAt(p.playerId);
    const r = await openCrate(req(crate, p), {
      db: pool,
      validateOpen: async () => ({ ok: false, reason: 'teleport', flag: { reason: 'speed 900 km/h' } }),
    });
    expect(r).toMatchObject({ ok: false, code: 'anticheat' });
    const flags = await pool.query(`SELECT reason FROM player_flags WHERE player_id = $1`, [p.playerId]);
    expect(flags.rows[0].reason).toBe('speed 900 km/h');
    const c = await pool.query(`SELECT status FROM crates WHERE id = $1`, [crate]);
    expect(c.rows[0].status).toBe('active');
  });

  it('fails closed when the anti-cheat hook throws', async () => {
    await addCards(1);
    const p = await newPlayer();
    const crate = await crateAt(p.playerId);
    await expect(
      openCrate(req(crate, p), { db: pool, validateOpen: async () => { throw new Error('redis down'); } }),
    ).rejects.toThrow('redis down');
    const o = await pool.query(`SELECT count(*)::int AS n FROM crate_openings`);
    expect(o.rows[0].n).toBe(0);
  });
});

describe('shards and tickets', () => {
  it('converts 10 shards into a ticket and caps tickets at 5', async () => {
    const p = await newPlayer();
    await pool.query(`UPDATE players SET shards = 9, tickets = 4 WHERE id = $1`, [p.playerId]);
    const r1 = await openCrate(req(await crateAt(p.playerId), p), { validateOpen: allow, db: pool, rng: forcedRng(ROLL_SHARDS) });
    expect(r1).toMatchObject({ outcome: 'shards', shardsAwarded: 1, ticketsAwarded: 1, shards: 0, tickets: 5 });

    await pool.query(`UPDATE players SET shards = 12 WHERE id = $1`, [p.playerId]);
    const r2 = await openCrate(req(await crateAt(p.playerId), p), { validateOpen: allow, db: pool, rng: forcedRng(ROLL_SHARDS) });
    expect(r2).toMatchObject({ ticketsAwarded: 0, shards: 13, tickets: 5 });

    const t = await useTicket({ playerId: p.playerId, lat: LAT, lng: LNG }, pool);
    expect(t).toMatchObject({ ok: true, tickets: 5 }); // spent one, 10 banked shards refilled it
    const bal = await pool.query(`SELECT shards FROM players WHERE id = $1`, [p.playerId]);
    expect(bal.rows[0].shards).toBe(3);
  });
});

describe('prize send queue', () => {
  async function winOne() {
    await addCards(1);
    const p = await newPlayer();
    await openCrate(req(await crateAt(p.playerId), p), { validateOpen: allow, db: pool, rng: forcedRng(ROLL_COMMON) });
    return p;
  }

  it('claims once, records signature, and marks everything sent idempotently', async () => {
    const p = await winOne();
    const job = await claimNextPrizeSend({}, pool);
    expect(job).toMatchObject({ recipientAddress: p.address, attempts: 1, txSignature: null });
    expect(await claimNextPrizeSend({}, pool)).toBeNull(); // locked

    await recordSubmittedSignature(job!.id, 'sig1', pool);
    await markPrizeSent(job!.id, 'sig1', pool);
    await markPrizeSent(job!.id, 'sig1', pool);
    const row = await pool.query(
      `SELECT ps.status, o.status AS o_status, o.tx_signature, i.status AS i_status
         FROM prize_sends ps JOIN crate_openings o ON o.id = ps.opening_id JOIN inventory_items i ON i.id = ps.inventory_item_id`,
    );
    expect(row.rows[0]).toMatchObject({ status: 'sent', o_status: 'sent', tx_signature: 'sig1', i_status: 'sent' });
    expect(await claimNextPrizeSend({}, pool)).toBeNull();
  });

  it('re-offers a job with its signature after a crash, and goes to failed after max attempts', async () => {
    await winOne();
    const job = await claimNextPrizeSend({ lockMs: 1 }, pool);
    await recordSubmittedSignature(job!.id, 'sigA', pool);
    await new Promise((r) => setTimeout(r, 20));
    const again = await claimNextPrizeSend({}, pool);
    expect(again).toMatchObject({ id: job!.id, txSignature: 'sigA', attempts: 2 });

    await markPrizeFailed(again!.id, 'rpc timeout', { maxAttempts: 2 }, pool);
    const r = await pool.query(`SELECT ps.status, o.status AS o_status, i.status AS i_status FROM prize_sends ps
      JOIN crate_openings o ON o.id = ps.opening_id JOIN inventory_items i ON i.id = ps.inventory_item_id`);
    expect(r.rows[0]).toMatchObject({ status: 'failed', o_status: 'failed', i_status: 'reserved' });
  });

  it('a transient failure after submit leaves the job reclaimable at once with its signature', async () => {
    await winOne();
    const job = await claimNextPrizeSend({}, pool);
    await recordSubmittedSignature(job!.id, 'sigB', pool);
    await markPrizeFailed(job!.id, 'blockhash expired', {}, pool);
    const again = await claimNextPrizeSend({}, pool);
    expect(again).toMatchObject({ id: job!.id, txSignature: 'sigB', attempts: 2 });
  });

  it('withholds a frozen players prizes and releases them on unfreeze', async () => {
    const p = await winOne();
    await freezePlayer(p.playerId, 'review', pool);
    expect(await claimNextPrizeSend({}, pool)).toBeNull();
    await unfreezePlayer(p.playerId, pool);
    expect(await claimNextPrizeSend({}, pool)).not.toBeNull();
  });
});

describe('spawner', () => {
  it('puts the first crate on the player and caps active crates at 3', async () => {
    const p = await newPlayer();
    const crates = await spawnCratesNear({ playerId: p.playerId, lat: LAT, lng: LNG }, pool);
    expect(crates).toHaveLength(3);
    expect(crates[0]!.lat).toBeCloseTo(LAT, 6);
    expect(crates[0]!.lng).toBeCloseTo(LNG, 6);
    const again = await spawnCratesNear({ playerId: p.playerId, lat: LAT, lng: LNG }, pool);
    expect(again.map((c) => c.id)).toEqual(crates.map((c) => c.id));
    const d = await pool.query(
      `SELECT max(ST_Distance(location, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography)) AS m FROM crates`,
      [LAT, LNG],
    );
    expect(Number(d.rows[0].m)).toBeLessThanOrEqual(251);
  });
});
