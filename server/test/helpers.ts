import { randomBytes } from 'node:crypto';
import pg from 'pg';
import type { Rng } from '../src/rng';
import { upsertPlayerByWallet } from '../src/players';
import type { AreaData, LatLng } from '../src/walkable';
import type { CoinBalance, CoinHoldConfig } from '../src/coin';

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 30 });

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export const fakeAddress = () => Array.from(randomBytes(44), (b) => B58[b % 58]).join('');

export const LAT = 53.3498;
export const LNG = -6.2603;
export const TEST_CITY = { name: 'Testville', lat: LAT, lng: LNG, radiusKm: 2 } as const;

export async function reset() {
  await pool.query(`TRUNCATE prize_sends, crate_openings, inventory_items, ticket_spends, crates,
                    location_pings, player_flags, player_open_days, prize_budget_days,
                    holder_windows, wallets, players, treasury_events CASCADE`);
}

export async function newPlayer() {
  const address = fakeAddress();
  const { playerId } = await upsertPlayerByWallet({ address, type: 'external' }, pool);
  return { playerId, address };
}

/** A world crate: no owner, anyone who reaches it can open it. */
export async function crateAt(lat = LAT, lng = LNG, city: string = TEST_CITY.name) {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO crates (location, city, kind, expires_at)
     VALUES (ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography, $3, 'standard', now() + interval '30 minutes')
     RETURNING id`,
    [lat, lng, city],
  );
  return r.rows[0]!.id;
}

export async function addCards(n: number, valueUsd = 10, tier = 'common') {
  for (let i = 0; i < n; i++) {
    await pool.query(
      `INSERT INTO inventory_items (nft_mint, card_name, value_usd, tier) VALUES ($1, $2, $3, $4)`,
      [fakeAddress(), `Card ${i}`, valueUsd, tier],
    );
  }
}

/** Gives a player `n` banked tickets so they can open more than once in a day. */
export async function giveTickets(playerId: string, n: number) {
  await pool.query('UPDATE players SET tickets = $2 WHERE id = $1', [playerId, n]);
}

/** Forces the odds roll to `roll`; every other draw returns its minimum. */
export const forcedRng = (roll: number): Rng => (min, max) => (max === 1_000_000 ? roll : min);
// Bands are cumulative rarest first (grail, rare, uncommon, common, shards); see db/migrations/0008.
export const ROLL_COMMON = 5_000; // inside the standard common band [2_550, 10_000)
export const ROLL_TICKET_COMMON = 20_000; // ticket common [14_250, 50_000); shards on the standard table
export const ROLL_SHARDS = 999_999;

export const allow = async () => ({ ok: true as const });

// Walkable-ground stand-in, so seeder tests never touch Overpass -------------------------

const M_PER_DEG_LAT = 111_320;
function square(center: LatLng, halfM: number) {
  const dLat = halfM / M_PER_DEG_LAT;
  const dLng = halfM / (M_PER_DEG_LAT * Math.cos((center.lat * Math.PI) / 180));
  const c: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]];
  return c.map(([x, y]) => ({ lat: center.lat + y * dLat, lng: center.lng + x * dLng }));
}

/** An area loader that says everything within halfM of the anchor is a walkable plaza. */
export const plazaLoader = (halfM = 350) => async (lat: number, lng: number): Promise<AreaData> => ({
  lines: [],
  areas: [square({ lat, lng }, halfM)],
  waterAreas: [],
  waterLines: [],
});

/** An area loader standing in for Overpass being down. */
export const noAreaLoader = async (): Promise<AreaData | null> => null;

// Coin holder gate -------------------------------------------------------------

/** A gate configuration that needs no network: pass stub balance/price lookups alongside it. */
export const HOLD_CFG: CoinHoldConfig = {
  mint: 'CoinMint11111111111111111111111111111111111',
  requiredUsd: 25,
  windowMs: 48 * 3_600_000,
  recheckMs: 10 * 60_000,
  rpcUrl: 'http://rpc.invalid',
  priceUrl: 'http://price.invalid',
};

/** Holds `coin` whole tokens at 6 decimals, the pump.fun default. */
export const heldCoin = (coin: number) => async (): Promise<CoinBalance> => ({
  baseUnits: BigInt(Math.round(coin * 1e6)),
  decimals: 6,
});
export const coinPrice = (usd: number) => async () => usd;
export const lookupDown = async (): Promise<never> => {
  throw new Error('rpc unavailable');
};

/** Gate deps that let the player through: they hold plenty at a known price. */
export const holdOk = (db: pg.Pool) => ({
  db, config: HOLD_CFG, balance: heldCoin(1_000_000), price: coinPrice(0.0001),
});
