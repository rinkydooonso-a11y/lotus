# Lotus odds

Rolls use `crypto.randomInt(0, 1_000_000)` against `odds_config` (parts per million), rarest tier first.
A tier with no available cards gets weight 0 and its share moves to shards, so published odds never
promise a card the vault doesn't hold. The same happens to every card tier once the day's prize budget
is spent. Live effective odds: `getPublicOdds(kind)`. Change with `setOdds`.

Which table a roll uses depends on the open, not on the crate: every world crate is the same. A free
open rolls on `standard`; an open that spends a ticket rolls on `ticket`.

## Weights (seeded in 0001_init.sql, cut to these in 0008_ten_opens_one_percent.sql)

| tier | value band | free open (standard) | ticket open |
|---|---|---|---|
| grail | $300+ | 0.005% | 0.035% |
| rare | $75–300 | 0.05% | 0.285% |
| uncommon | $30–75 | 0.2% | 1.105% |
| common | <$30 | 0.745% | 3.575% |
| **any card** | | **1%** | **5%** |
| shards (1–3) | | 99% | 95% |

A street crate paying a card 1 in 100 times is the point, not a stinginess setting: ten opens a day at
1% and one open a day at 10% cost the same per player, but the first is a game you keep playing. The
mix between card tiers is the same at both rates — every weight was scaled by the same factor — so a
card you do win is as likely to be a grail as it ever was. `money.test.ts` asserts both rates, so a
weight typo in a later migration fails the suite.

## What a day costs

Expected card value per open, at a full vault (common $25, uncommon $52, rare $187, grail $500):

- free open: about $0.41
- ticket open: about $2.18

With the card buyer capped at $25 a card it can only stock commons, so in practice today a free open is
about $0.19 and a ticket open about $0.89 until rare and grail stock comes from somewhere else.

A player who walks to all ten of their opens therefore costs about $4.10 a day at a full vault, and
banks roughly 20 shards a day, so a little under one ticket.

Three things bound the day, and they multiply in this order:

1. **Crates that exist.** `cratesPerCity` x cities, replaced as they are claimed, with a hard ceiling of
   `maxWorldCratesPerDay` crates created per UTC day. Nothing a player does raises this: crates are
   placed only in the launch cities, by the seeder, and never because a player turned up somewhere.
2. **Opens per player.** `freeOpensPerDay` (10) plus banked tickets. Tickets are earned from shards,
   which only come from opens, so one player trends to about 11 opens a day.
3. **The circuit breaker.** `maxCardsPerDay` and `maxCardValueUsdPerDay`. Past either, card tiers roll 0
   and opens pay shards for the rest of the UTC day. This is the only one that is a hard dollar stop, and
   it is exact: each card is booked against `prize_budget_days` inside the open transaction.

So the budget to plan against is the breaker, not the odds: at the defaults the most a day can pay is
**$400**, whether ten people play or ten thousand. That dollar figure is the dial to set from what fee
income actually buys per day. The 25-card count beside it is only a sanity stop for a vault full of
cheap cards, and it is deliberately above what $400 of average cards comes to ($400 / $35 is about 11),
so the dollar ceiling is what binds. Then set the crate count for how busy the map should feel.

At a 1% card rate, $400 is roughly 95 players walking all ten of their opens. Below that the breaker
never fires and nobody can tell it is there.
