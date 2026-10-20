import { describe, expect, it } from 'vitest';
import {
  runInventorySync, type DiscrepancyKind, type HeldAsset, type OpenDiscrepancy, type Snapshot, type SyncStore, type TrackedItem,
} from '../src/inventorySync.js';
import { FakeChain, HOT, OTHER, silentLog } from './fakes.js';

class MemStore implements SyncStore {
  items: TrackedItem[] = [];
  discrepancies: Array<OpenDiscrepancy & { resolved: boolean }> = [];
  snapshots: Snapshot[] = [];
  private seq = 0;
  async listItems() { return this.items.map((i) => ({ ...i })); }
  async listOpenDiscrepancies() { return this.discrepancies.filter((d) => !d.resolved).map((d) => ({ ...d })); }
  async upsertDiscrepancy(d: { nftMint: string; kind: DiscrepancyKind; inventoryItemId: string | null; autoWithheld: boolean }) {
    const open = this.discrepancies.find((x) => !x.resolved && x.nftMint === d.nftMint && x.kind === d.kind);
    if (open) { open.autoWithheld ||= d.autoWithheld; return; }
    this.discrepancies.push({ id: String(++this.seq), ...d, resolved: false });
  }
  async resolveDiscrepancy(id: string) { this.discrepancies.find((d) => d.id === id)!.resolved = true; }
  async writeSnapshot(s: Snapshot) { this.snapshots.push(s); }
  async moveToHot(id: string) {
    const i = this.items.find((x) => x.id === id)!;
    if (i.location !== 'vault' || i.status !== 'withheld') return false;
    i.location = 'hot'; i.status = 'available';
    return true;
  }
  open(kind?: DiscrepancyKind) { return this.discrepancies.filter((d) => !d.resolved && (!kind || d.kind === kind)); }
}

function setup() {
  const store = new MemStore();
  const chain = new FakeChain();
  chain.owners.clear();
  let held: HeldAsset[] = [];
  const statusCalls: Array<[string, string]> = [];
  const deps = {
    listHeld: async () => held,
    store,
    chain,
    setInventoryStatus: async (id: string, status: 'available' | 'withheld') => {
      statusCalls.push([id, status]);
      const item = store.items.find((i) => i.id === id)!;
      item.status = status;
    },
    log: silentLog,
  };
  const hold = (...mints: string[]) => {
    held = mints.map((mint) => ({ mint, name: mint, collection: null }));
    for (const m of mints) chain.owners.set(m, HOT);
  };
  const item = (id: string, nftMint: string, status: TrackedItem['status'], sendStatus: string | null = null) =>
    store.items.push({ id, nftMint, status, location: 'hot', valueUsd: 25, sendStatus });
  const vaultItem = (id: string, nftMint: string) =>
    store.items.push({ id, nftMint, status: 'withheld', location: 'vault', valueUsd: 25, sendStatus: null });
  return { store, chain, deps, hold, item, vaultItem, statusCalls };
}

describe('inventory sync', () => {
  it('withholds an available card the hot wallet no longer has, and restores it when it returns', async () => {
    const s = setup();
    s.item('i1', 'A', 'available');
    s.item('i2', 'B', 'available');
    s.hold('B');
    s.chain.owners.set('A', OTHER);

    let r = await runInventorySync(s.deps);
    expect(s.statusCalls).toEqual([['i1', 'withheld']]);
    expect(r.availableCount).toBe(1);
    expect(s.store.open('missing')).toHaveLength(1);

    // Still missing: no second withhold, discrepancy stays open.
    r = await runInventorySync(s.deps);
    expect(s.statusCalls).toHaveLength(1);
    expect(s.store.open('missing')).toHaveLength(1);

    s.hold('A', 'B');
    r = await runInventorySync(s.deps);
    expect(s.statusCalls.at(-1)).toEqual(['i1', 'available']);
    expect(s.store.open()).toHaveLength(0);
    expect(r.availableCount).toBe(2);
  });

  it('does not withhold when only the indexer is behind', async () => {
    const s = setup();
    s.item('i1', 'A', 'available');
    s.hold();
    s.chain.owners.set('A', HOT); // chain says we hold it; DAS listing lagged
    await runInventorySync(s.deps);
    expect(s.statusCalls).toEqual([]);
    expect(s.store.open()).toHaveLength(0);
  });

  it('ignores reserved cards that are mid-send, flags ones that should still be here', async () => {
    const s = setup();
    s.item('i1', 'A', 'reserved', 'submitted');
    s.item('i2', 'B', 'reserved', 'failed');
    s.hold();
    await runInventorySync(s.deps);
    expect(s.store.open('missing').map((d) => d.nftMint)).toEqual(['B']);
    expect(s.statusCalls).toEqual([]); // never touches reserved items
  });

  it('reports untracked cards and sent cards still in the wallet', async () => {
    const s = setup();
    s.item('i1', 'A', 'sent', 'sent');
    s.hold('A', 'NEW');
    const r = await runInventorySync(s.deps);
    expect(s.store.open('sent_but_held').map((d) => d.nftMint)).toEqual(['A']);
    expect(s.store.open('untracked').map((d) => d.nftMint)).toEqual(['NEW']);
    expect(r.heldCount).toBe(2);
    expect(r.trackedCount).toBe(1);
  });

  describe('vault cards', () => {
    it('stay withheld in the vault without raising discrepancies', async () => {
      const s = setup();
      s.vaultItem('v1', 'V');
      s.hold();
      const r = await runInventorySync(s.deps);
      expect(s.store.items[0]).toMatchObject({ status: 'withheld', location: 'vault' });
      expect(s.store.open()).toHaveLength(0);
      expect(r.availableCount).toBe(0);
    });

    it('become available once a top-up lands them in the hot wallet', async () => {
      const s = setup();
      s.vaultItem('v1', 'V');
      s.hold('V');
      const r = await runInventorySync(s.deps);
      expect(r.arrivedFromVault).toBe(1);
      expect(r.availableCount).toBe(1);
      expect(s.store.items[0]).toMatchObject({ status: 'available', location: 'hot' });
      expect(s.statusCalls).toEqual([]);
    });

    it('do not move when only the indexer says they arrived', async () => {
      const s = setup();
      s.vaultItem('v1', 'V');
      s.hold('V');
      s.chain.owners.set('V', OTHER);
      const r = await runInventorySync(s.deps);
      expect(r.arrivedFromVault).toBe(0);
      expect(s.store.items[0]).toMatchObject({ status: 'withheld', location: 'vault' });
    });

    it('are reported missing when neither wallet holds them, and untracked vault cards are reported', async () => {
      const s = setup();
      s.vaultItem('v1', 'V');
      s.vaultItem('v2', 'W');
      s.hold();
      const deps = { ...s.deps, listVaultHeld: async () => [{ mint: 'W', name: 'W', collection: null }, { mint: 'X', name: 'X', collection: null }] };
      await runInventorySync(deps);
      expect(s.store.open('missing').map((d) => d.nftMint)).toEqual(['V']);
      expect(s.store.open('untracked').map((d) => d.nftMint)).toEqual(['X']);
      expect(s.store.items.every((i) => i.status === 'withheld')).toBe(true);
    });
  });
});
