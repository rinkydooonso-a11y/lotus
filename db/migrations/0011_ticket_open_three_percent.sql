-- Ticket opens pay a card 3% of the time, down from 5%. Free opens stay at 1%.
-- Every ticket weight is scaled by the same factor (0.6), so the mix between card tiers is unchanged.
UPDATE odds_config SET weight = w.weight, updated_at = now()
  FROM (VALUES
    ('ticket'::crate_kind, 'grail',        210),   -- 0.021%
    ('ticket'::crate_kind, 'rare',        1710),   -- 0.171%
    ('ticket'::crate_kind, 'uncommon',    6630),   -- 0.663%
    ('ticket'::crate_kind, 'common',     21450),   -- 2.145%
    ('ticket'::crate_kind, 'shards',    970000)    -- 97%
  ) AS w(crate_kind, tier, weight)
 WHERE odds_config.crate_kind = w.crate_kind AND odds_config.tier = w.tier;
