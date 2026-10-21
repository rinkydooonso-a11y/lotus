-- The coin holder gate: a wallet must hold at least LOTUS_HOLD_REQUIRED_USD (default $25) of our
-- coin to open a crate. Dormant until COIN_MINT is set, so this migration is safe to apply before
-- the coin exists.
--
-- One row per player, holding their current 48 h qualifying window. The token amount is snapshotted
-- when the window opens, so a price move during the window never changes what somebody has to hold;
-- dropping below that snapshotted amount locks them out for the rest of the window.
--
-- The window is keyed on the player, not the wallet, so moving the coin to a second wallet cannot
-- clear a lockout. required_tokens is in base units, which is why it is numeric(40,0) and not bigint:
-- a pump.fun coin has 6 decimals and a supply of 1e9, so a whole-supply holding is 1e15 base units,
-- and a coin with 9 decimals would be 1e18 — still inside bigint, but not by a margin worth trusting.

CREATE TABLE IF NOT EXISTS holder_windows (
  player_id       uuid PRIMARY KEY REFERENCES players(id),
  wallet_address  text NOT NULL,
  mint            text NOT NULL,
  started_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  /** What they had to hold when the window opened, in base units. Fixed for the window. */
  required_tokens numeric(40,0) NOT NULL CHECK (required_tokens > 0),
  required_usd    numeric(12,2) NOT NULL CHECK (required_usd > 0),
  /** Coin price in USD at the snapshot, kept so a support question can be answered. */
  price_usd       numeric(24,12) NOT NULL CHECK (price_usd > 0),
  decimals        smallint NOT NULL CHECK (decimals BETWEEN 0 AND 18),
  /** Balance at the most recent check, in base units. */
  tokens_held     numeric(40,0) NOT NULL CHECK (tokens_held >= 0),
  checked_at      timestamptz NOT NULL DEFAULT now(),
  /** Set when a re-check found them under required_tokens. Blocks opens until expires_at. */
  locked_out_at   timestamptz
);

-- For the sweep that clears windows nobody is using any more.
CREATE INDEX IF NOT EXISTS holder_windows_expires_idx ON holder_windows(expires_at);

ALTER TABLE holder_windows ENABLE ROW LEVEL SECURITY;
