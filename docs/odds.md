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

Expected card value per open at a full stock of average cards (common $25, uncommon $52, rare $187,
grail $500): about $0.41 on a free open and $2.18 on a ticket open. What the stock really holds
depends on the prize pool: a small pool can only buy cheap cards, so rare and grail odds are zero
until the stock has them (an empty tier moves its share to shards).

A player who walks all ten opens costs about $4 a day at a full stock, and banks roughly 20 shards a day.

## The prize pool sets the day's budget

Prizes are paid only from money that has come in.

- **Card fund** (`prize_fund_entries`, USD): the seed money, plus `FEE_CARD_FUND_BPS` (70%) of every
  creator-fee claim priced at claim time, minus what each card purchase cost.
- **Pool** = card fund cash + the cost of the cards in stock. Cards count at what they cost, not their
  insured value, so buying under insured value can't make the pool grow.
- **Day's ceiling** = pool / `LOTUS_POOL_PAYOUT_DAYS` (14), fixed when the day's first card is awarded.
  The ceiling is in insured dollars (what each award books), so it is conservative for cards bought
  below insured value.
- **Released hourly**: by hour *h* (UTC, 0 to 23) at most (*h* + 1) / 24 of the ceiling can have been
  awarded. Unused amounts carry into later hours of the same day, never to tomorrow.
- Past the ceiling, or the `LOTUS_MAX_CARDS_PER_DAY` sanity stop (1000), card tiers roll 0 and opens pay shards.
- `LOTUS_MAX_CARD_VALUE_PER_DAY` is an emergency dial: a fixed dollar ceiling that replaces the pool-based one (0 = off).

Other bounds still apply, and they multiply: crates that exist (`cratesPerCity` x cities, `maxWorldCratesPerDay`)
and opens per player (`freeOpensPerDay`, 10, plus banked tickets).

| Pool | Day's ceiling | Biggest card the buyer will pay for |
|---|---|---|
| $750 (seed only) | $53.57 | $53.57 |
| $9,800 | $700 | $700 |
| $69,000 | $4,929 | $1,000 (hard top) |

If fees stop, the pool shrinks as cards are won and the ceiling falls with it, so prizes fade out over
weeks. If the coin booms, the ceiling rises with the pool. Nothing is ever owed.
