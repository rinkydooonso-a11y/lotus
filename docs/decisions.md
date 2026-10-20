# Decisions

## Game server (2026-10-20)
- Crates spawn wherever the player is (anywhere in the world), 3 active per player, 40 spawns/player/UTC day, 30 min expiry. First crate on the player's position, the rest 40–250 m away.
- Walkable spawns (`server/src/walkable.ts`): the 2nd and 3rd crate land on OpenStreetMap footways, pedestrian streets, paths, parks, gardens, playgrounds and plazas, 40-250 m away, at least 30 m apart, never in lakes/rivers/coast (12 m buffer). Motorways, roads, crossings, bridges, tunnels and private-access ways are never queried. The player's first crate still spawns where they stand.
- Source is the public Overpass API (no account or key), two mirrors, queried per ~400 m grid cell, cached 6 h in memory (600 cells), requests spaced 600 ms apart, 3 s wait budget per spawn call, fetched before the DB transaction. Set `OVERPASS_URLS` (comma list) to point at a self-hosted or paid instance; `WALKABLE_SPAWNS=off` disables it. Tests skip it unless `WALKABLE_SPAWNS=on`.
- If Overpass is slow, down or rate limiting: the call falls back to a nudge of 40-90 m from the player (who is presumably standing on walkable ground), after all mirrors fail Overpass is skipped for 60 s, and the next spawn retries. Known water is avoided in the nudge when map data is present. Fallback can still hit a road or private yard. Known gaps: multipolygon holes and unclosed relation rings are ignored, buildings are not excluded inside parks.
- Active crates more than 2 km from the player's latest position are retired so new ones spawn nearby.
- Open radius 40 m, enforced by core in SQL (`ST_DWithin`) inside the open transaction. Movement/cooldowns/caps belong to anti-cheat.
- Empty crate pays 1–3 shards. 10 shards auto-convert to a ticket while tickets < 5; extra shards are banked, not lost.
- A ticket spawns a ticket crate at the player's position with better odds (our guess at Collect's mechanic).
- Empty tier at roll time downgrades to shards, never a lower card tier.
- Prize sends use a transactional outbox (`prize_sends`), written in the same transaction as the win.
