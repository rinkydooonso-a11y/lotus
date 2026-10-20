import type { Chain, Logger } from './types.js';

/**
 * Inventory sync: compares the hot wallet on chain with inventory_items.
 *
 * The one thing it changes: an 'available' item the hot wallet no longer holds (double-checked
 * against chain state, not just the indexer) is set to 'withheld', so the odds roller can never
 * award a card the vault doesn't have. If that card comes back, the sync makes it available again.
 * Everything else is written to inventory_discrepancies for the admin page.
 */

export interface HeldAsset {
  mint: string;
  name: string | null;
  collection: string | null;
}

export interface TrackedItem {
  id: string;
  nftMint: string;
  status: 'available' | 'reserved' | 'sent' | 'withheld' | 'removed';
  valueUsd: number;
  /** Status of this item's prize_sends row, if it has one. */
  sendStatus: string | null;
}

export type DiscrepancyKind = 'untracked' | 'missing' | 'sent_but_held';

export interface OpenDiscrepancy {
  id: string;
  nftMint: string;
  kind: DiscrepancyKind;
  inventoryItemId: string | null;
  autoWithheld: boolean;
}

export interface Snapshot {
  hotWallet: string;
  heldCount: number;
  trackedCount: number;
  availableCount: number;
  availableValueUsd: number;
}

export interface SyncStore {
  listItems(): Promise<TrackedItem[]>;
  listOpenDiscrepancies(): Promise<OpenDiscrepancy[]>;
  upsertDiscrepancy(d: {
    nftMint: string;
    kind: DiscrepancyKind;
    inventoryItemId: string | null;
    autoWithheld: boolean;
    details: Record<string, unknown>;
  }): Promise<void>;
  resolveDiscrepancy(id: string): Promise<void>;
  writeSnapshot(s: Snapshot): Promise<void>;
}

export interface SyncDeps {
  listHeld: () => Promise<HeldAsset[]>;
  store: SyncStore;
  chain: Pick<Chain, 'getAsset' | 'hotWallet'>;
  /** setInventoryStatus from @lotus/server; it refuses to touch reserved/sent items. */
  setInventoryStatus: (id: string, status: 'available' | 'withheld') => Promise<void>;
  log: Logger;
}

// While a send is in progress the card may already have left the wallet.
const SEND_IN_PROGRESS = new Set(['processing', 'submitted', 'sent']);

export interface SyncResult extends Snapshot {
  newlyWithheld: number;
  restored: number;
  openDiscrepancies: number;
}

export async function runInventorySync(deps: SyncDeps): Promise<SyncResult> {
  const { store, chain, log } = deps;
  const held = await deps.listHeld();
  const heldByMint = new Map(held.map((h) => [h.mint, h]));
  const items = await store.listItems();
  const itemByMint = new Map(items.map((i) => [i.nftMint, i]));
  const open = await store.listOpenDiscrepancies();

  // Discrepancies found this run, keyed `${mint}:${kind}`.
  const found = new Set<string>();
  let newlyWithheld = 0;
  let restored = 0;

  for (const item of items) {
    const isHeld = heldByMint.has(item.nftMint);

    if (item.status === 'sent' && isHeld) {
      found.add(`${item.nftMint}:sent_but_held`);
      await store.upsertDiscrepancy({
        nftMint: item.nftMint, kind: 'sent_but_held', inventoryItemId: item.id, autoWithheld: false, details: {},
      });
      continue;
    }
    if (isHeld) continue;

    if (item.status === 'available') {
      // The indexer can lag; confirm against chain state before pulling the card from play.
      const asset = await chain.getAsset(item.nftMint);
      if (asset && asset.owner === chain.hotWallet) continue;
      await deps.setInventoryStatus(item.id, 'withheld');
      newlyWithheld++;
      found.add(`${item.nftMint}:missing`);
      await store.upsertDiscrepancy({
        nftMint: item.nftMint, kind: 'missing', inventoryItemId: item.id, autoWithheld: true,
        details: { owner: asset?.owner ?? null },
      });
      log.warn('available card not in hot wallet, withheld it', { mint: item.nftMint, owner: asset?.owner ?? null });
      continue;
    }

    const expectedHeld =
      item.status === 'withheld' || (item.status === 'reserved' && !SEND_IN_PROGRESS.has(item.sendStatus ?? ''));
    if (expectedHeld) {
      found.add(`${item.nftMint}:missing`);
      const prior = open.find((d) => d.nftMint === item.nftMint && d.kind === 'missing');
      await store.upsertDiscrepancy({
        nftMint: item.nftMint, kind: 'missing', inventoryItemId: item.id, autoWithheld: prior?.autoWithheld ?? false,
        details: { status: item.status, sendStatus: item.sendStatus },
      });
    }
  }

  for (const h of held) {
    if (itemByMint.has(h.mint)) continue;
    found.add(`${h.mint}:untracked`);
    await store.upsertDiscrepancy({
      nftMint: h.mint, kind: 'untracked', inventoryItemId: null, autoWithheld: false,
      details: { name: h.name, collection: h.collection },
    });
  }

  // Close discrepancies that no longer apply, and put back cards this sync had withheld.
  for (const d of open) {
    if (found.has(`${d.nftMint}:${d.kind}`)) continue;
    const item = itemByMint.get(d.nftMint);
    if (d.kind === 'missing' && d.autoWithheld && item?.status === 'withheld' && heldByMint.has(d.nftMint)) {
      await deps.setInventoryStatus(item.id, 'available');
      item.status = 'available';
      restored++;
      log.info('card back in hot wallet, made available again', { mint: d.nftMint });
    }
    await store.resolveDiscrepancy(d.id);
  }

  const availableHeld = items.filter((i) => i.status === 'available' && heldByMint.has(i.nftMint));
  const snapshot: Snapshot = {
    hotWallet: chain.hotWallet,
    heldCount: held.length,
    trackedCount: held.filter((h) => itemByMint.has(h.mint)).length,
    availableCount: availableHeld.length,
    availableValueUsd: Math.round(availableHeld.reduce((s, i) => s + i.valueUsd, 0) * 100) / 100,
  };
  await store.writeSnapshot(snapshot);
  log.info('inventory sync done', { ...snapshot, newlyWithheld, restored, open: found.size });
  return { ...snapshot, newlyWithheld, restored, openDiscrepancies: found.size };
}
