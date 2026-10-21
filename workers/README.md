# @lotus/workers

Background jobs for Lotus: **prize sender**, **inventory sync**, and the once-a-minute crate expiry from `@lotus/server`.

```
npm install
npm test                 # 20 tests, all fakes, no network
npm run typecheck
npm start                # all loops in one process (tsx src/main.ts all)
npm run prize-sender     # or one loop per process
npm run inventory-sync
```

Depends on `@lotus/server` via `file:../server` and imports its prize queue directly. Worker tables (`prize_send_txs`, `inventory_discrepancies`, `vault_snapshots`) live in `db/migrations/0002_worker_tables.sql`; run `npm run migrate` in `server/`.

## Scheduler

One plain Node process, one loop per job: await the tick, sleep the interval, repeat, so ticks never overlap. Deploy as a single always-on worker on Fly (`fly.workers.toml`). A Postgres advisory lock (`lotus:prize-sender`) makes a second prize sender refuse to start. Chosen over Inngest/Trigger.dev because it needs no extra account and the sender wants a long-lived process.

## NFT standard

Collector Crypt cards are not one standard. Older cards are Metaplex Token Metadata **programmable NFTs (pNFTs)**; newer batches (from mid-2026) are **Metaplex Core** assets; they have also used Bubblegum (compressed). The worker reads each mint's account on chain and picks the transfer:

| standard | how | status |
|---|---|---|
| pNFT | mpl-token-metadata `transferV1`, ProgrammableNonFungible, rule set from metadata | built |
| legacy NFT | mpl-token-metadata `transferV1`, NonFungible | built |
| Core | mpl-core `transferV1` (+ collection) | built |
| compressed (Bubblegum) | needs a DAS proof | not built, parked for admin |
| Token-2022 / other | | parked for admin |

Sources: [Metaplex on X](https://x.com/metaplex/status/2066947029318664622), [EGamers on Core mints](https://egamers.io/solanas-collectibles-wave-metaplex-core-clears-1-5-million-mints-over-june-and-july/), [CoinGecko: What is Collector Crypt](https://www.coingecko.com/learn/what-is-collector-crypt-cards). Not checked on Solscan: this sandbox can't reach Solana RPC or explorers.

## Prize sender: why it can't double-send

Consumes `claimNextPrizeSend / recordSubmittedSignature / markPrizeSent / markPrizeFailed` from `@lotus/server` (see `docs/contracts.md`).

1. `prize_sends` has UNIQUE `opening_id` and UNIQUE `inventory_item_id`: one card can't be queued twice.
2. Write-ahead: signed tx (signature, lastValidBlockHeight, bytes) goes into `prize_send_txs` and `recordSubmittedSignature` **before** broadcast.
3. A new tx is built only when every earlier one is provably dead: failed on chain, or block height passed its lastValidBlockHeight and it was never seen. Height is read **before** status so a late landing can't be mistaken for expiry. Otherwise it just rebroadcasts and waits.
4. Before building, the owner is read from chain state. Winner already has it: mark sent. Someone else has it: stop.
5. A partial unique index allows only one pending tx per prize. And on chain an NFT can move only once, so a second racing tx fails.

Anything unexpected → `markPrizeFailed(..., { permanent: true })`. The item stays reserved for the winner; an admin requeues. The worker never returns a card to the pool.

## Inventory sync

Every 2 min: lists the hot wallet via Helius DAS `getAssetsByOwner`, compares with `inventory_items`.
- `available` card not in the wallet (double-checked on chain, not just DAS): set `withheld` so it can't be rolled; set back to `available` if it returns.
- Everything else goes to `inventory_discrepancies` for the admin page: `untracked` (in wallet, not in DB: add it with `addInventoryItem`), `missing` (reserved/withheld but gone), `sent_but_held`.
- Writes `vault_snapshots` (on-chain verified count and value) for the public "cards in vault" counter.

## Top-up proposer (`top-up`)

Keeps the hot wallet stocked from the Squads vault without being able to move anything itself. Every `TOPUP_INTERVAL_MS` it compares available cards per tier with `TOPUP_TARGETS`, picks vault cards (oldest first, under `TOPUP_MAX_CARDS` / `TOPUP_MAX_USD`), adds SOL if the hot wallet is under `TOPUP_MIN_HOT_SOL`, and drafts one Squads batch proposal. Signers approve and execute it in the Squads app; inventory sync makes the cards available once they land.

- The proposer key must have the Initiate permission only, the multisig must have no config authority (autonomous), and its threshold must be at least `SQUADS_MIN_THRESHOLD` (2). This is checked at start and before every proposal; if it fails the job logs an error and retries each interval, while the prize sender keeps running.
- Cards are checked on chain before drafting. A card the vault no longer holds is left out and logged, instead of blocking the top-up.
- An approved proposal that later goes stale is still treated as live, because Squads can still execute it.
- One open proposal at a time (`topup_proposals`, unique index). Rows are written before any chain call. A failure before anything reached the chain marks the row `abandoned` at once, so the next tick retries; a proposal that never went live is abandoned after 10 minutes. Abandoned rows don't hold their transaction index.
- A proposal is only trusted if its batch was created by our key, so an index someone else used in the Squads app is never adopted.
- Executed top-ups write one `topup` treasury event per card, plus one for SOL.
- `scripts/devnet-topup-e2e.ts` runs the whole flow against a throwaway devnet multisig.

## Fee claimer (`fee-claimer`)

Uses pump.fun's official SDK (`@pump-fun/pump-sdk`, pinned) to call the permissionless sweep, consolidate and `distribute_creator_fees(_v2)` instructions for `PUMP_COIN_MINT`. Fees go from pump's vault straight to the fee-sharing shareholders; the bot's key only pays gas. It refuses to send unless `SQUADS_VAULT_ADDRESS` is a shareholder with at least `FEE_MIN_VAULT_SHARE_BPS`, simulates first and skips anything under `FEE_CLAIM_MIN_BASE_UNITS`, and logs the vault's change read from the landed transaction as a `claim` treasury event. A confirm timeout is checked against the signature status before giving up. Launch checklist: make the fee-sharing config's admin the vault itself, or revoke it, so no single key can redirect fees.

## Card buyer (`card-buyer`)

Buys Collector Crypt marketplace cards (Core assets, priced in USDC, no API key) straight into the hot wallet when a tier runs short.
Money comes from the vault through a Squads **spending limit**: the signers approve once that the
hot wallet may pull N SOL per week, to itself only (`scripts/add-spending-limit.ts` proposes it).
The program enforces the cap, so a leaked hot-wallet key loses at most a week's budget.

- Collector Crypt's public listings API is only a price feed; the buy transaction (`buy_core`) is built locally from the listing account, which is re-read on chain (seller, asset, pinned collection, price). Before buying, the card is re-read from
  chain: its verified collection must be `BUY_COLLECTION_ADDRESS` and `BUY_UPDATE_AUTHORITY` must be
  among its authorities, and traits, insured value and grade come from the asset's own metadata (DAS).
- Listings must carry `BUY_REQUIRED_TRAITS` (required: the buyer won't start without it) and an insured value (`BUY_VALUE_TRAIT`); the tier
  comes from that value, and the price must be at most `BUY_MAX_PRICE_TO_VALUE` of it and under
  `BUY_MAX_USD_PER_CARD` (25) and `BUY_MAX_SOL_PER_CARD`. SOL/USD comes from Jupiter and is bounds-checked.
- Cards cost USDC. If the hot wallet lacks it, a Jupiter SOL to USDC swap for exactly the shortfall is checked (only swap-shaped instructions, hot wallet pays, simulated: SOL out within budget, USDC in at least the shortfall) and sent first; leftover USDC is reused.
- The buy transaction is still checked as if untrusted: only compute-budget, memo, SOL
  transfer, ATA-create and known buy instructions may appear (anything else, e.g. a listing of a
  card we hold, is refused), and a simulation must show the hot wallet spending at most the USDC price (and a few cents of SOL for token-account rent) and ending up owning the card. No other token account or Core asset
  the hot wallet holds may be writable in it. Only then is it signed.
- The spending limit must name exactly the hot wallet as member and destination, and reset (day,
  week or month); its amount is logged at startup. `BUY_WEEKLY_MAX_SOL` is an off-chain backstop on
  card spend over any 7 days, since the buyer can also spend SOL that reached the hot wallet otherwise.
- **If the hot wallet key leaks**: the exposure is the prize cards plus up to the weekly limit from
  the vault, every period. Step one is a signer removing the spending limit in the Squads app.
- A `card_purchases` row is written before broadcasting; the next tick settles any 'sending' row
  from chain state and ownership, and nothing new is bought while one is unresolved. A bought card
  is added as `available` in the hot wallet with its cost, and logged as a purchase.

## Safety

- Hot wallet key only from `HOT_WALLET_SECRET_KEY` (host secret store). Never logged; config errors name the variable, never the value.
- Refuses mainnet (genesis hash check) unless `LOTUS_ALLOW_MAINNET` is set to the exact phrase in `src/config.ts`.

## Open

- Not run against devnet yet (no network from the build sandbox). First step once a Helius key and a devnet wallet exist: mint a devnet pNFT and a Core asset to the hot wallet and run one send each.
- Compressed transfers not built.
- `PRIZE_COLLECTIONS` needs Collector Crypt's collection addresses.
- `SQUADS_VAULT_ADDRESS` (optional) is the Squads vault address, read only. With it, inventory sync also checks the cards stored in the vault.
