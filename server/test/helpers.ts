import { randomBytes } from 'node:crypto';
import pg from 'pg';
import type { Rng } from '../src/rng';
import { upsertPlayerByWallet } from '../src/players';

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 30 });

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export const fakeAddress = () => Array.from(randomBytes(44), (b) => B58[b % 58]).join('');

export const LAT = 53.3498;
export const LNG = -6.2603;

export async function reset() {
  await pool.query(`TRUNCATE prize_sends, crate_openings, inventory_items, ticket_spends, crates,
                    location_pings, player_flags, wallets, players, treasury_events CASCADE`);
}

export async function newPlayer() {
  const address = fakeAddress();
  const { playerId } = await upsertPlayerByWallet({ address, type: 'external' }, pool);
  return { playerId, address };
}

export async function crateAt(playerId: string, lat = LAT, lng = LNG, kind = 'standard') {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO crates (location, spawned_for_player_id, kind, expires_at)
     VALUES (ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography, $1, $4, now() + interval '30 minutes') RETURNING id`,
    [playerId, lat, lng, kind],
  );
  return r.rows[0]!.id;
}

export async function addCards(n: number, valueUsd = 10) {
  for (let i = 0; i < n; i++) {
    await pool.query(`INSERT INTO inventory_items (nft_mint, card_name, value_usd, tier) VALUES ($1, $2, $3, 'common')`, [
      fakeAddress(),
      `Card ${i}`,
      valueUsd,
    ]);
  }
}

/** Forces the odds roll to `roll`; every other draw returns its minimum. */
export const forcedRng = (roll: number): Rng => (min, max) => (max === 1_000_000 ? roll : min);
export const ROLL_COMMON = 30_000; // inside the standard common band [25_500, 100_000)
export const ROLL_SHARDS = 999_999;

export const allow = async () => ({ ok: true as const });
