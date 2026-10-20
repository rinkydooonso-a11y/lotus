-- Where each card physically is. Only cards in the hot wallet can be awarded; the rest sit in
-- the Squads vault until a top-up moves them. Inventory sync flips a vault card to 'hot' and
-- 'available' once it lands in the hot wallet.

CREATE TYPE inventory_location AS ENUM ('hot', 'vault');

ALTER TABLE inventory_items
  ADD COLUMN location inventory_location NOT NULL DEFAULT 'hot',
  -- What we paid, for the treasury page. value_usd stays the prize value used for tiers.
  ADD COLUMN cost_usd numeric(12,2) CHECK (cost_usd >= 0);

-- A vault card can never be in play: the odds roller only reserves 'available' cards.
ALTER TABLE inventory_items
  ADD CONSTRAINT inventory_vault_not_in_play CHECK (location = 'hot' OR status IN ('withheld', 'removed'));

-- Lets a purchase or top-up point at the card it concerns.
ALTER TABLE treasury_events
  ADD COLUMN inventory_item_id uuid REFERENCES inventory_items(id);
CREATE INDEX treasury_events_created_idx ON treasury_events(created_at DESC);
