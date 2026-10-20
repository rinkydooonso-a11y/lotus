# Lotus launch runbook

Order matters. Do everything on **devnet** first. Mainnet is the last section. Variable names and where to find each value are in `.env.example` (repo root).

Prereqs on your laptop: Node 22, git, a Phantom or Solflare wallet, and this repo (root = the `lotus` folder).

## 1. Create accounts (about 30 minutes)

1. **GitHub**: create a private repo, push the `lotus` folder as the repo root. `.gitignore` is already set. Check `git status` shows no `.env` files before pushing.
2. **Supabase** (supabase.com): new project, pick a region near your players, save the database password.
   - Database > Extensions: enable **postgis**.
   - Project Settings > Database > Connection string: copy the **Session pooler** string (port 5432) as `DATABASE_URL_SESSION` and the **Transaction pooler** string (port 6543) as `DATABASE_URL_TXN`. Replace `[YOUR-PASSWORD]`.
3. **Upstash** (console.upstash.com): create a Redis database, copy `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` from the REST API section.
4. **Helius** (dashboard.helius.dev): create an API key. Your devnet URL is `https://devnet.helius-rpc.com/?api-key=YOUR_KEY`. The free tier is enough for the test; check usage once real players arrive.
5. **Vercel** (vercel.com): sign in with GitHub.
6. **Railway** (railway.com): sign in with GitHub. A paid plan (about $5/month) is needed for an always-on service.

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

## 5. Deploy the workers on Railway (devnet)

1. Railway > New Project > Deploy from GitHub repo > pick the repo.
2. Service settings: **Config as code path** = `/deploy/railway.json` (this picks the Dockerfile and keeps one replica). Root directory stays the repo root, because the image needs both `server/` and `workers/`.
3. Variables (service > Variables):
   - `DATABASE_URL` = session pooler string
   - `SOLANA_RPC_URL` = Helius devnet URL
   - `HOT_WALLET_SECRET_KEY` = contents of `.devnet-hot-wallet.json` (the JSON array works as is)
   - `PRIZE_COLLECTIONS` = leave empty on devnet (counts everything in the wallet)
   - Leave `LOTUS_ALLOW_MAINNET` **empty**.
4. Deploy. In the logs you should see the prize sender and inventory sync loops start. A config problem names the bad variable but never prints its value.
5. Keep **exactly one replica**. A database lock stops a second prize sender from starting, but do not rely on it.

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
   - `OVERPASS_URLS` = leave empty for the test (free public mirrors). `WALKABLE_SPAWNS` = leave empty (on); `off` disables the footpath lookup.
4. Deploy. Open the URL on your phone.

## 7. Devnet end-to-end test

1. Switch your wallet to devnet. Connect it on the site (sign-in message, no transaction).
2. Open `/admin` (your address is in `LOTUS_ADMIN_WALLETS`). Within about 2 minutes the inventory sync should show your test NFTs; confirm they are `available`.
3. On the map, walk to or near a crate (open radius is 40 m; to test at home, use the admin odds/inventory pages or a phone GPS spoofing tool, noting anti-cheat will flag teleporting).
4. Open crates until you win a card. Check: opening recorded, the prize send goes `queued` > `submitted` > `sent`, and the NFT appears in the winner wallet on devnet (explorer.solana.com, cluster devnet).
5. Test both a pNFT and a Core win. If either fails, the send shows `failed` with `last_error`; fix before going further. Nothing is lost: the card stays reserved for the winner and the admin can requeue it.
6. Check `/admin` shows no unexpected discrepancies afterwards.

Do not continue until both standards sent successfully on devnet.

## 8. Go to mainnet with a small hot wallet

Only after step 7 passes.

1. Make a **new** wallet (Phantom or `solana-keygen new`) used only as the hot wallet. Back up its seed phrase offline.
2. Fund it with about 0.1 SOL for fees. Move in only a **small number of cards** (start with 3 to 5, low value). Keep the rest of your inventory in a separate cold wallet. The worker can only send what is in the hot wallet.
3. Collect the Collector Crypt collection addresses and set `PRIZE_COLLECTIONS` so only those cards count as prizes.
4. Swap in a mainnet Helius URL (`https://mainnet.helius-rpc.com/?api-key=YOUR_KEY`).
5. Railway variables: `SOLANA_RPC_URL` = mainnet URL, `HOT_WALLET_SECRET_KEY` = the new key, `PRIZE_COLLECTIONS`, and finally `LOTUS_ALLOW_MAINNET` = the exact phrase defined in `workers/src/config.ts` (`MAINNET_CONFIRMATION_PHRASE`). Setting this is your confirmation that real prizes will be sent. Redeploy.
6. Vercel variables: `NEXT_PUBLIC_SOLANA_CLUSTER` = `mainnet-beta`, `HELIUS_RPC_URL` = mainnet URL. Redeploy (public variables are baked in at build time).
7. Set `OVERPASS_URLS` to your own or a paid Overpass instance before announcing. The free public mirrors are rate limited and will slow crate spawning under real traffic. If you cannot, `WALKABLE_SPAWNS=off` keeps spawns working without the footpath check.
8. Clear the devnet test rows from `inventory_items`, `crate_openings`, `prize_sends` (or use a fresh Supabase project) so test data does not mix with real data.
9. Add the real cards in `/admin` (mint, name, grade, value). Check the worker logs and `/admin` for a clean first inventory sync.
10. Do a first real send to your own second wallet before announcing.
11. Watch for the first day: `/admin` flagged players, prize sends stuck in `failed`, hot wallet SOL balance, Helius and Upstash usage.

## Rollback and stop switches

- **Stop all sends**: scale the Railway workers service to 0 or remove `LOTUS_ALLOW_MAINNET` and redeploy. Wins keep queuing safely and send when you resume.
- **Pull a card**: `/admin` inventory > set status `withheld` or `removed` (reserved and sent cards cannot be touched).
- **Bad web deploy**: Vercel > Deployments > promote the previous one.

## Known gaps to decide before launch

- Compressed (Bubblegum) NFTs are not supported by the prize sender; only pNFT, legacy NFT, Core.
- Walkable-spawn filtering depends on Overpass availability (see `docs/decisions.md`).
- The default OpenStreetMap tile server is not meant for heavy traffic; set `NEXT_PUBLIC_MAP_STYLE_URL` to a MapTiler or Stadia style before real traffic.
