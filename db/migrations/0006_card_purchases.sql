-- Card buyer: every marketplace purchase, written as 'sending' before the transaction is broadcast
-- so a crash can be settled from chain state. Holds what the inventory row needs once it lands.

CREATE TABLE card_purchases (
  id                bigserial PRIMARY KEY,
  nft_mint          text NOT NULL,
  seller            text NOT NULL,
  price_lamports    bigint NOT NULL CHECK (price_lamports > 0),
  sol_usd           numeric(12,4) NOT NULL CHECK (sol_usd > 0),
  card_name         text NOT NULL,
  grade             text,
  value_usd         numeric(12,2) NOT NULL CHECK (value_usd >= 0),
  tier              card_tier NOT NULL,
  image_url         text,
  tx_signature      text NOT NULL UNIQUE,
  status            text NOT NULL CHECK (status IN ('sending', 'bought', 'failed')),
  note              text,
  inventory_item_id uuid REFERENCES inventory_items(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
-- A card can only be bought once.
CREATE UNIQUE INDEX card_purchases_mint_live ON card_purchases (nft_mint) WHERE status <> 'failed';
CREATE INDEX card_purchases_sending ON card_purchases (created_at) WHERE status = 'sending';

ALTER TABLE card_purchases ENABLE ROW LEVEL SECURITY;
