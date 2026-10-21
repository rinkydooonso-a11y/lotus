-- World crates: one shared set of crates per launch city, first player to reach one takes it.
--
-- Before this migration every crate belonged to one player (crates.spawned_for_player_id) and the
-- map spawned fresh ones on every location ping, so the daily prize cost grew with the number of
-- players. Now a seeder worker keeps a fixed number of crates alive per city, any player can open
-- any crate, and opening it removes it for everyone. Total payout is bounded by how many crates
-- exist, not by how many people play.

-- Crates ----------------------------------------------------------------------------------

-- World crates have no owner. The column stays for the historical rows.
ALTER TABLE crates ALTER COLUMN spawned_for_player_id DROP NOT NULL;
ALTER TABLE crates ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE crates ADD COLUMN IF NOT EXISTS claimed_by_player_id uuid REFERENCES players(id);

-- A world crate must belong to a city and have no owner; a legacy personal crate is the other way round.
ALTER TABLE crates ADD CONSTRAINT crates_owner_xor_city
  CHECK ((spawned_for_player_id IS NULL) = (city IS NOT NULL));

-- Personal crates still on the map can no longer be opened: they are not in any city's set.
UPDATE crates SET status = 'expired' WHERE status = 'active' AND spawned_for_player_id IS NOT NULL;

DROP INDEX IF EXISTS crates_player_active_idx;
DROP INDEX IF EXISTS crates_player_spawned_idx;
-- Seeder: how many crates are alive in each city.
CREATE INDEX IF NOT EXISTS crates_city_active_idx ON crates(city) WHERE status = 'active';
-- Nearby lookup and the minimum-spacing check at insert time.
CREATE INDEX IF NOT EXISTS crates_active_location_idx ON crates USING gist(location) WHERE status = 'active';
-- Global cap on crates created per UTC day.
CREATE INDEX IF NOT EXISTS crates_spawned_at_idx ON crates(spawned_at);

-- Openings --------------------------------------------------------------------------------

-- Which odds table the roll used. A player's first open each day is 'standard'; every further open
-- that day spends a ticket and rolls on the better 'ticket' odds.
ALTER TABLE crate_openings ADD COLUMN IF NOT EXISTS roll_kind crate_kind NOT NULL DEFAULT 'standard';
ALTER TABLE crate_openings ADD COLUMN IF NOT EXISTS ticket_spent boolean NOT NULL DEFAULT false;
-- Set when the card tiers were zeroed because the day's prize budget was spent, so an admin can
-- tell a budget downgrade from an out-of-stock one.
ALTER TABLE crate_openings ADD COLUMN IF NOT EXISTS budget_capped boolean NOT NULL DEFAULT false;

-- Feeds the daily prize-budget circuit breaker, which counts today's card wins on every open.
CREATE INDEX IF NOT EXISTS crate_openings_card_day_idx ON crate_openings(created_at) WHERE result = 'card';

-- Daily open allowance --------------------------------------------------------------------

-- One row per player per UTC day. The free open is consumed by a conditional UPDATE inside the
-- open transaction, so two simultaneous opens can never both take it.
CREATE TABLE IF NOT EXISTS player_open_days (
  player_id    uuid NOT NULL REFERENCES players(id),
  open_day     date NOT NULL,
  opens_used   integer NOT NULL DEFAULT 0 CHECK (opens_used >= 0),
  free_used    integer NOT NULL DEFAULT 0 CHECK (free_used >= 0),
  tickets_used integer NOT NULL DEFAULT 0 CHECK (tickets_used >= 0),
  first_open_at timestamptz NOT NULL DEFAULT now(),
  last_open_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, open_day)
);

-- Daily prize budget -----------------------------------------------------------------------

-- One row per UTC day, written only when a card is actually awarded. The open transaction claims a
-- slot with a conditional UPDATE, so the day's ceiling is exact even when wins land at the same
-- moment; opens that pay shards never touch this row, so it is not a bottleneck.
CREATE TABLE IF NOT EXISTS prize_budget_days (
  budget_day        date PRIMARY KEY,
  cards_awarded     integer NOT NULL DEFAULT 0 CHECK (cards_awarded >= 0),
  value_awarded_usd numeric(14,2) NOT NULL DEFAULT 0 CHECK (value_awarded_usd >= 0),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Tickets are now spent at the moment of opening, so nothing spawns a crate any more.
-- ticket_spends is kept for the historical rows; crate_id becomes optional.
ALTER TABLE ticket_spends ALTER COLUMN crate_id DROP NOT NULL;
ALTER TABLE ticket_spends ADD COLUMN IF NOT EXISTS opening_id uuid REFERENCES crate_openings(id);

-- first_crate_spawned described the old per-player spawner and nothing reads it now.
ALTER TABLE players DROP COLUMN IF EXISTS first_crate_spawned;

-- Same defence in depth as 0005: owned by the app role, which bypasses RLS, so no policies needed.
ALTER TABLE player_open_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE prize_budget_days ENABLE ROW LEVEL SECURITY;
