# Lotus odds

Rolls use `crypto.randomInt(0, 1_000_000)` against `odds_config` (parts per million), rarest tier first.
A tier with no available cards gets weight 0 and its share moves to shards, so published odds never
promise a card the vault doesn't hold. Live effective odds: `getPublicOdds(kind)`. Change with `setOdds`.

## Starting weights (seeded in 0001_init.sql)

| tier | value band | standard crate | ticket crate |
|---|---|---|---|
| grail | $300+ | 0.05% | 0.5% |
| rare | $75–300 | 0.5% | 4% |
| uncommon | $30–75 | 2% | 15.5% |
| common | <$30 | 7.45% | 50% |
| shards (1–3) | | 90% | 30% |

At these rates one standard crate costs about $2.80 in expected card value (~10% card rate at a ~$20–30
average), before downgrades. Tune to the vault: card rate × opens per day should stay below what the
fee income buys per day.
