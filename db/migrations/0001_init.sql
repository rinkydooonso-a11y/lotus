-- Lotus initial schema. Postgres 15+ with PostGIS.
-- See docs/contracts.md for how these tables are used.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Enums ---------------------------------------------------------------------

CREATE TYPE player_status    AS ENUM ('active', 'frozen');
CREATE TYPE wallet_type      AS ENUM ('external', 'embedded');
CREATE TYPE crate_kind       AS ENUM ('standard', 'ticket');
CREATE TYPE crate_status     AS ENUM ('active', 'opened', 'expired');
CREATE TYPE card_tier        AS ENUM ('common', 'uncommon', 'rare', 'grail');
CREATE TYPE inventory_status AS ENUM ('available', 'reserved', 'sent', 'withheld', 'removed');
CREATE TYPE opening_result   AS ENUM ('card', 'shards');
CREATE TYPE opening_status   AS ENUM ('complete', 'pending', 'sent', 'failed', 'withheld');
CREATE TYPE prize_send_status AS ENUM ('queued', 'processing', 'submitted', 'sent', 'failed', 'withheld');
CREATE TYPE treasury_kind    AS ENUM ('claim', 'purchase', 'topup', 'other');

-- Players & wallets -----------------------------------------------------------

CREATE TABLE players (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status              player_status NOT NULL DEFAULT 'active',
  frozen_reason       text,
  shards              integer NOT NULL DEFAULT 0 CHECK (shards >= 0),
  tickets             integer NOT NULL DEFAULT 0 CHECK (tickets BETWEEN 0 AND 5),
  first_crate_spawned boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE wallets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id   uuid NOT NULL REFERENCES players(id),
  address     text NOT NULL UNIQUE,
  type        wallet_type NOT NULL,
  is_primary  boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wallets_player_idx ON wallets(player_id);
CREATE UNIQUE INDEX wallets_one_primary ON wallets(player_id) WHERE is_primary;

CREATE TABLE player_flags (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id   uuid NOT NULL REFERENCES players(id),
  source      text NOT NULL,           -- e.g. 'anticheat', 'admin'
  reason      text NOT NULL,
  details     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX player_flags_open_idx ON player_flags(player_id) WHERE resolved_at IS NULL;

-- Location ----------------------------------------------------------------------

CREATE TABLE location_pings (
  id          bigserial PRIMARY KEY,
  player_id   uuid NOT NULL REFERENCES players(id),
  location    geography(Point, 4326) NOT NULL,
  accuracy_m  real NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),   -- server time
  client_ts   timestamptz,
  device_id   text NOT NULL,
  ip          inet
);
CREATE INDEX location_pings_player_time_idx ON location_pings(player_id, recorded_at DESC);
CREATE INDEX location_pings_device_idx ON location_pings(device_id, recorded_at DESC);

-- Crates ------------------------------------------------------------------------

CREATE TABLE crates (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location              geography(Point, 4326) NOT NULL,
  spawned_for_player_id uuid NOT NULL REFERENCES players(id),
  kind                  crate_kind NOT NULL DEFAULT 'standard',
  tier_hint             card_tier,
  status                crate_status NOT NULL DEFAULT 'active',
  spawned_at            timestamptz NOT NULL DEFAULT now(),
  expires_at            timestamptz NOT NULL,
  opened_at             timestamptz
);
CREATE INDEX crates_player_active_idx ON crates(spawned_for_player_id) WHERE status = 'active';
CREATE INDEX crates_player_spawned_idx ON crates(spawned_for_player_id, spawned_at DESC);
CREATE INDEX crates_location_idx ON crates USING gist(location);
CREATE INDEX crates_expiry_idx ON crates(expires_at) WHERE status = 'active';

-- Inventory & openings ----------------------------------------------------------------

CREATE TABLE inventory_items (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nft_mint               text NOT NULL UNIQUE,
  card_name              text NOT NULL,
  grade                  text,
  value_usd              numeric(12,2) NOT NULL CHECK (value_usd >= 0),
  tier                   card_tier NOT NULL,
  status                 inventory_status NOT NULL DEFAULT 'available',
  reserved_by_opening_id uuid UNIQUE,
  reserved_at            timestamptz,
  sent_at                timestamptz,
  acquired_at            timestamptz NOT NULL DEFAULT now(),
  image_url              text,
  metadata               jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- reserved/sent items must point at an opening; available items must not
  CHECK ((status IN ('reserved', 'sent')) = (reserved_by_opening_id IS NOT NULL))
);
CREATE INDEX inventory_available_idx ON inventory_items(tier, acquired_at) WHERE status = 'available';

CREATE TABLE crate_openings (
  id                 uuid PRIMARY KEY,
  crate_id           uuid NOT NULL UNIQUE REFERENCES crates(id),
  player_id          uuid NOT NULL REFERENCES players(id),
  wallet_address     text NOT NULL,
  rolled_tier        text NOT NULL,          -- card tier or 'shards', before downgrade
  result             opening_result NOT NULL,
  downgraded         boolean NOT NULL DEFAULT false,
  shards_awarded     integer NOT NULL DEFAULT 0,
  tickets_awarded    integer NOT NULL DEFAULT 0,
  inventory_item_id  uuid UNIQUE REFERENCES inventory_items(id),
  status             opening_status NOT NULL,
  tx_signature       text,
  client_lat         double precision,
  client_lng         double precision,
  client_accuracy_m  real,
  distance_m         real,
  device_id          text,
  ip                 inet,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK ((result = 'card') = (inventory_item_id IS NOT NULL))
);
CREATE INDEX crate_openings_player_idx ON crate_openings(player_id, created_at DESC);

ALTER TABLE inventory_items
  ADD CONSTRAINT inventory_reserved_opening_fk
  FOREIGN KEY (reserved_by_opening_id) REFERENCES crate_openings(id)
  DEFERRABLE INITIALLY DEFERRED;

-- Prize send queue (transactional outbox) ------------------------------------------------

CREATE TABLE prize_sends (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opening_id        uuid NOT NULL UNIQUE REFERENCES crate_openings(id),
  inventory_item_id uuid NOT NULL UNIQUE REFERENCES inventory_items(id),
  player_id         uuid NOT NULL REFERENCES players(id),
  nft_mint          text NOT NULL,
  recipient_address text NOT NULL,
  status            prize_send_status NOT NULL DEFAULT 'queued',
  attempts          integer NOT NULL DEFAULT 0,
  tx_signature      text,
  last_error        text,
  locked_until      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  sent_at           timestamptz
);
CREATE INDEX prize_sends_pending_idx ON prize_sends(created_at)
  WHERE status IN ('queued', 'processing', 'submitted');

-- Tickets ---------------------------------------------------------------------------

CREATE TABLE ticket_spends (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id   uuid NOT NULL REFERENCES players(id),
  crate_id    uuid NOT NULL REFERENCES crates(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Odds ------------------------------------------------------------------------------

CREATE TABLE odds_config (
  crate_kind  crate_kind NOT NULL,
  tier        text NOT NULL CHECK (tier IN ('common', 'uncommon', 'rare', 'grail', 'shards')),
  weight      integer NOT NULL CHECK (weight >= 0),   -- parts per 1,000,000
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (crate_kind, tier)
);

-- Starting odds (see docs/odds.md). Each kind sums to 1,000,000.
INSERT INTO odds_config (crate_kind, tier, weight) VALUES
  ('standard', 'grail',        500),   -- 0.05%
  ('standard', 'rare',        5000),   -- 0.5%
  ('standard', 'uncommon',   20000),   -- 2%
  ('standard', 'common',     74500),   -- 7.45%
  ('standard', 'shards',    900000),   -- 90%
  ('ticket',   'grail',       5000),   -- 0.5%
  ('ticket',   'rare',       40000),   -- 4%
  ('ticket',   'uncommon',  155000),   -- 15.5%
  ('ticket',   'common',    500000),   -- 50%
  ('ticket',   'shards',    300000);   -- 30%

-- Treasury transparency ---------------------------------------------------------------

CREATE TABLE treasury_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          treasury_kind NOT NULL,
  amount        numeric(30,9),
  asset         text,
  usd_value     numeric(14,2),
  tx_signature  text,
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
