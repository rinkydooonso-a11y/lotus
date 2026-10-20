# Lotus contracts

Owner: the "game server and database" thread. Other threads build against this file.
If you need a change here, ask through the coordinator; don't edit it directly.

Source of truth for shapes is the code: `server/src/types.ts` (TS types) and
`db/migrations/*.sql` (tables). This file summarizes them and explains the rules.

## Layout

```
lotus/db/migrations/0001_init.sql   Postgres 15+ with PostGIS. Run in order.
lotus/server/                       package "@lotus/server" (TS source, ESM, moduleResolution bundler)
  src/index.ts                      public API (everything below is exported from here)
  src/types.ts                      shared types, incl. ValidateOpen
  anticheat/index.ts                OWNED BY ANTI-CHEAT THREAD; must export `validateOpen: ValidateOpen`
```

Web (Next.js) imports `@lotus/server` via `transpilePackages: ['@lotus/server']`.
Workers import it the same way and run with `tsx`.
Env: `DATABASE_URL` (Postgres connection string). `getPool()` reads it lazily.

## Tables (summary)

| table | key columns |
|---|---|
| `players` | id uuid, status `active\|frozen`, shards int, tickets int (0..5), first_crate_spawned bool, created_at |
| `wallets` | id, player_id, address (unique), type `external\|embedded`, is_primary, created_at |
| `crates` | id, location geography(Point,4326), spawned_for_player_id, kind `standard\|ticket`, tier_hint, status `active\|opened\|expired`, spawned_at, expires_at, opened_at |
| `location_pings` | id bigserial, player_id, location geography, accuracy_m, recorded_at (server time), client_ts, device_id, ip |
| `inventory_items` | id, nft_mint (unique), card_name, grade, value_usd numeric, tier `common\|uncommon\|rare\|grail`, status `available\|reserved\|sent\|withheld\|removed`, reserved_by_opening_id, reserved_at, sent_at, acquired_at, image_url, metadata jsonb, location `hot\|vault`, cost_usd |
| `crate_openings` | id, crate_id (unique), player_id, wallet_address, rolled_tier, result `card\|shards`, downgraded bool, shards_awarded, tickets_awarded, inventory_item_id (unique), status `complete\|pending\|sent\|failed\|withheld`, tx_signature, client_lat/lng/accuracy, device_id, ip, created_at |
| `prize_sends` | id, opening_id (unique), inventory_item_id (unique), nft_mint, recipient_address, status `queued\|processing\|submitted\|sent\|failed\|withheld`, attempts, tx_signature, last_error, locked_until, created_at, updated_at, sent_at |
| `odds_config` | crate_kind, tier (`common..grail` or `shards`), weight int (parts per 1,000,000) |
| `ticket_spends` | id, player_id, crate_id, created_at |
| `treasury_events` | id, kind `claim\|purchase\|topup\|other`, amount numeric, asset, usd_value, tx_signature, note, inventory_item_id, created_at |
| `player_flags` | id, player_id, source, reason, details jsonb, created_at, resolved_at (anti-cheat writes here) |

A `vault` card is always `withheld` or `removed` (CHECK `inventory_vault_not_in_play`), so it can never be reserved. Only inventory sync makes it `hot` + `available`, after confirming on chain that it reached the hot wallet. `addInventoryItem` with a `costUsd` also writes a `purchase` treasury event in the same transaction.

Tier value bands (USD insured value): common <30, uncommon 30–75, rare 75–300, grail 300+. `tierForValue(usd)` implements this.

## Game rules implemented by core

- Crates spawn for one player and are only visible/openable by that player. Expire 30 min after spawn.
- Up to 3 active crates per player, max 40 spawns per player per UTC day.
- The very first crate for a player spawns at their position; later ones at a random point 40–250 m away.
- No walkability filtering for launch (simple approach). Crates can land on water/roads; noted in decisions.md.
- Open radius 40 m, checked in SQL with `ST_DWithin` inside the open transaction.
- Odds: roll `crypto.randomInt(0, 1_000_000)` against `odds_config` for the crate kind. A tier with zero
  available inventory gets weight 0 (its weight flows to shards), and if the reservation still finds nothing
  (race), the result is downgraded to shards.
- Shards: empty crate pays 1–3 shards (CSPRNG). 10 shards auto-convert into 1 ticket while tickets < 5.
  Extra shards stay in the balance and convert once a ticket is spent.
- A ticket spawns a `ticket` crate at the player's position with better odds (`useTicket`).

## Functions other threads call

All take an optional `db` (a `pg.Pool`); default is `getPool()`.

```ts
// players / login (web thread)
upsertPlayerByWallet(input: { address: string; type: 'external' | 'embedded' }, db?): Promise<{ playerId: string; created: boolean }>
getPlayer(playerId: string, db?): Promise<PlayerSummary | null>   // status, shards, tickets, wallets

// location + map (web thread; call on every watchPosition update, throttled ~5s)
recordLocationPing(input: PingInput, db?): Promise<void>
// PingInput = { playerId, lat, lng, accuracyM, clientTs: number (ms epoch), deviceId: string, ip?: string }

spawnCratesNear(input: { playerId: string; lat: number; lng: number }, db?): Promise<CrateView[]>
// Spawns up to the cap and returns ALL the player's active crates (new + existing).
getActiveCrates(playerId: string, db?): Promise<CrateView[]>
// CrateView = { id, lat, lng, kind, expiresAt: string (ISO) }

// opening (web thread API route)
openCrate(input: OpenCrateInput, deps: { validateOpen: ValidateOpen; db?: Pool }): Promise<OpenCrateResult>
// OpenCrateInput (validate the client part with OpenCrateRequestSchema from zod):
//   { crateId, lat, lng, accuracyM, clientTs, deviceId }           <- from client body
//   + { playerId, walletAddress, ip }                                <- from server session, NEVER the body
// OpenCrateResult =
//   | { ok: true; openingId; replayed: boolean; outcome: 'card'; item: PrizeItemView; prizeStatus: string }
//   | { ok: true; openingId; replayed: boolean; outcome: 'shards'; shardsAwarded; ticketsAwarded; shards; tickets; downgraded: boolean }
//   | { ok: false; code: OpenRejectCode; message: string }
// OpenRejectCode = 'not_found' | 'not_yours' | 'expired' | 'already_opened' | 'too_far' | 'frozen' | 'anticheat' | 'invalid_input'
// Re-sending an open for a crate the same player already opened returns the original result with replayed=true.

useTicket(input: { playerId: string; lat: number; lng: number }, db?): Promise<{ ok: true; crate: CrateView; tickets: number } | { ok: false; code: 'no_tickets' | 'frozen' }>

// history / stats (web thread)
getPlayerHistory(playerId: string, opts?: { limit?: number }, db?): Promise<OpeningView[]>
getVaultStats(db?): Promise<VaultStats>     // counts + value by tier and status, total sent, recent winners (wallet shortened)
getPublicOdds(kind?: 'standard' | 'ticket', db?): Promise<OddsView[]>   // effective odds after zero-inventory adjustment

// admin (web admin page)
addInventoryItem(input: NewInventoryItem, db?): Promise<{ id: string }>   // tier derived from value_usd unless given
setInventoryStatus(id: string, status: 'available' | 'withheld' | 'removed', db?): Promise<void>  // never touches reserved/sent
setOdds(kind, weights: Record<Tier | 'shards', number>, db?): Promise<void>   // must sum to 1_000_000
freezePlayer(playerId: string, reason: string, db?): Promise<void>    // also marks that player's queued prize_sends 'withheld'
unfreezePlayer(playerId: string, db?): Promise<void>                  // releases withheld sends back to 'queued'
listFlaggedPlayers(db?): Promise<FlaggedPlayer[]>
recordTreasuryEvent(input: NewTreasuryEvent, db?): Promise<{ id: string }>

// maintenance (workers thread, run every minute)
expireStaleCrates(db?): Promise<number>
```

## Anti-cheat hook (implemented by the anti-cheat thread)

`server/anticheat/index.ts` must export:

```ts
import type { ValidateOpen } from '../src/types';
export const validateOpen: ValidateOpen = async (ctx) => { ... };

type ValidateOpen = (ctx: OpenContext) => Promise<ValidateResult>;

interface OpenContext {
  db: Pool;                       // pool, NOT inside the open transaction
  now: Date;                      // server time
  playerId: string;
  walletAddress: string;
  deviceId: string;
  ip: string | null;
  client: { lat: number; lng: number; accuracyM: number; clientTs: number };
  crate: { id: string; lat: number; lng: number; kind: 'standard' | 'ticket'; spawnedAt: Date; expiresAt: Date };
  distanceM: number;              // server-computed client->crate distance
}

type ValidateResult =
  | { ok: true }
  | { ok: false; reason: string; flag?: { reason: string; details?: Record<string, unknown> } };
```

Ordering inside `openCrate`:
1. zod-validate input, load crate + player (no locks). Reject not_found / not_yours / frozen / expired / already_opened (or replay).
2. Reject `too_far` if distance > 40 m (core owns this check).
3. Call `validateOpen(ctx)`. If `{ok:false}`, core writes `flag` (if present) to `player_flags` and returns `code: 'anticheat'`.
   Anti-cheat owns: movement plausibility vs pings, cooldowns, per-wallet/device daily open caps, sybil, IP/device clustering.
   `validateOpen` runs outside the transaction, so make cooldowns race-free yourself (e.g. Redis `SET NX PX`).
4. Transaction: lock player row and crate row (`FOR UPDATE`), re-check status/expiry/distance, roll, reserve inventory
   (`FOR UPDATE SKIP LOCKED`), insert `crate_openings`, update balances, mark crate opened, enqueue prize send. Commit.

`validateOpen` must not throw for normal rejections. If it throws, the open fails closed (500, nothing awarded).

## Prize send queue (consumed by the prize sender worker)

The queue is the `prize_sends` table, written in the same transaction as the opening (transactional outbox),
so a committed card win always has exactly one send row, and a rolled-back open has none.

```ts
enqueuePrizeSend(client: PoolClient, job: { openingId; inventoryItemId; nftMint; recipientAddress }): Promise<{ id: string }>
// called by openCrate only; ON CONFLICT (opening_id) DO NOTHING.

claimNextPrizeSend(opts?: { lockMs?: number; maxAttempts?: number }, db?): Promise<PrizeSendJob | null>
// Picks one job with status 'queued', or 'processing'/'submitted' whose lock expired, skipping frozen players
// (FOR UPDATE SKIP LOCKED). Sets status 'processing', attempts+1, locked_until = now + lockMs (default 120s).
// PrizeSendJob = { id, openingId, inventoryItemId, nftMint, recipientAddress, attempts, status, txSignature: string | null }

recordSubmittedSignature(jobId: string, signature: string, db?): Promise<void>
// Call AFTER signing and BEFORE broadcasting. Status -> 'submitted'.

markPrizeSent(jobId: string, signature: string, db?): Promise<void>
// One transaction: prize_sends 'sent', crate_openings 'sent' + tx_signature, inventory_items 'sent' + sent_at. Idempotent.

markPrizeFailed(jobId: string, error: string, opts?: { permanent?: boolean }, db?): Promise<void>
// Not permanent: back to 'queued' (or stays 'submitted' if a signature exists). Permanent or attempts >= max: 'failed'.
// The inventory item stays reserved: the player is owed this card; an admin retries with requeuePrizeSend.

requeuePrizeSend(jobId: string, db?): Promise<void>   // admin
```

Never-double-send rule for the worker: if a claimed job already has `txSignature`, first check that signature's
status on chain. If it landed, call `markPrizeSent`. If it definitely expired (blockhash too old) without landing,
build a new tx. Only then broadcast. Also check the hot wallet still owns `nftMint` before sending.

## Open items

- Ticket use (spawns a better-odds ticket crate) is our default guess at Collect's mechanic.
- Walkability (OSM) filtering is not done; crates can spawn in water or on highways.
- Starting odds live in `odds_config` seed data in 0001_init.sql and in docs/odds.md.
