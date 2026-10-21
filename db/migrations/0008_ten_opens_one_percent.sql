-- Ten opens a day at a 1% card rate, instead of one open a day at 10%.
--
-- One open a day is a game you touch once and forget. Ten opens at a tenth of the card rate costs
-- about the same per player per day, and the daily prize ceiling in prize_budget_days is what
-- actually bounds the spend, so the number of opens is free to be generous.
--
-- Nothing about where crates are changes: they are still a fixed shared set per launch city, placed
-- by the seeder worker, and the first player to reach one takes it off the map for everyone.

-- Card rate down to 1% on a street crate and 5% on a ticket open (was 10% and 70%). The mix between
-- card tiers is unchanged; every weight is simply scaled down, so the relative chance of a grail
-- given that you won anything is the same as before.
UPDATE odds_config SET weight = w.weight, updated_at = now()
  FROM (VALUES
    ('standard'::crate_kind, 'grail',        50),   -- 0.005%
    ('standard'::crate_kind, 'rare',        500),   -- 0.05%
    ('standard'::crate_kind, 'uncommon',   2000),   -- 0.2%
    ('standard'::crate_kind, 'common',     7450),   -- 0.745%
    ('standard'::crate_kind, 'shards',   990000),   -- 99%
    ('ticket'::crate_kind,   'grail',       350),   -- 0.035%
    ('ticket'::crate_kind,   'rare',       2850),   -- 0.285%
    ('ticket'::crate_kind,   'uncommon',  11050),   -- 1.105%
    ('ticket'::crate_kind,   'common',    35750),   -- 3.575%
    ('ticket'::crate_kind,   'shards',   950000)    -- 95%
  ) AS w(crate_kind, tier, weight)
 WHERE odds_config.crate_kind = w.crate_kind AND odds_config.tier = w.tier;
