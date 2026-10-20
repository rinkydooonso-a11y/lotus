# Lotus research: pump.fun, Collector Crypt, Squads

Researched 2026-10-20 (read-only, web search and public GitHub docs). Handoff doc section 8 items, minus the NFT standard (another thread).

**Limits of this pass:** `pump.fun`, `collectorcrypt.com` and `skills.sh` could not be fetched from this sandbox (DNS failure), so I never read pump.fun/docs/fees or any Collector Crypt page directly. Everything below comes from pump.fun's public GitHub docs, news coverage and search snippets. Re-verify on the live sites before launch. Items marked **UNCONFIRMED** are not established by any source I could read.

## Answers

### 1. Does Collector Crypt have an API or programmatic purchasing?
**Probably yes, UNCONFIRMED.** One third-party page ([skills.sh, "collectorcrypt" skill](https://www.skills.sh/starchild-ai-agent/official-skills/collectorcrypt)) describes a Collector Crypt API covering marketplace buys, gacha, redemption and swaps, with hosts `api.collectorcrypt.com`, `dev-api.collectorcrypt.com` (devnet) and `gacha.collectorcrypt.com`, and marketplace payment in USDC. I saw no endpoint paths, auth scheme or official docs, and couldn't open the page itself. No official developer docs turned up. Marketplace also supports USDC offers/listings and card/Apple Pay/Google Pay purchases ([Collector Crypt newsletter](https://collector-crypt.beehiiv.com/p/major-updates-to-collector-crypt-marketplace), secondhand).
**Plan:** buy manually for launch (matches the handoff MVP). Ask Collector Crypt for API docs before automating. Do not scrape.

### 2. Does pump.fun accept a Squads vault as creator-reward recipient?
**Probably yes, UNCONFIRMED.**
- Fee-sharing shareholders are plain `{ address, share_bps }` entries; the docs don't restrict them to wallets or say PDAs are allowed ([CREATOR_FEE_SHARING.md](https://github.com/pump-fun/pump-public-docs/blob/main/docs/instructions/CREATOR_FEE_SHARING.md)). Max 10 shareholders, shares sum to 10,000 bps.
- For non-SOL quote mints (our CARDS case) payouts go to each shareholder's **associated token account** for the quote mint. A Squads vault is an off-curve PDA, which is fine for ATAs, but the ATA must exist (the instruction has an `initialize_ata` flag that creates missing ones, payer covers rent). Create the vault's CARDS ATA beforehand to be safe.
- Squads says only the **vault** address (not the multisig account address) should receive assets; sending to the multisig account address loses funds ([Squads docs](https://docs.squads.so/main/navigating-your-squad/settings-and-members)). Use the vault address.
- **Do a tiny test first** if the form lets you, or default to the safe fallback: set a normal wallet as recipient and forward to Squads.

**Critical:** `update_fee_shares_v2` effectively works **once** (it sets `admin_revoked`). Get the recipient list right the first time. Also, the doc says the creator is the initial 100% shareholder, so the split only takes effect after that update runs.

### 3. Current pump.fun fee schedule; can fee or pair change after launch?
**Partly UNCONFIRMED.**
- Pump.fun's own docs page (`pump.fun/docs/fees`) was unreachable, so I have not seen the current schedule, including the 17 Oct 2026 platform fee mentioned in the handoff.
- Custom pairs: creator fees are paid **in the pair's quote asset** (so CARDS for us), and 50% of Custom Pairs revenue goes to the PUMP buyback-and-burn contract ([The Defiant](https://thedefiant.io/news/defi/pump-fun-lets-creators-launch-coins-priced-in-tokenized-stocks), [Incrypted](https://incrypted.com/en/pump-fun-expanded-its-platform-with-tokenized-stocks-featuring-custom-pairs-function/)).
- **Conflict on the creator fee range:** news reports say custom-pair creator fee is flat 0.05%-1% (or cashback), field accepting 0.01-1 ([Cryptowisser](https://www.cryptowisser.com/news/pumpfun-lets-creators-pair-new-tokens-with-tokenized-stocks/?lang=en), [cryptonews.net](https://cryptonews.net/news/market/33421807/)). The handoff says the live form showed 0.01-3%. **Trust the live form at launch time, and check whether 3% really applies to a CARDS pair**, since the prize-math table depends on it.
- Can fee/pair change after launch? **UNCONFIRMED.** Nothing I read says a creator can change the pair; the handoff's "assume locked" is the right assumption. Separately, protocol-level rates live in pump's global config (`GlobalConfig` / `Global`), which pump.fun controls and has changed repeatedly ([PumpSwap creator fee doc](https://github.com/pump-fun/pump-public-docs/blob/main/docs/PUMP_SWAP_CREATOR_FEE_README.md), [Pump creator fee doc](https://github.com/pump-fun/pump-public-docs/blob/main/docs/PUMP_CREATOR_FEE_README.md); both older docs). Expect the platform, not you, to be able to change rules.
- Shares can be changed once after a CTO (Incrypted, secondhand).

### 4. How to claim creator rewards programmatically
**Confirmed in pump's public docs, with caveats.** Source: [pump-fun/pump-public-docs](https://github.com/pump-fun/pump-public-docs) (`docs/instructions/`).
- **If you do NOT create a sharing config:** `collect_creator_fee_v2` (bonding curve vault) and `collect_coin_creator_fee` (AMM vault after graduation). The newer doc calls both permissionless ([COLLECT_CREATOR_FEE.md](https://github.com/pump-fun/pump-public-docs/blob/main/docs/instructions/COLLECT_CREATOR_FEE.md)); older docs say the creator must sign. Treat as creator-signs until tested. Non-SOL quote: tokens move from the vault ATA to `creator_token_account`.
- **If you DO create a sharing config** (needed for the "up to 10 recipients" feature): the old collect instructions fail. Flow is: `transfer_creator_fees_to_pump_v2` (AMM to bonding-curve vault, permissionless), then `distribute_creator_fees_v2` (permissionless) pays each shareholder's quote-mint ATA by `share_bps`. Remaining accounts: shareholders first, then their ATAs, in config order.
- Fees also accrue in the pool/curve until swept (`sweep_creator_fee`, permissionless, per SWEEP_FEES.md; I only saw its summary).
- Code: pump publishes IDLs and docs in that repo. A community package `@nirholas/pump-sdk` exists but is **unverified**; don't use it with real keys. Check the official `@pump-fun/pump-sdk` / `pump-swap-sdk` yourself (UNCONFIRMED which package names are current).
- **Design choice for the fee-claimer worker:** if the recipient is a Squads vault, distribution is permissionless so a bot with a tiny gas wallet can call it and funds land in Squads directly. No hot key ever touches the CARDS.

## Manual runbook (MVP)

Never paste seed phrases anywhere. Do mainnet steps from a signer you control; every mainnet transaction needs a human to confirm.

### A. Claim creator fees
1. Open your coin page on pump.fun with the creator wallet (or a Squads-recipient if set up), and check the claimable CARDS balance.
2. If recipient is a normal wallet and no sharing config: click claim in the creator rewards UI (or call `collect_creator_fee_v2` / `collect_coin_creator_fee`). CARDS lands in that wallet's ATA.
3. If using sharing config with Squads as recipient: run `transfer_creator_fees_to_pump_v2` then `distribute_creator_fees_v2` (or use pump's UI if it exposes a claim/distribute button). CARDS lands in the Squads vault's CARDS ATA.
4. Normal wallet case: send the CARDS to the Squads **vault** address (not the multisig address) and confirm on Solscan.
5. Log it for the public treasury page (`treasury_events`).

### B. Buy cards on Collector Crypt (manual, per handoff)
1. In Squads, propose a transfer (or swap) of CARDS to USDC, since the marketplace prices in USDC (secondhand). Approve with the required signers. A swap via Jupiter from the Squads app is the likely route (UNCONFIRMED in the UI).
2. Fund a **purchasing wallet** (small) with only what you will spend. Do not connect the Squads vault to the site if avoidable.
3. On collectorcrypt.com marketplace, pick individual cards by tier (Common <$30, Uncommon $30-75, Rare $75-300, Grail $300+), buy with USDC.
4. Confirm the NFT arrived; record mint, name, grade, value in `inventory_items`.
5. Do not buy gacha packs (random value, ~85% buyback).

### C. Top up the hot wallet from Squads
1. Decide a 1-2 day batch of cards (plus a little SOL for fees and ATA rent).
2. In Squads, create a transaction sending the NFTs (and SOL) from the vault to the hot wallet address. Get the threshold approvals (e.g. 2 of 3), then execute.
3. Verify on Solscan and via the inventory sync, then mark items `available`.
4. Optional later: Squads **spending limits** let a named member move fixed amounts without full approval ([Squads spending limits](https://squads.xyz/blog/spending-limits)). Whether they cover NFTs, not just fungible tokens, is UNCONFIRMED; don't plan around it.
5. Keep the hot wallet small enough that losing it costs about a day of prizes.

## Open items to resolve before launch
- Read pump.fun/docs/fees on the live site: platform fee from 17 Oct 2026, custom-pair fee range, any fee-change rules.
- Confirm in the live create form that 3% is allowed for a CARDS pair.
- Ask Collector Crypt for API docs; until then buy by hand.
- Test a Squads vault as fee recipient with a small amount, and pre-create the vault's CARDS ATA.
- Remember `update_fee_shares_v2` is effectively one-shot.
