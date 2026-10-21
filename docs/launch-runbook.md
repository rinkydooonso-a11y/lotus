# CardQuest launch runbook (devnet first)

Order matters. Do everything on **devnet** first. The switch to real money is its own checklist: `docs/mainnet-cutover.md`. Variable names and where to find each value are in `.env.example` (repo root).

Prereqs on your laptop: Node 22, git, a Phantom or Solflare wallet, and this repo (root = the `lotus` folder).

## 1. Create accounts (about 30 minutes)

1. **GitHub**: create a private repo, push the `lotus` folder as the repo root. `.gitignore` is already set. Check `git status` shows no `.env` files before pushing.
2. **Supabase** (supabase.com): new project, pick a region near your players, save the database password.
   - Database > Extensions: enable **postgis**.
   - Project Settings > Database > Connection string: copy the **Session pooler** string (port 5432) as `DATABASE_URL_SESSION` and the **Transaction pooler** string (port 6543) as `DATABASE_URL_TXN`. Replace `[YOUR-PASSWORD]`.
3. **Upstash** (console.upstash.com): create a Redis database, copy `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` from the REST API section.
4. **Helius** (dashboard.helius.dev): create an API key. Your devnet URL is `https://devnet.helius-rpc.com/?api-key=YOUR_KEY`. The free tier is enough for the test; check usage once real players arrive.
5. **Vercel** (vercel.com): sign in with GitHub.
6. **Fly.io** (fly.io): sign up and install `flyctl`. The workers run as one small always-on Machine (app `lotus-workers`).

## 2. Create the devnet hot wallet and test NFTs (laptop, 10 minutes)

The devnet script generates a fresh wallet, airdrops devnet SOL, and mints test NFTs of both kinds the prize sender supports.

```
cd deploy/devnet
npm install
HELIUS_DEVNET_RPC="https://devnet.helius-rpc.com/?api-key=YOUR_KEY" npm run mint
```

- It prints the wallet address and saves the secret to `deploy/devnet/.devnet-hot-wallet.json` (gitignored). Treat it as a secret anyway.
- If the airdrop is rate limited, send devnet SOL to the printed address at faucet.solana.com and re-run.
- `npm run mint -- 3` mints 3 of each standard. It refuses to run on anything but devnet.
- At the end it prints an `INSERT INTO inventory_items ...` statement. Keep it for step 4.

## 3. Run migrations (laptop)

```
cd server
npm install
DATABASE_URL="<session pooler string>" npm run migrate
```

Expect `applied 0001_init.sql` and `applied 0002_worker_tables.sql`. If it errors about `postgis`, enable the extension (step 1) and re-run; it is safe to re-run.

## 4. Load the test prizes

In Supabase > SQL editor, paste the `INSERT INTO inventory_items` statement printed in step 2 and run it. These are your devnet prize cards.

## 5. Deploy the workers on Fly (devnet)

1. `fly apps create lotus-workers` (once). Config is `fly.workers.toml` at the repo root; the image needs both `server/` and `workers/`, so deploy from the repo root.
2. Set secrets (`fly secrets set -a lotus-workers NAME=value`; never paste them into chat or commit them):
   - `DATABASE_URL` = session pooler string
   - `DATABASE_LOCK_URL` = optional direct connection (`postgresql://postgres:PASSWORD@db.<ref>.supabase.co:5432/postgres`) so the prize-sender lock dies with the worker's socket. Supabase's free direct host is IPv6-only; check from the machine first. If the worker logs `prize-sender lock not available yet ... connection failed`, unset it to fall back to the pooler.
   - `SOLANA_RPC_URL` = Helius devnet URL
   - `HOT_WALLET_SECRET_KEY` = contents of `.devnet-hot-wallet.json` (the JSON array works as is)
   - `PRIZE_COLLECTIONS` = leave empty on devnet (counts everything in the wallet)
   - Leave `LOTUS_ALLOW_MAINNET` **unset**.
3. `fly deploy -c fly.workers.toml --ha=false`. In `fly logs -a lotus-workers` you should see the prize sender and inventory sync loops start. A config problem names the bad variable but never prints its value. On a redeploy, a few "prize-sender lock not available yet, retrying" warnings are normal while the old machine's lock clears.
4. Keep **exactly one Machine** (`fly scale count 1`). A database lock stops a second prize sender from starting, but do not rely on it.
5. The treasury jobs (top-up proposer, fee claimer) and `SQUADS_*` / `PUMP_COIN_MINT` / `FEE_CLAIMER_SECRET_KEY` stay unset until the treasury is set up; each job logs that it is off. All variables are listed in `.env.example`.

## 6. Deploy the web app on Vercel (devnet)

1. Vercel > Add New Project > import the repo.
2. **Root Directory** = `web`. Under it, turn on **Include source files outside of the Root Directory in the Build Step** (web imports `../server`). `web/vercel.json` already sets the install and build commands.
3. Environment variables (Production):
   - `DATABASE_URL` = transaction pooler string (port 6543)
   - `PG_POOL_MAX` = `3`
   - `LOTUS_SESSION_SECRET` = output of `openssl rand -base64 48`
   - `LOTUS_ADMIN_WALLETS` = your wallet public address
   - `LOTUS_USE_STUB` = `0`
   - `NEXT_PUBLIC_SOLANA_CLUSTER` = `devnet`
   - `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
   - `HELIUS_RPC_URL` = Helius devnet URL (optional, enables wallet-age checks)
4. Deploy. Open the URL on your phone.

## 7. Devnet end-to-end test

1. Switch your wallet to devnet. Connect it on the site (sign-in message, no transaction).
2. Open `/admin` (your address is in `LOTUS_ADMIN_WALLETS`). Within about 2 minutes the inventory sync should show your test NFTs; confirm they are `available`.
3. On the map, walk to or near a crate (open radius is 40 m; to test at home, use the admin odds/inventory pages or a phone GPS spoofing tool, noting anti-cheat will flag teleporting).
4. Open crates until you win a card. Check: opening recorded, the prize send goes `queued` > `submitted` > `sent`, and the NFT appears in the winner wallet on devnet (explorer.solana.com, cluster devnet).
5. Test both a pNFT and a Core win. If either fails, the send shows `failed` with `last_error`; fix before going further. Nothing is lost: the card stays reserved for the winner and the admin can requeue it.
6. Check `/admin` shows no unexpected discrepancies afterwards.

Do not continue until both standards sent successfully on devnet.

## 8. Go to mainnet

Only after step 7 passes. Follow `docs/mainnet-cutover.md`.

## Rollback and stop switches

- **Stop all sends**: `fly scale count 0 -a lotus-workers`, or unset `LOTUS_ALLOW_MAINNET` (`fly secrets unset`) which redeploys. Wins keep queuing safely and send when you resume.
- **Pull a card**: `/admin` inventory > set status `withheld` or `removed` (reserved and sent cards cannot be touched).
- **Bad web deploy**: Vercel > Deployments > promote the previous one.

## Known gaps to decide before launch

- Compressed (Bubblegum) NFTs are not supported by the prize sender; only pNFT, legacy NFT, Core.
- A crate spot can occasionally land somewhere you can't stand; it expires and is replaced (see `docs/decisions.md`).
- The default OpenStreetMap tile server is not meant for heavy traffic; set `NEXT_PUBLIC_MAP_STYLE_URL` to a MapTiler or Stadia style before real traffic.

## Monitoring and backups

- `GET /api/health` returns 200 when the database, Redis, the worker (a vault snapshot in the last 15 minutes) and the prize queue are healthy, otherwise 503. Point an uptime monitor at it.
- A nightly GitHub Actions job (`db-backup`, 03:17 UTC) takes an encrypted `pg_dump` and keeps it as a private artifact. It skips itself until the repository secrets `SUPABASE_DB_URL` (session pooler string) and `BACKUP_PASSPHRASE` exist. Restore steps are in `docs/rollback-runbook.md`.
