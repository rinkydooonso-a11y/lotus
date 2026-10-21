import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { coinHoldConfig, requiredBaseUnits, toUiAmount } from '../src/coin';
import { checkCoinHold, getCoinHoldStatus, pruneHolderWindows } from '../src/holding';
import { openCrate } from '../src/openCrate';
import {
  allow, coinPrice, crateAt, heldCoin, HOLD_CFG, holdOk, LAT, LNG, lookupDown, newPlayer, pool, reset,
  ROLL_SHARDS, forcedRng,
} from './helpers';

const req = (crateId: string, p: { playerId: string; address: string }) => ({
  crateId, lat: LAT, lng: LNG, accuracyM: 5, clientTs: Date.now(),
  deviceId: 'dev-1', playerId: p.playerId, walletAddress: p.address, ip: '127.0.0.1',
});
/** newPlayer() shape as the gate wants it. */
const asWallet = (p: { playerId: string; address: string }) => ({ playerId: p.playerId, walletAddress: p.address });
/** openCrate deps with the gate wired to stub lookups. */
const deps = (hold: Record<string, unknown>) => ({
  validateOpen: allow, db: pool, rng: forcedRng(ROLL_SHARDS), hold: { db: pool, config: HOLD_CFG, ...hold },
});

const windowRow = async (playerId: string) =>
  (await pool.query(`SELECT * FROM holder_windows WHERE player_id = $1`, [playerId])).rows[0];
const openCount = async () => (await pool.query(`SELECT count(*)::int AS n FROM crate_openings`)).rows[0].n;
const dayRows = async () => (await pool.query(`SELECT count(*)::int AS n FROM player_open_days`)).rows[0].n;

// $0.0001 a coin, so $25 is 250,000 coin.
const PRICE = 0.0001;
const COIN_FOR_25 = 250_000;

beforeEach(reset);
afterAll(() => pool.end());

describe('the gate is off until there is a coin', () => {
  it('reads as off with no coin address set', () => {
    expect(coinHoldConfig({})).toBeNull();
    expect(coinHoldConfig({ SOLANA_RPC_URL: 'https://rpc.example' })).toBeNull();
    // A malformed address is off too, not an error: before launch there is no coin to hold, and
    // taking the game down over an env var typo would be worse than not gating.
    expect(coinHoldConfig({ COIN_MINT: 'nope', SOLANA_RPC_URL: 'https://rpc.example' })).toBeNull();
  });

  it('comes on once the coin address is set, and off again on request', () => {
    const env = { COIN_MINT: HOLD_CFG.mint, SOLANA_RPC_URL: 'https://rpc.example' };
    expect(coinHoldConfig(env)).toMatchObject({ mint: HOLD_CFG.mint, requiredUsd: 25, windowMs: 48 * 3_600_000 });
    // The address the site already shows switches it on, so launch day is one setting.
    expect(coinHoldConfig({ NEXT_PUBLIC_COIN_ADDRESS: HOLD_CFG.mint })).toMatchObject({ mint: HOLD_CFG.mint });
    // The site's placeholder text is not an address, so it reads as "no coin yet".
    expect(coinHoldConfig({ NEXT_PUBLIC_COIN_ADDRESS: 'COIN_ADDRESS_PLACEHOLDER' })).toBeNull();
    // A coin address with no RPC set must not leave the gate silently off: it falls back to the
    // public endpoint rather than letting everyone in.
    expect(coinHoldConfig({ COIN_MINT: HOLD_CFG.mint })?.rpcUrl).toContain('mainnet-beta');
    expect(coinHoldConfig({ ...env, LOTUS_HOLD_GATE: 'off' })).toBeNull();
  });

  it('lets an open through with the gate off and writes no window', async () => {
    const p = await newPlayer();
    const r = await openCrate(req(await crateAt(), p), {
      validateOpen: allow, db: pool, rng: forcedRng(ROLL_SHARDS), hold: { config: null },
    });
    expect(r).toMatchObject({ ok: true });
    expect(await windowRow(p.playerId)).toBeUndefined();
    expect(await getCoinHoldStatus(p.playerId, { db: pool, config: null })).toEqual({ gate: 'off' });
  });
});

describe('a wallet under the requirement', () => {
  it('refuses the open and says how much more coin to buy', async () => {
    const p = await newPlayer();
    const crate = await crateAt();
    const r = await openCrate(req(crate, p), deps({ balance: heldCoin(100_000), price: coinPrice(PRICE) }));

    expect(r).toMatchObject({ ok: false, code: 'needs_coin' });
    expect(!r.ok && r.message).toContain('$25');
    expect(!r.ok && r.message).toContain('$10.00'); // holds $10, so $15 short
    expect(!r.ok && r.message).toContain('$15.00');

    // Nothing was spent and the crate is still there for them (or anybody else).
    expect(await openCount()).toBe(0);
    expect(await dayRows()).toBe(0);
    expect((await pool.query(`SELECT status FROM crates WHERE id = $1`, [crate])).rows[0].status).toBe('active');
    // No window is opened, so buying the coin and trying again works straight away.
    expect(await windowRow(p.playerId)).toBeUndefined();
  });

  it('reports the requirement to the UI without making a network call', async () => {
    const p = await newPlayer();
    expect(await getCoinHoldStatus(p.playerId, { db: pool, config: HOLD_CFG })).toEqual({
      gate: 'on', qualified: false, requiredUsd: 25,
    });
  });
});

describe('a wallet over the requirement', () => {
  it('opens the crate and snapshots the coin amount for 48 hours', async () => {
    const p = await newPlayer();
    const now = new Date('2026-10-21T12:00:00Z');
    const r = await openCrate(req(await crateAt(), p), deps({ balance: heldCoin(400_000), price: coinPrice(PRICE), now }));
    expect(r).toMatchObject({ ok: true });

    const w = await windowRow(p.playerId);
    expect(w.mint).toBe(HOLD_CFG.mint);
    expect(w.wallet_address).toBe(p.address);
    expect(Number(w.required_usd)).toBe(25);
    expect(BigInt(w.required_tokens)).toBe(BigInt(COIN_FOR_25) * 1_000_000n);
    expect(w.locked_out_at).toBeNull();
    expect(new Date(w.expires_at).toISOString()).toBe('2026-10-23T12:00:00.000Z');

    expect(await getCoinHoldStatus(p.playerId, { db: pool, config: HOLD_CFG, now })).toMatchObject({
      gate: 'on', qualified: true, requiredUsd: 25, requiredCoin: COIN_FOR_25, heldCoin: 400_000, lockedOut: false,
    });
  });

  it('keeps the coin amount fixed while the window runs, even if the price doubles', async () => {
    const p = await newPlayer();
    const t0 = new Date('2026-10-21T12:00:00Z');
    await checkCoinHold(asWallet(p), { db: pool, config: HOLD_CFG, balance: heldCoin(300_000), price: coinPrice(PRICE), now: t0 });

    // A day later the coin is worth twice as much, so $25 would now be 125,000 coin. The window
    // snapshotted 250,000, and that is what still applies: a price move mid-window changes nothing.
    const later = new Date(t0.getTime() + 24 * 3_600_000);
    const v = await checkCoinHold(asWallet(p), {
      db: pool, config: HOLD_CFG, balance: heldCoin(300_000), price: coinPrice(PRICE * 2), now: later,
    });
    expect(v).toMatchObject({ ok: true, gate: 'on' });
    expect(BigInt((await windowRow(p.playerId)).required_tokens)).toBe(BigInt(COIN_FOR_25) * 1_000_000n);
  });

  it('asks the chain again once the window has run out', async () => {
    const p = await newPlayer();
    const t0 = new Date('2026-10-21T12:00:00Z');
    await checkCoinHold(asWallet(p), { db: pool, config: HOLD_CFG, balance: heldCoin(300_000), price: coinPrice(PRICE), now: t0 });

    // Two days later the window is over. At ten times the price, $25 is only 25,000 coin, so the
    // same holding re-qualifies against a fresh, smaller requirement.
    const after = new Date(t0.getTime() + 49 * 3_600_000);
    const v = await checkCoinHold(asWallet(p), {
      db: pool, config: HOLD_CFG, balance: heldCoin(300_000), price: coinPrice(PRICE * 10), now: after,
    });
    expect(v).toMatchObject({ ok: true });
    const w = await windowRow(p.playerId);
    expect(BigInt(w.required_tokens)).toBe(25_000n * 1_000_000n);
    expect(new Date(w.expires_at).toISOString()).toBe('2026-10-25T13:00:00.000Z');
  });
});

describe('dropping below the requirement inside the window', () => {
  it('needs no lookup at all while the last check is fresh', async () => {
    const p = await newPlayer();
    const t0 = new Date('2026-10-21T12:00:00Z');
    await checkCoinHold(asWallet(p), { db: pool, config: HOLD_CFG, balance: heldCoin(300_000), price: coinPrice(PRICE), now: t0 });

    // One minute later, with both lookups broken: the cached window carries the open on its own.
    const v = await checkCoinHold(asWallet(p), {
      db: pool, config: HOLD_CFG, balance: lookupDown, price: lookupDown, now: new Date(t0.getTime() + 60_000),
    });
    expect(v).toMatchObject({ ok: true, gate: 'on' });
  });

  it('locks the player out for the rest of the window, and topping back up does not clear it', async () => {
    const p = await newPlayer();
    const t0 = new Date('2026-10-21T12:00:00Z');
    await checkCoinHold(asWallet(p), { db: pool, config: HOLD_CFG, balance: heldCoin(300_000), price: coinPrice(PRICE), now: t0 });

    // Past the recheck interval, holding less than the snapshot: sold on the way to the crate.
    const dropped = new Date(t0.getTime() + 11 * 60_000);
    const r = await openCrate(req(await crateAt(), p), deps({ balance: heldCoin(10_000), price: coinPrice(PRICE), now: dropped }));
    expect(r).toMatchObject({ ok: false, code: 'hold_locked' });
    expect(await openCount()).toBe(0);
    expect(new Date((await windowRow(p.playerId)).locked_out_at).toISOString()).toBe(dropped.toISOString());

    // Buying it straight back does not reopen the door until the window ends.
    const toppedUp = new Date(t0.getTime() + 30 * 60_000);
    const again = await checkCoinHold(asWallet(p), {
      db: pool, config: HOLD_CFG, balance: heldCoin(900_000), price: coinPrice(PRICE), now: toppedUp,
    });
    expect(again).toMatchObject({ ok: false, code: 'hold_locked' });
    expect(await getCoinHoldStatus(p.playerId, { db: pool, config: HOLD_CFG, now: toppedUp })).toMatchObject({
      qualified: false, lockedOut: true,
    });

    // Once it does end, the holding is priced again and they are back in.
    const fresh = new Date(t0.getTime() + 49 * 3_600_000);
    expect(await checkCoinHold(asWallet(p), {
      db: pool, config: HOLD_CFG, balance: heldCoin(900_000), price: coinPrice(PRICE), now: fresh,
    })).toMatchObject({ ok: true });
    expect((await windowRow(p.playerId)).locked_out_at).toBeNull();
  });

  it('cannot be cleared by moving the coin to another wallet', async () => {
    const p = await newPlayer();
    const t0 = new Date('2026-10-21T12:00:00Z');
    await checkCoinHold(asWallet(p), { db: pool, config: HOLD_CFG, balance: heldCoin(300_000), price: coinPrice(PRICE), now: t0 });
    await checkCoinHold(asWallet(p), {
      db: pool, config: HOLD_CFG, balance: heldCoin(0), price: coinPrice(PRICE), now: new Date(t0.getTime() + 11 * 60_000),
    });

    // Same player, a different wallet that holds plenty. The window is the player's, not the
    // wallet's, so the lockout stands.
    const v = await checkCoinHold(
      { playerId: p.playerId, walletAddress: (await newPlayer()).address },
      { db: pool, config: HOLD_CFG, balance: heldCoin(900_000), price: coinPrice(PRICE), now: new Date(t0.getTime() + 20 * 60_000) },
    );
    expect(v).toMatchObject({ ok: false, code: 'hold_locked' });
  });
});

describe('when the chain or the price feed cannot be read', () => {
  it('refuses the open rather than letting it through, and spends nothing', async () => {
    const p = await newPlayer();
    const crate = await crateAt();
    const r = await openCrate(req(crate, p), deps({ balance: lookupDown, price: coinPrice(PRICE) }));

    expect(r).toMatchObject({ ok: false, code: 'coin_unavailable' });
    expect(!r.ok && r.message).toContain('try again');
    expect(await openCount()).toBe(0);
    expect(await dayRows()).toBe(0);
    expect((await pool.query(`SELECT status FROM crates WHERE id = $1`, [crate])).rows[0].status).toBe('active');
    expect(await windowRow(p.playerId)).toBeUndefined();
  });

  it('refuses when the price feed is down even though the balance reads fine', async () => {
    const p = await newPlayer();
    const r = await openCrate(req(await crateAt(), p), deps({ balance: heldCoin(900_000), price: lookupDown }));
    expect(r).toMatchObject({ ok: false, code: 'coin_unavailable' });
    expect(await openCount()).toBe(0);
  });

  it('refuses a re-check it cannot make, and leaves the window alone to be retried', async () => {
    const p = await newPlayer();
    const t0 = new Date('2026-10-21T12:00:00Z');
    await checkCoinHold(asWallet(p), { db: pool, config: HOLD_CFG, balance: heldCoin(300_000), price: coinPrice(PRICE), now: t0 });
    const stale = new Date(t0.getTime() + 11 * 60_000);

    expect(await checkCoinHold(asWallet(p), { db: pool, config: HOLD_CFG, balance: lookupDown, price: coinPrice(PRICE), now: stale }))
      .toMatchObject({ ok: false, code: 'coin_unavailable' });
    // Not a lockout: an outage is our problem, not the player's.
    const w = await windowRow(p.playerId);
    expect(w.locked_out_at).toBeNull();
    expect(new Date(w.checked_at).toISOString()).toBe(t0.toISOString());

    expect(await checkCoinHold(asWallet(p), { db: pool, config: HOLD_CFG, balance: heldCoin(300_000), price: coinPrice(PRICE), now: stale }))
      .toMatchObject({ ok: true });
  });
});

describe('pricing a holding', () => {
  it('rounds the required amount up so it is never a hair under the dollar figure', () => {
    expect(requiredBaseUnits(25, 0.0001, 6)).toBe(250_000n * 1_000_000n);
    expect(requiredBaseUnits(25, 1, 6)).toBe(25_000_000n);
    // 25 / 3 is 8.333…, so the gate asks for the next whole base unit up.
    expect(requiredBaseUnits(25, 3, 0)).toBe(9n);
    // A coin worth a millionth of a cent still prices exactly, where floating point would not.
    expect(requiredBaseUnits(25, 1e-8, 6)).toBe(2_500_000_000n * 1_000_000n);
    expect(() => requiredBaseUnits(25, 0, 6)).toThrow();
  });

  it('converts base units back for display', () => {
    expect(toUiAmount(250_000n * 1_000_000n, 6)).toBe(250_000);
  });
});

describe('housekeeping', () => {
  it('prunes windows that ended over a day ago and keeps live ones', async () => {
    const live = await newPlayer();
    const old = await newPlayer();
    await checkCoinHold(asWallet(live), { db: pool, config: HOLD_CFG, balance: heldCoin(900_000), price: coinPrice(PRICE) });
    await checkCoinHold(asWallet(old), { db: pool, config: HOLD_CFG, balance: heldCoin(900_000), price: coinPrice(PRICE) });
    await pool.query(`UPDATE holder_windows SET expires_at = now() - interval '2 days' WHERE player_id = $1`, [old.playerId]);

    expect(await pruneHolderWindows(pool)).toBe(1);
    expect(await windowRow(old.playerId)).toBeUndefined();
    expect(await windowRow(live.playerId)).toBeDefined();
  });
});
