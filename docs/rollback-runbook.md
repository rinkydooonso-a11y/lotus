# Rollback and outage runbook

Each section: how you notice, what players see, what to do. Health at a glance: `GET /api/health`
(200 = all good; the JSON says which of `db`, `redis`, `worker`, `prizeQueue` is red).

## Stop switches (use first, investigate second)

| Switch | Effect | How |
| --- | --- | --- |
| Stop all prize sends | Wins keep recording and queue safely; nothing leaves the hot wallet | `fly scale count 0 -a lotus-workers` (resume: `fly scale count 1 -a lotus-workers`) |
| Pull one card | It can no longer be won | `/admin` inventory > `withheld` |
| Freeze a player | Their opens are refused and unsent prizes held | `/admin` flagged > freeze |
| Disable walkable spawns | Crates spawn without the Overpass footpath check | Vercel env `WALKABLE_SPAWNS=off`, redeploy |
| Tighten anti-cheat | Lower caps or longer cooldowns | Vercel env `LOTUS_AC_*` (see `.env.example`), redeploy |

## Bad web deploy

Notice: errors right after a deploy, health red, players reporting.
1. Vercel > Project > Deployments > the last good one > **Promote to Production**. Takes under a minute and does
   not rebuild. Nothing in the database is touched.
2. Revert the bad commit on `main` (`git revert <sha>`) so the next auto-deploy doesn't bring it back.

## Bad worker deploy

Notice: `worker` red in health, or prize sends stuck (`prizeQueue` red), or `fly logs -a lotus-workers` shows a crash loop.
1. `fly releases -a lotus-workers` and find the last good image, then
   `fly deploy -c fly.workers.toml --image <that image> --ha=false`.
2. If unsure, stop sends first (`fly scale count 0`). Wins queue; nothing is lost. A card whose send was
   mid-flight is resolved on restart: the sender checks every transaction it logged before broadcasting.
3. Never run two worker machines. The DB lock refuses a second prize sender, but don't test it.

## Bad migration

Migrations are forward-only and additive. Before applying one to production, take a manual backup
(Actions > db-backup > Run workflow), and apply to a Supabase branch or a local copy first.
- A migration that failed rolls back by itself (each file runs in one transaction).
- A migration that applied but broke the app: roll the web back (above), then write a new migration that undoes it.
- Data damaged: restore (below).

## Restore the database

With Supabase Pro: Dashboard > Database > Backups > pick a daily backup > Restore (the project is read-only for a few minutes).

From the nightly GitHub backup (any plan):
1. Actions > db-backup > latest successful run > download the artifact (kept 7 days), then decrypt it with the
   passphrase from your password manager: `gpg --decrypt lotus-<date>.dump.gpg > lotus-<date>.dump`.
2. Stop the worker (`fly scale count 0`) so nothing writes during the restore.
3. Restore into a fresh Supabase project first and check it, then point `DATABASE_URL` (Vercel and Fly) at it:
   `pg_restore --no-owner --no-privileges -d "<session pooler URL>" lotus-<date>.dump`
4. Location pings are left out of the dump on purpose (large, only the last 6 h matter). Anti-cheat simply starts
   fresh anchors.
5. Reconcile prizes: compare `prize_sends` with the hot wallet's history on the explorer for the gap since the dump.
   Every send is on chain, so nothing a player won can be lost, only the record of it.

## Service outages

| Down or slow | What players see | What the app does | What you do |
| --- | --- | --- | --- |
| Postgres | Map shows no crates; opens fail with "try again" | Requests fail within 5 s (connection timeout), no crash; recovers by itself when the DB is back | Supabase status page; nothing else needed |
| Redis (Upstash) | Opens refused with "CardQuest is busy right now", map still works | Anti-cheat fails closed in about 0.1 s: no open can skip the checks | Upstash console: check the monthly command limit first |
| Overpass | Crates spawn slightly slower and may sit off footpaths | Gives up after 3 s and uses a short nudge; backs off for a while | `WALKABLE_SPAWNS=off` if it lasts |
| Helius | Prize sends arrive late; new-wallet checks are skipped | Sends retry; wallet-age and funder signals are skipped (other checks still run) | Helius dashboard: rate limit or credits |
| Fly worker | Wins show "pending" longer | Restarts automatically on crash; health turns red after 15 min | `fly status -a lotus-workers`, `fly machine restart` |
| Map tiles | Grey map, crates still shown | Nothing | Point the map at another tile provider (MapTiler, Stadia) and redeploy |

## Yearly checks

- The pinned Supabase CA in `server/src/pgSsl.ts` expires April 2031. Refresh it before then.
- Rotate `LOTUS_SESSION_SECRET` if it may have leaked (signs everyone out).
