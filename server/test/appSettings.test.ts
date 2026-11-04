import { beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { currentCoinMint, readCoinSettings, resetSettingsCache, resolveCoinHoldConfig } from '../src/appSettings';

const MINT = 'CARDSccUMFKoPRZxt5vt3ksUbxEFEcnZ3H2pd3dKxYjp';
const ENV_MINT = 'So11111111111111111111111111111111111111112';

const fakeDb = (rows: { key: string; value: string }[] | Error) => {
  const db = {
    calls: 0,
    async query() {
      db.calls++;
      if (rows instanceof Error) throw rows;
      return { rows };
    },
  };
  return db as unknown as Pool & { calls: number };
};

beforeEach(() => resetSettingsCache());

describe('app settings', () => {
  it('uses the admin box address over the environment', async () => {
    const db = fakeDb([{ key: 'coin_mint', value: MINT }]);
    const cfg = await resolveCoinHoldConfig({ NEXT_PUBLIC_COIN_ADDRESS: ENV_MINT } as never, db);
    expect(cfg?.mint).toBe(MINT);
    expect(await currentCoinMint({ NEXT_PUBLIC_COIN_ADDRESS: ENV_MINT } as never, db)).toBe(MINT);
  });

  it('falls back to the environment when nothing is set in the box', async () => {
    const db = fakeDb([]);
    expect((await resolveCoinHoldConfig({ COIN_MINT: ENV_MINT } as never, db))?.mint).toBe(ENV_MINT);
  });

  it('is off when there is no coin anywhere', async () => {
    expect(await resolveCoinHoldConfig({} as never, fakeDb([]))).toBeNull();
    expect(await currentCoinMint({} as never, fakeDb([]))).toBeNull();
  });

  it('can keep the address public but the gate off', async () => {
    const db = fakeDb([{ key: 'coin_mint', value: MINT }, { key: 'hold_gate', value: 'off' }]);
    expect(await resolveCoinHoldConfig({} as never, db)).toBeNull();
    expect(await currentCoinMint({} as never, db)).toBe(MINT);
  });

  it('ignores a malformed stored address', async () => {
    const db = fakeDb([{ key: 'coin_mint', value: 'not an address' }]);
    expect(await resolveCoinHoldConfig({} as never, db)).toBeNull();
  });

  it('behaves as before the migration when the table does not exist', async () => {
    const db = fakeDb(Object.assign(new Error('relation "app_settings" does not exist'), { code: '42P01' }));
    expect(await readCoinSettings(db)).toEqual({ mint: null, gateOff: false });
    expect((await resolveCoinHoldConfig({ COIN_MINT: ENV_MINT } as never, db))?.mint).toBe(ENV_MINT);
  });

  it('refuses rather than guess when the settings cannot be read and no address is fixed in the environment', async () => {
    const db = fakeDb(new Error('connection lost'));
    await expect(resolveCoinHoldConfig({} as never, db)).rejects.toThrow('connection lost');
    expect((await resolveCoinHoldConfig({ COIN_MINT: ENV_MINT } as never, db))?.mint).toBe(ENV_MINT);
  });

  it('caches reads for a few seconds', async () => {
    const db = fakeDb([{ key: 'coin_mint', value: MINT }]);
    await readCoinSettings(db, 1_000);
    await readCoinSettings(db, 3_000);
    expect(db.calls).toBe(1);
    await readCoinSettings(db, 7_000);
    expect(db.calls).toBe(2);
  });
});
