import nacl from "tweetnacl";
import bs58 from "bs58";
import { z } from "zod";

/**
 * Phantom universal-link (deeplink) protocol for mobile browsers where Phantom isn't injected
 * (iOS Safari/Chrome, Android Chrome). Phantom's in-app browser has no working geolocation, so players
 * must stay in their real browser: we bounce to the Phantom app to connect and sign the login message,
 * and Phantom redirects back here. Pure helpers only; the round-trip state lives in `pending*` below.
 *
 * The signature is still checked server-side by /api/auth/verify against the nonce cookie, exactly like
 * the injected-wallet path, so nothing decrypted here is trusted beyond "what to send to the server".
 */
export const PHANTOM_UL = "https://phantom.app/ul/v1";
export const CLUSTER = process.env.NEXT_PUBLIC_SOLANA_CLUSTER || "devnet";

export interface DappKeys { publicKey: string; secretKey: string } // base58, x25519 (nacl.box)
export function newDappKeys(): DappKeys {
  const kp = nacl.box.keyPair();
  return { publicKey: bs58.encode(kp.publicKey), secretKey: bs58.encode(kp.secretKey) };
}

function b58(v: string | null | undefined, len: number): Uint8Array | null {
  if (!v || v.length > 200) return null;
  try { const b = bs58.decode(v); return b.length === len ? b : null; } catch { return null; }
}

export function sharedSecret(phantomPub: string, dappSecret: string): Uint8Array | null {
  const p = b58(phantomPub, nacl.box.publicKeyLength);
  const s = b58(dappSecret, nacl.box.secretKeyLength);
  return p && s ? nacl.box.before(p, s) : null;
}

export function encryptPayload(obj: unknown, shared: Uint8Array): { nonce: string; payload: string } {
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const box = nacl.box.after(new TextEncoder().encode(JSON.stringify(obj)), nonce, shared);
  return { nonce: bs58.encode(nonce), payload: bs58.encode(box) };
}

export function decryptPayload(data: string | null, nonce: string | null, shared: Uint8Array): unknown {
  const n = b58(nonce, nacl.box.nonceLength);
  if (!n || !data || data.length > 4096) return null;
  let box: Uint8Array;
  try { box = bs58.decode(data); } catch { return null; }
  const plain = nacl.box.open.after(box, n, shared);
  if (!plain) return null;
  try { return JSON.parse(new TextDecoder().decode(plain)); } catch { return null; }
}

/**
 * Where Phantom should send the player back. iOS opens https links in the default browser (usually
 * Safari), so a player who started in iOS Chrome would land in a different browser with none of the
 * round-trip state. Chrome's own scheme reopens the page in Chrome instead.
 */
export function redirectLink(origin: string, ua: string): string {
  const u = new URL("/", origin);
  if (/CriOS\//.test(ua)) return `googlechromes://${u.host}${u.pathname}`;
  return u.toString();
}

export function connectUrl(o: { appUrl: string; dappPub: string; redirect: string }): string {
  const q = new URLSearchParams({ app_url: o.appUrl, dapp_encryption_public_key: o.dappPub, redirect_link: o.redirect, cluster: CLUSTER });
  return `${PHANTOM_UL}/connect?${q}`;
}

export function signMessageUrl(o: { dappPub: string; shared: Uint8Array; session: string; message: string; redirect: string }): string {
  const { nonce, payload } = encryptPayload({ message: bs58.encode(new TextEncoder().encode(o.message)), session: o.session, display: "utf8" }, o.shared);
  const q = new URLSearchParams({ dapp_encryption_public_key: o.dappPub, nonce, redirect_link: o.redirect, payload });
  return `${PHANTOM_UL}/signMessage?${q}`;
}

/** True when the URL carries a Phantom deeplink response (success or error). */
export function isPhantomReturn(p: URLSearchParams): boolean {
  return p.has("errorCode") || (p.has("nonce") && p.has("data"));
}

export type Parsed<T> = ({ ok: true } & T) | { ok: false; error: string; cancelled?: boolean };

function phantomError(p: URLSearchParams): Parsed<never> | null {
  if (!p.has("errorCode")) return null;
  // 4001 = user rejected; anything else is shown generically (errorMessage is attacker-controllable text)
  return p.get("errorCode") === "4001" ? { ok: false, error: "Cancelled in Phantom", cancelled: true } : { ok: false, error: "Phantom returned an error" };
}

const connectData = z.object({ public_key: z.string().min(32).max(44), session: z.string().min(1).max(2048) });
export function parseConnectReturn(p: URLSearchParams, dappSecret: string): Parsed<{ phantomPub: string; address: string; session: string }> {
  const err = phantomError(p);
  if (err) return err;
  const phantomPub = p.get("phantom_encryption_public_key") ?? "";
  const shared = sharedSecret(phantomPub, dappSecret);
  if (!shared) return { ok: false, error: "Bad response from Phantom" };
  const d = connectData.safeParse(decryptPayload(p.get("data"), p.get("nonce"), shared));
  if (!d.success || !b58(d.data.public_key, 32)) return { ok: false, error: "Bad response from Phantom" };
  return { ok: true, phantomPub, address: d.data.public_key, session: d.data.session };
}

const signData = z.object({ signature: z.string().min(64).max(100) });
export function parseSignReturn(p: URLSearchParams, phantomPub: string, dappSecret: string): Parsed<{ signature: string }> {
  const err = phantomError(p);
  if (err) return err;
  const shared = sharedSecret(phantomPub, dappSecret);
  if (!shared) return { ok: false, error: "Bad response from Phantom" };
  const d = signData.safeParse(decryptPayload(p.get("data"), p.get("nonce"), shared));
  if (!d.success || !b58(d.data.signature, 64)) return { ok: false, error: "Bad response from Phantom" };
  return { ok: true, signature: d.data.signature };
}

/* ---------- environment ---------- */

interface InjectedWin { phantom?: { solana?: { isPhantom?: boolean } }; solana?: unknown; solflare?: unknown; backpack?: unknown }
export function isMobileUA(ua: string, touchPoints = 0): boolean {
  // iPadOS reports a desktop Mac UA; touch support gives it away
  return /iPhone|iPad|iPod|Android/i.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1);
}
/** Mobile browser with no injected wallet: the deeplink flow is the only way to reach Phantom. */
export function shouldUseDeeplink(w: InjectedWin, ua: string, touchPoints = 0): boolean {
  return isMobileUA(ua, touchPoints) && !w.phantom?.solana && !w.solana && !w.solflare && !w.backpack;
}
/** Inside a wallet's in-app browser on a phone, where location never resolves. */
export function inWalletBrowser(w: InjectedWin, ua: string, touchPoints = 0): boolean {
  return isMobileUA(ua, touchPoints) && !!(w.phantom?.solana || w.solana || w.solflare || w.backpack);
}

/* ---------- round-trip state ---------- */

/**
 * Kept in localStorage, not sessionStorage: Phantom's redirect often opens a new tab, which gets a fresh
 * sessionStorage. The dapp key is single-use (it only decrypts this login's responses and can't move
 * funds); it expires after 10 minutes and is removed as soon as the round trip ends.
 */
export interface Pending {
  v: 1;
  step: "connect" | "sign";
  createdAt: number;
  dapp: DappKeys;
  phantomPub?: string;
  session?: string;
  address?: string;
  loginNonce?: string; // the /api/auth nonce the signed message embeds
}
const KEY = "lotus_phantom_dl";
export const PENDING_TTL_MS = 10 * 60_000;
const pendingSchema = z.object({
  v: z.literal(1),
  step: z.enum(["connect", "sign"]),
  createdAt: z.number(),
  dapp: z.object({ publicKey: z.string(), secretKey: z.string() }),
  phantomPub: z.string().optional(),
  session: z.string().optional(),
  address: z.string().optional(),
  loginNonce: z.string().optional(),
});

export function loadPending(store: Pick<Storage, "getItem" | "removeItem">, now = Date.now()): Pending | null {
  try {
    const raw = store.getItem(KEY);
    if (!raw) return null;
    const p = pendingSchema.safeParse(JSON.parse(raw));
    if (!p.success || now - p.data.createdAt > PENDING_TTL_MS || p.data.createdAt > now + 60_000) { store.removeItem(KEY); return null; }
    return p.data;
  } catch { return null; }
}
export function savePending(store: Pick<Storage, "setItem">, p: Pending): void { try { store.setItem(KEY, JSON.stringify(p)); } catch { /* storage blocked */ } }
export function clearPending(store: Pick<Storage, "removeItem">): void { try { store.removeItem(KEY); } catch { /* storage blocked */ } }
