-- Worker-owned tables (prize sender + inventory sync). Source: workers/sql/001_worker_tables.sql.
-- Folded in here so one migrate run sets up everything; edit there and ask the db owner to sync.


-- Every transaction the prize sender has built, written BEFORE broadcast.
-- prize_sends.tx_signature holds only the latest; this keeps what's needed to prove an older one dead.
CREATE TABLE IF NOT EXISTS prize_send_txs (
  signature               text PRIMARY KEY,
  prize_send_id           uuid NOT NULL REFERENCES prize_sends(id),
  last_valid_block_height bigint NOT NULL,
  tx_base64               text NOT NULL,
  state                   text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'landed', 'failed', 'expired')),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS prize_send_txs_send_idx ON prize_send_txs(prize_send_id, created_at);
-- At most one live transaction per prize at any moment.
CREATE UNIQUE INDEX IF NOT EXISTS prize_send_txs_one_pending ON prize_send_txs(prize_send_id) WHERE state = 'pending';

-- Differences between the hot wallet on chain and inventory_items, for the admin page.
CREATE TABLE IF NOT EXISTS inventory_discrepancies (
  id            bigserial PRIMARY KEY,
  nft_mint      text NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('untracked', 'missing', 'sent_but_held')),
  inventory_item_id uuid REFERENCES inventory_items(id),
  auto_withheld boolean NOT NULL DEFAULT false,
  details       jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at   timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS inventory_discrepancies_open ON inventory_discrepancies(nft_mint, kind) WHERE resolved_at IS NULL;

-- On-chain verified vault size over time, for the public "cards in vault" counter.
CREATE TABLE IF NOT EXISTS vault_snapshots (
  id          bigserial PRIMARY KEY,
  taken_at    timestamptz NOT NULL DEFAULT now(),
  hot_wallet  text NOT NULL,
  held_count  integer NOT NULL,          -- prize NFTs in the hot wallet
  tracked_count integer NOT NULL,        -- of those, how many are in inventory_items
  available_count integer NOT NULL,      -- held and status 'available'
  available_value_usd numeric(14,2) NOT NULL
);
