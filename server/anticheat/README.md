# Anti-cheat

Implements `validateOpen: ValidateOpen` from `docs/contracts.md`. Core's `openCrate` calls it after its own
crate checks and the SQL 40 m check, outside the open transaction.

## What it checks, in order
1. zod re-validation of the context (`invalid_input`), per-player request throttle (`rate_limited`).
2. GPS accuracy (`bad_accuracy`, default > 50 m), client clock skew (`clock_skew`, > 30 s), distance backstop (`too_far`, > 40 m).
3. Movement (`no_recent_ping`, `implausible_movement`): reads `location_pings` written by core's `recordLocationPing`
   since the last check and walks them from the player's trusted position (Redis). A ping that is reachable at
   ≤ 43 m/s (after subtracting both accuracy radii) becomes the trusted position; one that isn't is skipped and
   counts as a strike. So a single GPS glitch is ignored, but after a teleport every later ping and the open
   stay unreachable until 6 h have passed (`anchorResetMs`, lets real travellers back in). An open needs a ping
   in the last 5 min. 3 strikes in 24 h raise a `player_flags` row.
4. Sybil (`sybil`): Redis 30-day sets of wallets per device, per IP and per funding address, plus wallet age.
   Weights: device 2, funder 2, IP 1, fresh wallet 1. Score ≥ 2 flags for review, ≥ 4 rejects.
   Wallet age/funder come from `HELIUS_RPC_URL` (cached per wallet); without it those two signals are skipped.
5. Cooldowns and daily caps (`wallet_cooldown`, `device_cooldown`, `wallet_daily_cap`, `device_daily_cap`), last,
   so rejected opens don't burn quota. Cooldown is `SET NX EX` (race-free); caps are `INCR` rolled back on overflow.

## Flags, freezing, withheld prizes
Flags go to `player_flags` with `source = 'anticheat'` (deduped per player+reason per hour). On a rejection the flag
is returned in `ValidateResult.flag` and core writes it; soft flags on allowed opens are written here.
Freezing and withholding unsent prizes are core's `freezePlayer` / `unfreezePlayer`, driven from the admin page.

## Config
Every threshold is in `config.ts` with an `LOTUS_AC_*` env override (see `.env.example`).

## Deps
`zod`, `@upstash/redis`, `pg` (types); tests use `vitest`. `__tests__/` runs on an in-memory Redis with fake ping/flag stores.
