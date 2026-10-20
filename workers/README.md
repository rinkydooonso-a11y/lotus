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

One plain Node process, one loop per job: await the tick, sleep the interval, repeat, so ticks never overlap. Deploy as a single always-on worker on Railway or Fly. A Postgres advisory lock (`lotus:prize-sender`) makes a second prize sender refuse to start. Chosen over Inngest/Trigger.dev because it needs no extra account and the sender wants a long-lived process.

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

- The proposer key must have the Initiate permission only. The worker refuses to start if it can vote or execute.
- One open proposal at a time (`topup_proposals`, unique index). Rows are written before any chain call; a proposal that never went live is marked `abandoned` after 10 minutes and its cards return to the pool.
- A proposal is only trusted if its batch was created by our key, so an index someone else used in the Squads app is never adopted.
- Executed top-ups write one `topup` treasury event per card, plus one for SOL.
- `scripts/devnet-topup-e2e.ts` runs the whole flow against a throwaway devnet multisig.

## Fee claimer (`fee-claimer`)

Uses pump.fun's official SDK (`@pump-fun/pump-sdk`, pinned) to call the permissionless sweep, consolidate and `distribute_creator_fees(_v2)` instructions for `PUMP_COIN_MINT`. Fees go from pump's vault straight to the fee-sharing shareholders; the bot's key only pays gas. It refuses to send unless `SQUADS_VAULT_ADDRESS` is a shareholder, simulates first and skips anything under `FEE_CLAIM_MIN_BASE_UNITS`, and logs the measured amount as a `claim` treasury event.

## Safety

- Hot wallet key only from `HOT_WALLET_SECRET_KEY` (host secret store). Never logged; config errors name the variable, never the value.
- Refuses mainnet (genesis hash check) unless `LOTUS_ALLOW_MAINNET` is set to the exact phrase in `src/config.ts`.

## Open

- Not run against devnet yet (no network from the build sandbox). First step once a Helius key and a devnet wallet exist: mint a devnet pNFT and a Core asset to the hot wallet and run one send each.
- Compressed transfers not built.
- `PRIZE_COLLECTIONS` needs Collector Crypt's collection addresses.
- `SQUADS_VAULT_ADDRESS` (optional) is the Squads vault address, read only. With it, inventory sync also checks the cards stored in the vault.
