-- Prize fund: prizes are paid only from money that has already come in.
--
-- prize_fund_entries is the card fund's cash ledger in US dollars: the seed money, the card share
-- of every fee claim (positive), and what each card purchase cost (negative). The pool the game
-- pays from is the fund's cash plus the cost of the cards in stock. The day's prize ceiling is a
-- fraction of that pool (see server/src/odds.ts), so every limit scales with what has come in.
--
-- 'ref' makes an entry idempotent: a fee claim is keyed by its transaction signature, a purchase
-- by its card_purchases id, so a retry can never count the same money twice.

CREATE TABLE prize_fund_entries (
  id          bigserial PRIMARY KEY,
  kind        text NOT NULL CHECK (kind IN ('seed', 'fee_share', 'purchase', 'adjust')),
  usd         numeric(14,2) NOT NULL,
  ref         text,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- money in is positive, a purchase is negative; seed and fee shares can never be negative
  CHECK ((kind IN ('seed', 'fee_share') AND usd > 0) OR (kind = 'purchase' AND usd < 0) OR kind = 'adjust')
);
CREATE UNIQUE INDEX prize_fund_entries_ref ON prize_fund_entries (kind, ref) WHERE ref IS NOT NULL;

-- The ceiling for a UTC day is fixed when the day's first card is awarded (pool / payout days),
-- so later fee claims and purchases don't move it mid-day.
ALTER TABLE prize_budget_days ADD COLUMN ceiling_usd numeric(14,2);

ALTER TABLE prize_fund_entries ENABLE ROW LEVEL SECURITY;
