# Decisions

## Game server (2026-10-20, crates reworked 2026-10-21)
- Crates are shared world crates, not per-player spawns. A seeder worker (`seedWorldCrates`, every 5 min) keeps 15 active crates alive in each launch city; a crate belongs to nobody, the first player to reach one opens it, and that takes it off the map for everyone. 12 h TTL, replaced by the seeder.
- Why: the old design spawned up to 40 crates per player per day, so the prize cost grew with every player added. With a fixed set of crates the day's payout is bounded by how many crates exist, not by how many people play. Dials: `LOTUS_CRATES_PER_CITY`, `LOTUS_MAX_CRATES_PER_DAY` (hard global ceiling on crates created per UTC day, default 250), `LOTUS_CRATE_TTL_MIN`.
- One free open per player per UTC day (`LOTUS_FREE_OPENS_PER_DAY`). Every further open that day spends a ticket and rolls on the better `ticket` odds. Enforced by a conditional write on `player_open_days` in the open transaction, so two simultaneous opens can't both take the free one or the last ticket.
- Tickets are spent by opening, not by a button, so a ticket can't be wasted on a crate the player never reaches. 10 shards still convert to a ticket while tickets < 5, and spending one frees room for banked shards to convert.
- Daily prize budget as a circuit breaker: `LOTUS_MAX_CARDS_PER_DAY` (10) and `LOTUS_MAX_CARD_VALUE_PER_DAY` (300 USD). Each card is booked against `prize_budget_days` inside the open transaction, so the ceiling is exact even when wins land at the same instant; a card that would go over is put back under a SAVEPOINT. Past either ceiling the card tiers roll 0 and opens pay shards, and `getPublicOdds` reports that, so the published odds never promise what can't be paid.
- Losing a race is not a punishment: the loser keeps their daily open and anti-cheat hands back the cooldown and daily quota (`ValidateResult.release`).
- Walkable placement (`server/src/walkable.ts`): crates land on OpenStreetMap footways, pedestrian streets, paths, parks, gardens, playgrounds and plazas, never in lakes/rivers/coast (12 m buffer), and no two active crates within 120 m (`LOTUS_CRATE_SPACING_M`) so a cluster can't be cleared from one spot. Motorways, roads, crossings, bridges, tunnels and private-access ways are never queried.
- Source is the public Overpass API (no account or key), two mirrors, queried per ~400 m grid cell, cached 6 h in memory (600 cells), requests spaced 600 ms apart. The seeder makes at most `CRATE_SEED_MAX_ANCHORS` (8) lookups per tick and converges over several ticks. Set `OVERPASS_URLS` to point at a self-hosted or paid instance; `WALKABLE_SPAWNS=off` disables it. Tests skip it unless `WALKABLE_SPAWNS=on`.
- If Overpass is slow, down or rate limiting the seeder places nothing and logs it: an empty patch of map beats a crate in a lake or on a motorway. Crates already out live 12 h, which gives the next ticks time. After all mirrors fail Overpass is skipped for 60 s. Known gaps: multipolygon holes and unclosed relation rings are ignored, buildings are not excluded inside parks.
- Reading the map creates nothing, so a location ping is one indexed query with no Overpass call in the request path.
- Open radius 40 m, enforced by core in SQL (`ST_DWithin`) inside the open transaction. Movement/cooldowns/caps belong to anti-cheat.
- Empty crate pays 1–3 shards. Empty tier at roll time downgrades to shards, never a lower card tier.
- Prize sends use a transactional outbox (`prize_sends`), written in the same transaction as the win.
- Known trade: a player with no crate within walking distance has nothing to do that day. More crates per city is the dial, at a known cost per day.

## Treasury (2026-10-20)
- Design: Squads safe holds funds and most cards; the hot wallet holds about a day of prizes. Bots may only propose Squads transactions or call permissionless pump.fun instructions; signers approve every move out of the safe. Full write-up in the "CardQuest treasury and money flow" doc.
- `inventory_items.location` (`hot`/`vault`, migration 0003). Vault cards are tracked but never awardable; inventory sync moves them to `hot`/`available` once they land in the hot wallet (confirmed on chain, not just DAS).
- `SQUADS_VAULT_ADDRESS` (optional, read-only) lets inventory sync report vault cards that neither wallet holds.
- Card buying stays manual at launch. The admin form records cost and purchase tx, which writes a `purchase` treasury event.
- Plan prize math at pump.fun's documented creator fee: 0.30% before graduation, and 0.95% once the coin is on PumpSwap, stepping down as market cap grows. Re-check the live pump.fun fee page before launch, since pump.fun sets these.
- Do not enable "Holder Rewards" at launch. Fee sharing is set to 100% to the Squads vault, and that setting is one-time and permanent.
- Top-ups are one Squads batch proposal per top-up (one approval moves many cards). Drafted by an Initiate-only key; the worker refuses a key that can vote or execute.
- Fee claiming uses pump.fun's official SDK and only the permissionless distribution path, so it needs a fee-sharing config with the vault as a shareholder.
- Treasury events are written by the code that causes them (purchase form, top-up execution, fee claim) rather than by a chain watcher.
