# Mainnet cutover checklist

Do this only after the devnet end-to-end test in `docs/launch-runbook.md` (step 7) passed for both pNFT and Core cards. Never paste secret values into chat or commit them. Set them with `fly secrets set` and in the Vercel dashboard.

The order matters: money-moving pieces switch on last, and the confirmation phrase is the very last thing.

## 1. Before touching anything

- [ ] Take a manual database backup (GitHub > Actions > db-backup > Run workflow). Confirm the `SUPABASE_DB_URL` and `BACKUP_PASSPHRASE` repo secrets exist and the passphrase is in your password manager.
- [ ] `GET /api/health` is green on the current deployment.
- [ ] PR #2 (redesign) and the treasury PRs are merged or intentionally left out. Vercel deploys `main`.

## 2. Accounts and keys

- [ ] **Helius mainnet key**: create a mainnet API key (`https://mainnet.helius-rpc.com/?api-key=...`). Check the plan's request limits for real traffic.
- [ ] **Hot wallet**: a brand-new wallet used for nothing else. Back up its seed offline. Fund about 0.1 SOL for fees and move in only a small number of cards (3 to 5, low value). The rest stays in the Squads vault.
- [ ] **Squads vault** (treasury): created and its addresses recorded (`SQUADS_VAULT_ADDRESS` is the vault, `SQUADS_MULTISIG_ADDRESS` is the multisig account).
- [ ] **Collections**: the Collector Crypt collection addresses for `PRIZE_COLLECTIONS`.
- [ ] **Map tiles**: the default is OpenFreeMap (free, no key, no request limit, no SLA). Set `NEXT_PUBLIC_MAP_STYLE_URL` to a MapTiler or Stadia style URL if you want a guaranteed service.

## 3. Data

- [ ] Clear devnet rows from `inventory_items`, `crate_openings`, `prize_sends` (or use a fresh Supabase project). Do not mix test and real data.
- [ ] Add the real cards in `/admin` (mint, name, grade, value, location, cost).
- [ ] Run any pending migrations (`cd server && DATABASE_URL=<session pooler> npm run migrate`) **before** deploying code that needs them.

## 4. Fee sharing (pump.fun), one-time

- [ ] Launch the coin on pump.fun. **Do not enable "Holder Rewards".**
- [ ] Set fee sharing to **100% to the Squads vault**. This is a one-time, permanent setting (`update_fee_shares_v2` revokes the admin), so double-check the vault address first. The vault's quote-mint token account must exist (create it first).
- [ ] Set `PUMP_COIN_MINT` once the coin exists.

## 5. Web (Vercel)

- [ ] `NEXT_PUBLIC_SOLANA_CLUSTER` = `mainnet-beta` (baked in at build time, so redeploy).
- [ ] `HELIUS_RPC_URL` = mainnet URL. `NEXT_PUBLIC_MAP_STYLE_URL` from step 2, if you set one.
- [ ] `LOTUS_ADMIN_WALLETS` = your admin wallet(s) only. Redeploy.

## 6. Workers (Fly secrets), in this order

1. `SOLANA_RPC_URL` = mainnet Helius URL (and `HELIUS_DAS_URL` if separate).
2. `HOT_WALLET_SECRET_KEY` = the new hot wallet.
3. `PRIZE_COLLECTIONS`, `SQUADS_VAULT_ADDRESS`.
4. Optional treasury jobs, each off until its keys are set: top-up proposer (`SQUADS_MULTISIG_ADDRESS`, `SQUADS_PROPOSER_SECRET_KEY` which must be Initiate-only, `SQUADS_MIN_THRESHOLD`, `TOPUP_*`) and fee claimer (`PUMP_COIN_MINT`, `FEE_CLAIMER_SECRET_KEY`, `FEE_CLAIM_MIN_BASE_UNITS`, `FEE_MIN_VAULT_SHARE_BPS`). The card auto-buyer's `BUY_*` variables come with PR #8.
5. Optional: `DATABASE_LOCK_URL` (direct connection for the prize-sender lock).
6. **Last:** `LOTUS_ALLOW_MAINNET` = `yes-send-real-prizes-on-mainnet` (the phrase in `workers/src/config.ts`). Setting it is your confirmation that real prizes will be sent; without it the worker refuses mainnet.
7. `fly deploy -c fly.workers.toml --ha=false`, one Machine only. Watch `fly logs -a lotus-workers` for a clean start and first inventory sync.

## 7. First real test

- [ ] Win and send one card to your own second wallet. Check `/admin` for discrepancies.
- [ ] Only then announce (launch kit: `docs/launch/launch-kit.md`).

## 8. First day watch list

`/api/health`, `/admin` flagged players, prize sends stuck in `failed`, hot wallet SOL balance, Helius and Upstash usage. Stop switches are in `docs/rollback-runbook.md`.

## Card buyer (Collector Crypt marketplace, USDC, no API key)

The buyer reads `api.collectorcrypt.com/marketplace`, re-reads each listing account on chain, and builds the `buy_core` transaction itself (program `CcmRKTuZ...SQUr`). Only the hot wallet signs. Cards cost USDC, so the hot wallet swaps just enough SOL (from the Squads spending limit) into USDC through Jupiter before each buy. It only spends the card fund (the seed plus `FEE_CARD_FUND_BPS` of each claim); a card may cost at most one day's release (pool / 14) and never more than `BUY_MAX_USD_PER_CARD` (default 1000). Stock is sized from the pool, not fixed counts. See `docs/odds.md`.

- `BUY_COLLECTION_ADDRESS` = `CCryptUfeFSZ3Fgc9FLeKrhLVAP67FSqi1GuVoj9CRac` (the Core collection the marketplace whitelists).
- `BUY_UPDATE_AUTHORITY` = `DQPERZ9e86pNJ4mhUnCEP8V75yxZofsipoVrRWT5Wdxd`. This is what DAS lists as the full authority on a sampled Core card (checked read-only on mainnet), so it is what the DAS card check compares. On chain, the Core asset's own update authority is the Collection type pointing at `CCryptUfe...`; the buyer's on-chain listing check pins that collection separately. Do not set `BUY_UPDATE_AUTHORITY` to `CCryptUfe...`: every card would be refused.
- `BUY_REQUIRED_TRAITS` = `Type=Card`.
- **Seed the card fund before the buyer runs.** `cd workers && DATABASE_URL=... npx tsx scripts/fund-entry.ts seed 750 "launch seed"`, for whatever amount actually sits in the vault for cards. Without a seed the buyer waits for the first fee claim. Set the Squads weekly spending limit to match.
- `LOTUS_POOL_PAYOUT_DAYS` must be the same on the game server (Vercel) and the workers (Fly).
- Before turning it on: fund the hot wallet with a little SOL, run `scripts/buyer-dry-run.ts` (read-only), and run a mainnet simulation of a swap plus buy with the funded hot wallet. The program is upgradeable and has pause controls, so re-check the instruction layout if a simulation starts failing.
