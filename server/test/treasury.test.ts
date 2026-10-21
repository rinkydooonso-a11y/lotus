import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { addInventoryItem, setInventoryStatus } from '../src/admin';
import { openCrate } from '../src/openCrate';
import { allow, crateAt, fakeAddress, forcedRng, LAT, LNG, newPlayer, pool, reset, ROLL_COMMON } from './helpers';

const req = (crateId: string, p: { playerId: string; address: string }) => ({
  crateId, lat: LAT, lng: LNG, accuracyM: 5, clientTs: Date.now(), deviceId: 'dev-1',
  playerId: p.playerId, walletAddress: p.address, ip: '127.0.0.1',
});
const sig = () => fakeAddress() + fakeAddress().slice(0, 44);

beforeEach(reset);
afterAll(() => pool.end());

describe('vault cards', () => {
  it('are stored withheld and never awarded', async () => {
    await addInventoryItem({ nftMint: fakeAddress(), cardName: 'Vault card', valueUsd: 10, location: 'vault' }, pool);
    const item = await pool.query(`SELECT status, location FROM inventory_items`);
    expect(item.rows[0]).toEqual({ status: 'withheld', location: 'vault' });

    const p = await newPlayer();
    const r = await openCrate(req(await crateAt(), p), { validateOpen: allow, db: pool, rng: forcedRng(ROLL_COMMON) });
    expect(r).toMatchObject({ ok: true, outcome: 'shards' });
  });

  it('cannot be made available by hand, but can be removed', async () => {
    const { id } = await addInventoryItem({ nftMint: fakeAddress(), cardName: 'Vault card', valueUsd: 10, location: 'vault' }, pool);
    await expect(setInventoryStatus(id, 'available', pool)).rejects.toThrow(/vault/);
    await expect(pool.query(`UPDATE inventory_items SET status = 'available' WHERE id = $1`, [id])).rejects.toThrow(
      /inventory_vault_not_in_play/,
    );
    await setInventoryStatus(id, 'removed', pool);
  });

  it('hot cards still default to available', async () => {
    await addInventoryItem({ nftMint: fakeAddress(), cardName: 'Hot card', valueUsd: 10 }, pool);
    const item = await pool.query(`SELECT status, location FROM inventory_items`);
    expect(item.rows[0]).toEqual({ status: 'available', location: 'hot' });
  });
});

describe('purchase log', () => {
  it('writes a purchase treasury event with the card when a cost is given', async () => {
    const tx = sig();
    const { id } = await addInventoryItem(
      { nftMint: fakeAddress(), cardName: 'Charizard', valueUsd: 120, location: 'vault', costUsd: 95.5, purchaseTxSignature: tx },
      pool,
    );
    const ev = await pool.query(`SELECT kind, usd_value, tx_signature, inventory_item_id FROM treasury_events`);
    expect(ev.rows).toEqual([{ kind: 'purchase', usd_value: '95.50', tx_signature: tx, inventory_item_id: id }]);
  });

  it('writes nothing when no cost is given', async () => {
    await addInventoryItem({ nftMint: fakeAddress(), cardName: 'Gift', valueUsd: 5 }, pool);
    const ev = await pool.query(`SELECT count(*)::int AS n FROM treasury_events`);
    expect(ev.rows[0].n).toBe(0);
  });
});
