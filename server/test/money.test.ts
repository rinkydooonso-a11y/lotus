import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { GAME } from '../src/config';
import { openCrate } from '../src/openCrate';
import { claimNextPrizeSend, markPrizeFailed, markPrizeSent, recordSubmittedSignature } from '../src/prizeQueue';
import { freezePlayer, unfreezePlayer } from '../src/admin';
import { nearbyCrates, seedWorldCrates } from '../src/crates';
import { loadOdds } from '../src/odds';
import { ROLL_TIERS, type CrateKind } from '../src/types';
import { getAllowance } from '../src/tickets';
import {
  addCards, allow, crateAt, forcedRng, giveTickets, LAT, LNG, newPlayer,
  pool, reset, ROLL_COMMON, ROLL_SHARDS, ROLL_TICKET_COMMON, TEST_CITY,
} from './helpers';

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

const deps = (rng?: number) => ({
  validateOpen: allow,
  db: pool,
  ...(rng === undefined ? {} : { rng: forcedRng(rng) }),
});

/**
 * Burns the day's free opens so the next open has to spend a ticket. Each one pays
 * shardsPerEmptyMin (forcedRng returns min), which stays well under a ticket's worth.
 */
const useAllFreeOpens = async (p: { playerId: string; address: string }) => {
  for (let i = 0; i < GAME.freeOpensPerDay; i++) await openCrate(req(await crateAt(), p), deps(ROLL_SHARDS));
};

beforeEach(reset);
afterAll(() => pool.end());

describe('shared crates', () => {
  it('gives one crate to exactly one player and tells the rest it was taken', async () => {
    await addCards(5);
    const players = await Promise.all(Array.from({ length: 8 }, newPlayer));
    const crate = await crateAt();

    const results = await Promise.all(players.map((p) => openCrate(req(crate, p), deps(ROLL_COMMON))));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.code === 'taken')).toHaveLength(7);

    const openings = await pool.query(`SELECT player_id FROM crate_openings`);
    expect(openings.rows).toHaveLength(1);
    const c = await pool.query(`SELECT status, claimed_by_player_id FROM crates WHERE id = $1`, [crate]);
    expect(c.rows[0]).toMatchObject({ status: 'opened', claimed_by_player_id: openings.rows[0].player_id });

    // Losing the race costs the other seven nothing: they still have their open for the day.
    const days = await pool.query(`SELECT count(*)::int AS n FROM player_open_days`);
    expect(days.rows[0].n).toBe(1);
  });

  it('gives the anti-cheat cooldown back to the player who lost the race', async () => {
    const players = await Promise.all(Array.from({ length: 2 }, newPlayer));
    const crate = await crateAt();
    let released = 0;
    const validateOpen = async () => ({ ok: true as const, release: async () => void released++ });

    const results = await Promise.all(
      players.map((p) => openCrate(req(crate, p), { validateOpen, db: pool, rng: forcedRng(ROLL_SHARDS) })),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(released).toBe(1);
  });

  it('replays the same result when one player retries their own open', async () => {
    await addCards(5);
    const p = await newPlayer();
    const crate = await crateAt();
    const [a, b] = await Promise.all([openCrate(req(crate, p), deps(ROLL_COMMON)), openCrate(req(crate, p), deps(ROLL_COMMON))]);
    expect(a.ok && b.ok).toBe(true);
    expect([a, b].filter((r) => r.ok && r.replayed)).toHaveLength(1);
    const reserved = await pool.query(`SELECT count(*)::int AS n FROM inventory_items WHERE status = 'reserved'`);
    expect(reserved.rows[0].n).toBe(1);
  });

  it('returns crates within the radius and nothing beyond it', async () => {
    const near = await crateAt(LAT, LNG);
    await crateAt(LAT + 0.05, LNG); // ~5.5 km away
    const list = await nearbyCrates({ lat: LAT, lng: LNG, radiusM: 1_000 }, pool);
    expect(list.map((c) => c.id)).toEqual([near]);
    expect(list[0]).toMatchObject({ city: TEST_CITY.name, kind: 'standard' });
  });
});

describe('the daily open allowance', () => {
  it('allows every free open of the day and refuses the next one with no ticket', async () => {
    const p = await newPlayer();
    for (let i = 0; i < GAME.freeOpensPerDay; i++) {
      expect(await openCrate(req(await crateAt(), p), deps(ROLL_SHARDS))).toMatchObject({ ok: true, ticketSpent: false });
    }

    const spare = await crateAt();
    expect(await openCrate(req(spare, p), deps(ROLL_SHARDS))).toMatchObject({ ok: false, code: 'daily_limit' });

    expect((await pool.query(`SELECT count(*)::int AS n FROM crate_openings`)).rows[0].n).toBe(GAME.freeOpensPerDay);
    const day = await pool.query(`SELECT opens_used, free_used, tickets_used FROM player_open_days`);
    expect(day.rows[0]).toMatchObject({
      opens_used: GAME.freeOpensPerDay,
      free_used: GAME.freeOpensPerDay,
      tickets_used: 0,
    });
    // The refused open leaves the crate on the map for somebody else.
    expect((await pool.query(`SELECT status FROM crates WHERE id = $1`, [spare])).rows[0].status).toBe('active');
  });

  it('spends a ticket for a further open and rolls it on the ticket odds', async () => {
    await addCards(1);
    const p = await newPlayer();
    await giveTickets(p.playerId, 1);
    await useAllFreeOpens(p);

    // ROLL_TICKET_COMMON is a common on the ticket odds but shards on the standard ones, so a card
    // here is proof that the ticket table was used.
    const extra = await openCrate(req(await crateAt(), p), deps(ROLL_TICKET_COMMON));
    expect(extra).toMatchObject({ ok: true, outcome: 'card', ticketSpent: true });

    const o = await pool.query(`SELECT roll_kind, ticket_spent FROM crate_openings WHERE roll_kind = 'ticket'`);
    expect(o.rows).toHaveLength(1);
    expect(o.rows[0]).toMatchObject({ ticket_spent: true });
    expect((await pool.query(`SELECT tickets FROM players WHERE id = $1`, [p.playerId])).rows[0].tickets).toBe(0);
    expect((await pool.query(`SELECT count(*)::int AS n FROM ticket_spends`)).rows[0].n).toBe(1);
  });

  it('converts banked shards into a ticket, caps tickets at the maximum, and reports the allowance', async () => {
    const p = await newPlayer();
    await pool.query(`UPDATE players SET shards = $2, tickets = $3 WHERE id = $1`, [
      p.playerId, GAME.shardsPerTicket - 1, GAME.maxTickets - 1,
    ]);

    const r1 = await openCrate(req(await crateAt(), p), deps(ROLL_SHARDS));
    expect(r1).toMatchObject({ outcome: 'shards', shardsAwarded: 1, ticketsAwarded: 1, shards: 0, tickets: GAME.maxTickets });

    // Spending a ticket frees room under the cap, so banked shards convert on the way through.
    for (let i = 1; i < GAME.freeOpensPerDay; i++) await openCrate(req(await crateAt(), p), deps(ROLL_SHARDS));
    await pool.query(`UPDATE players SET shards = $2 WHERE id = $1`, [p.playerId, GAME.shardsPerTicket + 3]);
    const r2 = await openCrate(req(await crateAt(), p), deps(ROLL_SHARDS));
    expect(r2).toMatchObject({ outcome: 'shards', ticketSpent: true, ticketsAwarded: 1, shards: 4, tickets: GAME.maxTickets });

    expect(await getAllowance(p.playerId, pool)).toMatchObject({
      freeOpensLeft: 0,
      tickets: GAME.maxTickets,
      opensUsedToday: GAME.freeOpensPerDay + 1,
      nextOpenCostsTicket: true,
      freeOpensPerDay: GAME.freeOpensPerDay,
      shardsPerTicket: GAME.shardsPerTicket,
    });
  });

  it('starts a fresh free open on the next UTC day', async () => {
    const p = await newPlayer();
    await openCrate(req(await crateAt(), p), deps(ROLL_SHARDS));
    await pool.query(`UPDATE player_open_days SET open_day = open_day - 1 WHERE player_id = $1`, [p.playerId]);
    expect(await getAllowance(p.playerId, pool)).toMatchObject({ freeOpensLeft: GAME.freeOpensPerDay, opensUsedToday: 0 });
    expect(await openCrate(req(await crateAt(), p), deps(ROLL_SHARDS))).toMatchObject({ ok: true, ticketSpent: false });
  });
});

describe('daily prize budget', () => {
  it('stops awarding cards once the day cap is reached', async () => {
    await addCards(5);
    const outcomes = [];
    for (let i = 0; i < 4; i++) {
      const p = await newPlayer();
      outcomes.push(await openCrate(req(await crateAt(), p), { ...deps(ROLL_COMMON), budget: { maxCards: 2 } }));
    }
    expect(outcomes.filter((r) => r.ok && r.outcome === 'card')).toHaveLength(2);
    const shards = outcomes.filter((r) => r.ok && r.outcome === 'shards');
    expect(shards).toHaveLength(2);
    // Cards were off the table before the draw, so these aren't downgrades, and the odds said so.
    expect(shards.every((r) => r.ok && r.outcome === 'shards' && r.budgetCapped && !r.downgraded)).toBe(true);

    expect((await pool.query(`SELECT cards_awarded FROM prize_budget_days`)).rows[0].cards_awarded).toBe(2);
    const reserved = await pool.query(`SELECT count(*)::int AS n FROM inventory_items WHERE status = 'reserved'`);
    expect(reserved.rows[0].n).toBe(2);
  });

  it('puts a card back when it would take the day over its dollar ceiling', async () => {
    await addCards(1, 200);
    const p = await newPlayer();
    const r = await openCrate(req(await crateAt(), p), { ...deps(ROLL_COMMON), budget: { maxValueUsd: 50 } });
    expect(r).toMatchObject({ ok: true, outcome: 'shards', downgraded: true, budgetCapped: true });

    // The savepoint rolled the reservation back, so the card is still awardable tomorrow.
    expect((await pool.query(`SELECT status FROM inventory_items`)).rows[0].status).toBe('available');
    expect((await pool.query(`SELECT count(*)::int AS n FROM prize_budget_days`)).rows[0].n).toBe(0);
    expect((await pool.query(`SELECT count(*)::int AS n FROM prize_sends`)).rows[0].n).toBe(0);
  });

  it('counts concurrent wins exactly, never past the cap', async () => {
    await addCards(10);
    const players = await Promise.all(Array.from({ length: 10 }, newPlayer));
    const crates = await Promise.all(players.map(() => crateAt()));
    await Promise.all(
      players.map((p, i) => openCrate(req(crates[i]!, p), { ...deps(ROLL_COMMON), budget: { maxCards: 3 } })),
    );
    const cards = await pool.query(`SELECT count(*)::int AS n FROM crate_openings WHERE result = 'card'`);
    expect(cards.rows[0].n).toBe(3);
    expect((await pool.query(`SELECT cards_awarded FROM prize_budget_days`)).rows[0].cards_awarded).toBe(3);
  });
});

describe('inventory reservation', () => {
  it('never awards more cards than the vault holds under concurrent opens', async () => {
    await addCards(3);
    const players = await Promise.all(Array.from({ length: 20 }, newPlayer));
    const crates = await Promise.all(players.map(() => crateAt()));
    const results = await Promise.all(players.map((p, i) => openCrate(req(crates[i]!, p), deps(ROLL_COMMON))));

    expect(results.filter((r) => r.ok && r.outcome === 'card')).toHaveLength(3);
    expect(results.filter((r) => r.ok && r.outcome === 'shards')).toHaveLength(17);

    const items = await pool.query(`SELECT status, reserved_by_opening_id FROM inventory_items`);
    expect(items.rows.every((r) => r.status === 'reserved')).toBe(true);
    expect(new Set(items.rows.map((r) => r.reserved_by_opening_id)).size).toBe(3);
    expect((await pool.query(`SELECT count(*)::int AS n FROM prize_sends`)).rows[0].n).toBe(3);
  });
});

describe('open validation', () => {
  it('rejects opens beyond the open radius', async () => {
    const p = await newPlayer();
    const far = await openCrate(req(await crateAt(), p, LAT + 0.001), deps()); // ~111 m
    expect(far).toMatchObject({ ok: false, code: 'too_far' });
  });

  it('records the anti-cheat flag and awards nothing on rejection', async () => {
    await addCards(1);
    const p = await newPlayer();
    const crate = await crateAt();
    const r = await openCrate(req(crate, p), {
      db: pool,
      validateOpen: async () => ({ ok: false, reason: 'teleport', flag: { reason: 'speed 900 km/h' } }),
    });
    expect(r).toMatchObject({ ok: false, code: 'anticheat' });
    const flags = await pool.query(`SELECT reason FROM player_flags WHERE player_id = $1`, [p.playerId]);
    expect(flags.rows[0].reason).toBe('speed 900 km/h');
    expect((await pool.query(`SELECT status FROM crates WHERE id = $1`, [crate])).rows[0].status).toBe('active');
  });

  it('fails closed when the anti-cheat hook throws', async () => {
    await addCards(1);
    const p = await newPlayer();
    const crate = await crateAt();
    await expect(
      openCrate(req(crate, p), { db: pool, validateOpen: async () => { throw new Error('redis down'); } }),
    ).rejects.toThrow('redis down');
    expect((await pool.query(`SELECT count(*)::int AS n FROM crate_openings`)).rows[0].n).toBe(0);
  });
});

describe('prize send queue', () => {
  async function winOne() {
    await addCards(1);
    const p = await newPlayer();
    await openCrate(req(await crateAt(), p), deps(ROLL_COMMON));
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

describe('world crate seeder', () => {
  const seedOpts = { cities: [TEST_CITY] };

  it('fills a city to target inside its core, keeping crates apart', async () => {
    const r = await seedWorldCrates({ ...seedOpts, cratesPerCity: 6 }, pool);
    expect(r.created).toBe(6);
    expect(r.byCity[TEST_CITY.name]).toBe(6);

    const active = await pool.query(`SELECT count(*)::int AS n FROM crates WHERE status = 'active' AND city = $1`, [TEST_CITY.name]);
    expect(active.rows[0].n).toBe(6);

    const closest = await pool.query<{ m: number }>(
      `SELECT min(ST_Distance(a.location, b.location)) AS m FROM crates a JOIN crates b ON a.id < b.id`,
    );
    expect(Number(closest.rows[0]!.m)).toBeGreaterThanOrEqual(GAME.crateMinSpacingM);

    const outside = await pool.query(
      `SELECT count(*)::int AS n FROM crates
        WHERE ST_Distance(location, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography) > $3`,
      [TEST_CITY.lat, TEST_CITY.lng, TEST_CITY.radiusKm * 1_000],
    );
    expect(outside.rows[0].n).toBe(0);
  });

  it('tops up only the shortfall and stops at the daily ceiling', async () => {
    await seedWorldCrates({ ...seedOpts, cratesPerCity: 6, maxPerDay: 4 }, pool);
    expect((await pool.query(`SELECT count(*)::int AS n FROM crates`)).rows[0].n).toBe(4);

    const again = await seedWorldCrates({ ...seedOpts, cratesPerCity: 6, maxPerDay: 4 }, pool);
    expect(again.created).toBe(0); // the day's ceiling is spent, even though the city is short

    const more = await seedWorldCrates({ ...seedOpts, cratesPerCity: 6, maxPerDay: 10 }, pool);
    expect(more.created).toBe(2); // only what the city was missing
    expect((await pool.query(`SELECT count(*)::int AS n FROM crates`)).rows[0].n).toBe(6);
  });

  it('needs no network: seeding runs with every outbound fetch broken', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => { throw new Error('network is down'); }) as typeof fetch;
    try {
      const r = await seedWorldCrates({ ...seedOpts, cratesPerCity: 5 }, pool);
      expect(r).toMatchObject({ created: 5, noRoom: 0 });
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('reports a city with no free spot instead of looping or throwing', async () => {
    // A 100 m core holds one spot at the 200 m grid step, and crates must be 120 m apart.
    const tiny = { ...TEST_CITY, name: 'Tinyville', core: { lat: LAT, lng: LNG, radiusKm: 0.1 } };
    const r = await seedWorldCrates({ cities: [tiny], cratesPerCity: 4 }, pool);
    expect(r.created).toBe(1);
    expect(r.noRoom).toBe(1);
  });

  it('replaces a claimed crate on the next run', async () => {
    await seedWorldCrates({ ...seedOpts, cratesPerCity: 3 }, pool);
    const p = await newPlayer();
    const first = (await pool.query<{ id: string; lat: number; lng: number }>(
      `SELECT id, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng FROM crates LIMIT 1`,
    )).rows[0]!;
    const opened = await openCrate(req(first.id, p, first.lat, first.lng), deps(ROLL_SHARDS));
    expect(opened.ok).toBe(true);

    expect((await pool.query(`SELECT count(*)::int AS n FROM crates WHERE status = 'active'`)).rows[0].n).toBe(2);
    await seedWorldCrates({ ...seedOpts, cratesPerCity: 3 }, pool);
    expect((await pool.query(`SELECT count(*)::int AS n FROM crates WHERE status = 'active'`)).rows[0].n).toBe(3);
  });
});

describe('published odds', () => {
  const cardRate = async (kind: CrateKind) => {
    const w = await loadOdds(kind, pool);
    const sum = ROLL_TIERS.reduce((s, t) => s + w[t], 0);
    expect(sum).toBe(GAME.oddsTotal); // a weight typo in a migration would shift every band
    return (GAME.oddsTotal - w.shards) / GAME.oddsTotal;
  };

  it('pays a card on 1% of street crates and 5% of ticket opens', async () => {
    expect(await cardRate('standard')).toBeCloseTo(0.01, 6);
    expect(await cardRate('ticket')).toBeCloseTo(0.05, 6);
  });
});
