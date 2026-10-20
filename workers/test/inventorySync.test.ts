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
    store.items.push({ id, nftMint, status, valueUsd: 25, sendStatus });
  return { store, chain, deps, hold, item, statusCalls };
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
});
