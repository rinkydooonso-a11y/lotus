import type { Pool, PoolClient } from 'pg';
import {
  fetchCoinBalance,
  fetchCoinPriceUsd,
  requiredBaseUnits,
  toUiAmount,
  type CoinBalance,
  type CoinHoldConfig,
} from './coin';
import { getPool } from './db';
import { resolveCoinHoldConfig } from './appSettings';
import type { CoinHoldStatus, HoldVerdict } from './types';

/**
 * The coin holder gate.
 *
 * A wallet must hold `requiredUsd` of our coin to open a crate. A qualifying check opens a window
 * (48 h by default) and snapshots the token amount, so a price move during the window never changes
 * what somebody has to hold. Inside the window the balance is re-read at most every `recheckMs`;
 * finding it under the snapshot locks the player out until the window ends.
 *
 * Three things this has to get right:
 *
 *  - **Off until there is a coin.** No `COIN_MINT` means no gate, and every open goes through. This
 *    is the normal state before launch, not an error, so nothing here throws over missing config.
 *  - **Fail closed on an outage.** If the RPC or the price feed can't be read we refuse the open. A
 *    gate that opens when its lookup breaks is not a gate, and the vault is real money.
 *  - **One lookup per player per window, not per open.** Ten opens a day each costing two HTTP
 *    calls would be ten thousand calls a day at a thousand players. The window plus `recheckMs`
 *    puts the steady state at a couple of calls per player per day.
 *
 * The window is keyed on the player, so moving the coin to another wallet cannot clear a lockout.
 */

type Q = Pool | PoolClient;

export interface HoldDeps {
  db?: Q;
  /** Tests and the stub: override the whole configuration, or pass null to force the gate off. */
  config?: CoinHoldConfig | null;
  /** Tests: stand in for the chain. Throwing here must behave like an RPC outage. */
  balance?: (owner: string, cfg: CoinHoldConfig) => Promise<CoinBalance>;
  /** Tests: stand in for the price feed. Throwing here must behave like a feed outage. */
  price?: (cfg: CoinHoldConfig) => Promise<number>;
  now?: Date;
}

const UNAVAILABLE =
  "We couldn't check your coin balance just now, so we didn't open the crate. The crate is still there — try again in a moment.";

interface WindowRow {
  wallet_address: string;
  mint: string;
  expires_at: Date;
  required_tokens: string;
  required_usd: string;
  price_usd: string;
  decimals: number;
  tokens_held: string;
  checked_at: Date;
  locked_out_at: Date | null;
}

const SELECT_WINDOW = `SELECT wallet_address, mint, expires_at, required_tokens, required_usd,
                              price_usd, decimals, tokens_held, checked_at, locked_out_at
                         FROM holder_windows WHERE player_id = $1`;

/** How much coin to buy, phrased for a player who has to go and do it. */
function shortfallMessage(requiredUsd: number, heldUsd: number): string {
  const missing = Math.max(0.01, requiredUsd - heldUsd);
  const held = heldUsd >= 0.01 ? `You hold about $${heldUsd.toFixed(2)}` : 'You hold none yet';
  return `You need $${requiredUsd.toFixed(0)} of our coin to open a crate. ${held}, so top up by about $${missing.toFixed(2)}.`;
}

/**
 * Decides whether this player may open a crate, and keeps their window up to date.
 *
 * Runs outside the open transaction, because it makes network calls. Never throws for a reason the
 * player could be told about: an outage comes back as `{ ok: false, code: 'coin_unavailable' }`.
 */
export async function checkCoinHold(
  args: { playerId: string; walletAddress: string },
  deps: HoldDeps = {},
): Promise<HoldVerdict> {
  const db = deps.db ?? getPool();
  const cfg = deps.config === undefined ? await resolveCoinHoldConfig(process.env, db as Pool) : deps.config;
  if (!cfg) return { ok: true, gate: 'off' };

  const now = deps.now ?? new Date();
  const getBalance = deps.balance ?? ((owner, c) => fetchCoinBalance(owner, c));
  const getPrice = deps.price ?? ((c) => fetchCoinPriceUsd(c));

  // A window for a different mint (the coin was redeployed) is treated as no window at all.
  const existing = (await db.query<WindowRow>(SELECT_WINDOW, [args.playerId])).rows[0];
  const open = existing && existing.expires_at > now && existing.mint === cfg.mint ? existing : undefined;

  if (open) {
    if (open.locked_out_at) {
      return {
        ok: false,
        code: 'hold_locked',
        message:
          `Your coin balance dropped below $${Number(open.required_usd).toFixed(0)} during this ` +
          `48 hour window, so opening is paused until ${open.expires_at.toISOString()}.`,
      };
    }
    // Inside the window and checked recently enough: no network call at all.
    if (now.getTime() - open.checked_at.getTime() < cfg.recheckMs) return { ok: true, gate: 'on' };

    const required = BigInt(open.required_tokens);
    let held: CoinBalance;
    try {
      held = await getBalance(args.walletAddress, cfg);
    } catch {
      return { ok: false, code: 'coin_unavailable', message: UNAVAILABLE };
    }
    if (held.baseUnits >= required) {
      await db.query(`UPDATE holder_windows SET tokens_held = $2, checked_at = $3 WHERE player_id = $1`, [
        args.playerId, held.baseUnits.toString(), now,
      ]);
      return { ok: true, gate: 'on' };
    }
    await db.query(
      `UPDATE holder_windows SET tokens_held = $2, checked_at = $3, locked_out_at = $3 WHERE player_id = $1`,
      [args.playerId, held.baseUnits.toString(), now],
    );
    return {
      ok: false,
      code: 'hold_locked',
      message:
        `You need to keep $${Number(open.required_usd).toFixed(0)} of our coin held while you play. ` +
        `Your balance dropped below that, so opening is paused until this window ends.`,
    };
  }

  // No window, or the last one has run out: price the requirement and take a fresh look.
  let held: CoinBalance;
  let price: number;
  try {
    [held, price] = await Promise.all([getBalance(args.walletAddress, cfg), getPrice(cfg)]);
  } catch {
    return { ok: false, code: 'coin_unavailable', message: UNAVAILABLE };
  }

  const required = requiredBaseUnits(cfg.requiredUsd, price, held.decimals);
  if (held.baseUnits < required) {
    // No window is opened, so they can buy the coin and try again straight away.
    const heldUsd = toUiAmount(held.baseUnits, held.decimals) * price;
    return { ok: false, code: 'needs_coin', message: shortfallMessage(cfg.requiredUsd, heldUsd) };
  }

  const expiresAt = new Date(now.getTime() + cfg.windowMs);
  await db.query(
    `INSERT INTO holder_windows (player_id, wallet_address, mint, started_at, expires_at,
                                 required_tokens, required_usd, price_usd, decimals, tokens_held,
                                 checked_at, locked_out_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $4, NULL)
     ON CONFLICT (player_id) DO UPDATE
        SET wallet_address = EXCLUDED.wallet_address, mint = EXCLUDED.mint,
            started_at = EXCLUDED.started_at, expires_at = EXCLUDED.expires_at,
            required_tokens = EXCLUDED.required_tokens, required_usd = EXCLUDED.required_usd,
            price_usd = EXCLUDED.price_usd, decimals = EXCLUDED.decimals,
            tokens_held = EXCLUDED.tokens_held, checked_at = EXCLUDED.checked_at,
            locked_out_at = NULL`,
    [
      args.playerId, args.walletAddress, cfg.mint, now, expiresAt,
      required.toString(), cfg.requiredUsd, price, held.decimals, held.baseUnits.toString(),
    ],
  );
  return { ok: true, gate: 'on' };
}

/**
 * The player's hold status for the UI, without taking any network call. Read-only: it reports what
 * the last check found, so a player can see where they stand before walking to a crate.
 */
export async function getCoinHoldStatus(
  playerId: string,
  deps: HoldDeps = {},
): Promise<CoinHoldStatus> {
  const db = deps.db ?? getPool();
  const cfg = deps.config === undefined ? await resolveCoinHoldConfig(process.env, db as Pool) : deps.config;
  if (!cfg) return { gate: 'off' };
  const now = deps.now ?? new Date();
  const row = (await db.query<WindowRow>(SELECT_WINDOW, [playerId])).rows[0];
  if (!row || row.expires_at <= now) return { gate: 'on', qualified: false, requiredUsd: cfg.requiredUsd };
  return {
    gate: 'on',
    qualified: !row.locked_out_at,
    requiredUsd: Number(row.required_usd),
    requiredCoin: toUiAmount(BigInt(row.required_tokens), row.decimals),
    heldCoin: toUiAmount(BigInt(row.tokens_held), row.decimals),
    windowEndsAt: row.expires_at.toISOString(),
    lockedOut: Boolean(row.locked_out_at),
  };
}

/** Drops windows that ended over a day ago. Run from the maintenance worker. */
export async function pruneHolderWindows(db: Pool = getPool()): Promise<number> {
  const r = await db.query(`DELETE FROM holder_windows WHERE expires_at < now() - interval '1 day'`);
  return r.rowCount ?? 0;
}
