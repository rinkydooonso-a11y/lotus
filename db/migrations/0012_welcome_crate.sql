-- Welcome crate: every player gets exactly one crate next to them the first time they connect.
-- It is theirs alone (spawned_for_player_id, no city), always pays shards, and costs no daily open.
-- After that the only crates are the shared city crates.
ALTER TABLE crates ADD COLUMN IF NOT EXISTS welcome boolean NOT NULL DEFAULT false;

-- One per player, ever: the index is what makes the insert race-safe, and it holds after the crate
-- is opened or expires, so nobody can earn a second one.
CREATE UNIQUE INDEX IF NOT EXISTS crates_welcome_player_uniq ON crates (spawned_for_player_id) WHERE welcome;
