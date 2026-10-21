# Load test

`deploy/loadtest/run.mjs` simulates players: each signs in with a throwaway wallet, walks toward the nearest
crate at 1.4 m/s, pings `/api/crates` like the map does, and opens crates in range. It writes real rows, so it
runs only against localhost, or a preview with its own database (`LOADTEST_ALLOW_REMOTE=1`). It refuses the
production URL.

```
cd deploy/loadtest && npm install
node run.mjs --url http://localhost:3000 --players 300 --minutes 3 --ping-ms 15000
```

## Results (2026-10-20, local copy)

Setup: one `next start` process (4 vCPU container), local Postgres 16 + PostGIS, local Redis behind an Upstash
REST shim, no Helius. Pings every 15 s. The simulated
players open far more often than real ones (crates are close and they walk straight at them), so open load is
pessimistic.

| Players | Pings/s | Opens/s | Ping p50 / p95 | Open p50 / p95 | Errors |
| --- | --- | --- | --- | --- | --- |
| 300 | 17.6 | 7.1 | 9 / 16 ms | 27 / 43 ms | 0 |
| 1,000 | 56 | 23 | 9 / 1,574 ms | 38 / 4,757 ms | 0 |

- At 1,000 players the single Node process was the bottleneck (CPU), not the database: Postgres spent 7.2 s of
  query time over 3 minutes (about 4% of one core). On Vercel, requests spread over many instances instead.
- Database cost: about **150 ms of query time per player-hour** (most of it the crate spawn and the open
  transaction). Even with a 10x slowdown on Supabase's smallest compute, that is well over 1,000 concurrent
  players before the database CPU is the limit; connections (200 through the pooler, 3 per Vercel instance) and
  plan quotas run out first.
- Redis cost: **about 14 commands per open**, 0 per ping (15 with Helius wallet lookups). 500K free commands
  a month is about 1,100 opens a day.
- Vercel cost: 240 function calls per player-hour at a 15 s ping (was 720 at 5 s).

## Outage drills (30 players, pings every 5 s)

| Drill | Result |
| --- | --- |
| Redis killed mid-run | 56 opens refused with "CardQuest is busy right now" in about 110 ms each; map pings unaffected; recovered when Redis returned. `/api/health` went 503 in 0.1 s. |
| Postgres stopped for 20 s | 120 pings got 503 quickly, no hangs or crashes; everything recovered without a restart once Postgres was back. `/api/health` went 503. |

## Not yet covered

- The real Supabase pooler and Vercel cold starts: rerun against a Vercel preview pointed at a Supabase branch
  (never the production database) before a big launch.
- The public `/api/feed` from the redesign, once it is on `main`; it should be CDN-cached for a few seconds.
