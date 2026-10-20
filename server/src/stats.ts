import type { Pool } from 'pg';
import { getPool } from './db';
import { CARD_TIERS, type CardTier, type OpeningView, type VaultStats } from './types';

export async function getPlayerHistory(
  playerId: string,
  opts: { limit?: number } = {},
  db: Pool = getPool(),
): Promise<OpeningView[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const r = await db.query(
    `SELECT o.id, o.crate_id, o.created_at, o.result, o.downgraded, o.shards_awarded, o.tickets_awarded,
            o.status, o.tx_signature,
            i.id AS item_id, i.nft_mint, i.card_name, i.grade, i.value_usd, i.tier, i.image_url
       FROM crate_openings o LEFT JOIN inventory_items i ON i.id = o.inventory_item_id
      WHERE o.player_id = $1 ORDER BY o.created_at DESC LIMIT $2`,
    [playerId, limit],
  );
  return r.rows.map((o) => ({
    id: o.id,
    crateId: o.crate_id,
    createdAt: new Date(o.created_at).toISOString(),
    outcome: o.result,
    downgraded: o.downgraded,
    shardsAwarded: o.shards_awarded,
    ticketsAwarded: o.tickets_awarded,
    status: o.status,
    txSignature: o.tx_signature,
    item: o.item_id
      ? {
          id: o.item_id,
          nftMint: o.nft_mint,
          cardName: o.card_name,
          grade: o.grade,
          valueUsd: Number(o.value_usd),
          tier: o.tier,
          imageUrl: o.image_url,
        }
      : null,
  }));
}

const shortWallet = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

/** Public vault page numbers. */
export async function getVaultStats(db: Pool = getPool()): Promise<VaultStats> {
  const [tiers, openings, winners] = await Promise.all([
    db.query<{ tier: CardTier; status: string; n: number; value: string }>(
      `SELECT tier, status, count(*)::int AS n, coalesce(sum(value_usd), 0) AS value
         FROM inventory_items WHERE status IN ('available', 'reserved', 'sent') GROUP BY tier, status`,
    ),
    db.query<{ n: number }>('SELECT count(*)::int AS n FROM crate_openings'),
    db.query(
      `SELECT o.wallet_address, o.created_at, i.card_name, i.tier, i.value_usd
         FROM crate_openings o JOIN inventory_items i ON i.id = o.inventory_item_id
        WHERE o.result = 'card' ORDER BY o.created_at DESC LIMIT 20`,
    ),
  ]);

  const byTier = CARD_TIERS.map((tier) => ({ tier, available: 0, reserved: 0, sent: 0, availableValueUsd: 0 }));
  let totalSentValueUsd = 0;
  for (const row of tiers.rows) {
    const t = byTier.find((b) => b.tier === row.tier)!;
    if (row.status === 'available') {
      t.available = row.n;
      t.availableValueUsd = Number(row.value);
    } else if (row.status === 'reserved') t.reserved = row.n;
    else {
      t.sent = row.n;
      totalSentValueUsd += Number(row.value);
    }
  }
  return {
    byTier,
    totalAvailable: byTier.reduce((s, t) => s + t.available, 0),
    totalAvailableValueUsd: byTier.reduce((s, t) => s + t.availableValueUsd, 0),
    totalSent: byTier.reduce((s, t) => s + t.sent, 0),
    totalSentValueUsd,
    totalOpenings: openings.rows[0]!.n,
    recentWinners: winners.rows.map((w) => ({
      wallet: shortWallet(w.wallet_address),
      cardName: w.card_name,
      tier: w.tier,
      valueUsd: Number(w.value_usd),
      at: new Date(w.created_at).toISOString(),
    })),
  };
}
