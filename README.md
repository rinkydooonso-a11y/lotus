# CardQuest (repo: lotus)

CardQuest is a location-based crate-collecting game (GoCollect style): walk to crates on a map, open them, win shards, tickets and real NFT trading cards sent to your Solana wallet.

The user-facing brand is CardQuest (X: [@cardquestsol](https://x.com/cardquestsol)); the repo, Vercel project, Fly app and database keep the name lotus.

Source of truth: this GitHub repo (rinkydooonso-a11y/lotus). The repo root is the folder shown below.

## Layout

```
lotus/                  <- this folder is the git repo root
  web/                  Next.js 14 app (map, wallet login, API routes, /admin). Deploys to Vercel.
  server/               Game logic as a library (spawner, odds, open-crate, prize queue) + anti-cheat/
    anticheat/          Movement, cooldown, sybil checks (uses Upstash Redis + optional Helius)
    scripts/migrate.ts  Applies db/migrations in order
  workers/              Always-on process: prize sender, inventory sync, crate expiry, ping cleanup, treasury jobs. Deploys to Fly.io.
  db/migrations/        SQL schema (Postgres + PostGIS)
  deploy/
    workers.Dockerfile  Image for the workers (build context = repo root)
    devnet/             Script that mints test pNFT + Core NFTs on devnet
  fly.workers.toml      Fly app config for the workers (app lotus-workers)
  .github/workflows/    Nightly encrypted database backup
  docs/                 contracts, decisions, odds, research, launch-runbook, mainnet-cutover, rollback-runbook
  .env.example          Every environment variable, what it is for, where to get it
```

`web` imports `server` straight from source (see `web/next.config.mjs`), and `workers` depends on `server` via `file:../server`. Keep the folders side by side.

## Hosting choices

| Part | Host | Why |
|---|---|---|
| web | Vercel (root directory `web`, with "include source files outside root directory" on) | Next.js native |
| database | Supabase Postgres with PostGIS | `ST_DWithin` is used for crate open radius |
| anti-cheat state | Upstash Redis | HTTP-based, works in serverless |
| chain access | Helius (RPC + DAS) | sends and inventory listing |
| workers | Fly.io, app `lotus-workers` (exactly one Machine) | long-lived process, deployed with `fly deploy -c fly.workers.toml --ha=false` |
| backups | GitHub Actions `db-backup` | nightly encrypted `pg_dump`, kept as a private artifact |
| treasury | Squads multisig vault | holds funds and most cards; see `docs/decisions.md` |

## Local quick start

```
cd web && npm install && LOTUS_USE_STUB=1 npm run dev     # demo mode, no database or keys needed
```

Real game locally: set `DATABASE_URL`, `LOTUS_USE_STUB=0` in `web/.env.local`, run `cd server && npm install && npm run migrate`.

## Deploying

Follow `docs/launch-runbook.md`; for the switch to real money use `docs/mainnet-cutover.md`; for incidents use `docs/rollback-runbook.md`. Uptime monitors can poll `GET /api/health` (200 healthy, 503 not). In short: create accounts, run migrations, deploy web and workers on devnet, mint test NFTs with `deploy/devnet`, test a send, then go to mainnet with a small hot wallet.

## Secrets

Real values only in Vercel variables, Fly secrets (`fly secrets set -a lotus-workers`) or local gitignored files. Never commit `.env` files or wallet key files; `.gitignore` already excludes them.
