# Lotus odds

Rolls use `crypto.randomInt(0, 1_000_000)` against `odds_config` (parts per million), rarest tier first.
A tier with no available cards gets weight 0 and its share moves to shards, so published odds never
promise a card the vault doesn't hold. The same happens to every card tier once the day's prize budget
is spent. Live effective odds: `getPublicOdds(kind)`. Change with `setOdds`.

Which table a roll uses depends on the open, not on the crate: every world crate is the same. A player's
free open of the day rolls on `standard`; an open that spends a ticket rolls on `ticket`.

## Starting weights (seeded in 0001_init.sql)

| tier | value band | free open (standard) | ticket open |
|---|---|---|---|
| grail | $300+ | 0.05% | 0.5% |
| rare | $75–300 | 0.5% | 4% |
| uncommon | $30–75 | 2% | 15.5% |
| common | <$30 | 7.45% | 50% |
| shards (1–3) | | 90% | 30% |

## What a day costs

Expected card value per open, at a full vault (common $25, uncommon $52, rare $187, grail $500):

- free open: about $4.10
- ticket open: about $30.50

With the card buyer capped at $25 a card it can only stock commons, so in practice today a free open is
about $1.86 and a ticket open about $12.50 until rare and grail stock comes from somewhere else.

Three things bound the day, and they multiply in this order:

1. **Crates that exist.** `cratesPerCity` x cities, replaced as they are claimed, with a hard ceiling of
   `maxWorldCratesPerDay` crates created per UTC day. Nothing a player does raises this.
2. **Opens per player.** `freeOpensPerDay` (1) plus banked tickets. Tickets are earned from shards, which
   only come from opens, so one player trends to about 1.2 opens a day.
3. **The circuit breaker.** `maxCardsPerDay` and `maxCardValueUsdPerDay`. Past either, card tiers roll 0
   and opens pay shards for the rest of the UTC day. This is the only one that is a hard dollar stop, and
   it is exact: each card is booked against `prize_budget_days` inside the open transaction.

So the budget to plan against is the breaker, not the odds: at the defaults (10 cards, $300) the most a
day can pay is $300. Set those two from what fee income actually buys per day, then set the crate count
for how busy the map should feel.
