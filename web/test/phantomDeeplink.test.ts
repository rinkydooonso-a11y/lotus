import { describe, expect, it } from "vitest";
import nacl from "tweetnacl";
import bs58 from "bs58";
import * as dl from "../lib/auth/phantomDeeplink";

const IOS_SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IOS_CHROME = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1";
const ANDROID_CHROME = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const DESKTOP = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/** Plays Phantom's side of the protocol: reads our request URL, answers like the app would. */
function fakePhantom() {
  const enc = nacl.box.keyPair();
  const wallet = nacl.sign.keyPair();
  const session = "phantom-session-token";
  const box = (dappPub: string, obj: unknown) => {
    const shared = nacl.box.before(bs58.decode(dappPub), enc.secretKey);
    const nonce = nacl.randomBytes(24);
    return { nonce: bs58.encode(nonce), data: bs58.encode(nacl.box.after(new TextEncoder().encode(JSON.stringify(obj)), nonce, shared)) };
  };
  return {
    wallet, pub: bs58.encode(enc.publicKey),
    connect(url: string) {
      const q = new URL(url).searchParams;
      const { nonce, data } = box(q.get("dapp_encryption_public_key")!, { public_key: bs58.encode(wallet.publicKey), session });
      return { redirect: q.get("redirect_link")!, params: new URLSearchParams({ phantom_encryption_public_key: bs58.encode(enc.publicKey), nonce, data }) };
    },
    signMessage(url: string) {
      const q = new URL(url).searchParams;
      const dappPub = q.get("dapp_encryption_public_key")!;
      const shared = nacl.box.before(bs58.decode(dappPub), enc.secretKey);
      const req = JSON.parse(new TextDecoder().decode(nacl.box.open.after(bs58.decode(q.get("payload")!), bs58.decode(q.get("nonce")!), shared)!));
      expect(req.session).toBe(session);
      const sig = nacl.sign.detached(bs58.decode(req.message), wallet.secretKey);
      const { nonce, data } = box(dappPub, { signature: bs58.encode(sig) });
      return { message: new TextDecoder().decode(bs58.decode(req.message)), params: new URLSearchParams({ nonce, data }) };
    },
  };
}

describe("phantom deeplink", () => {
  it("full connect + signMessage round trip yields a signature the server would accept", () => {
    const phantom = fakePhantom();
    const dapp = dl.newDappKeys();
    const redirect = dl.redirectLink("https://lotus.example", IOS_SAFARI);
    const cu = dl.connectUrl({ appUrl: "https://lotus.example", dappPub: dapp.publicKey, redirect });
    expect(cu.startsWith("https://phantom.app/ul/v1/connect?")).toBe(true);
    expect(new URL(cu).searchParams.get("cluster")).toBe("devnet");

    const back = phantom.connect(cu);
    expect(back.redirect).toBe("https://lotus.example/");
    expect(dl.isPhantomReturn(back.params)).toBe(true);
    const c = dl.parseConnectReturn(back.params, dapp.secretKey);
    if (!c.ok) throw new Error(c.error);
    expect(c.address).toBe(bs58.encode(phantom.wallet.publicKey));

    const message = "Sign in to Lotus\nNonce: abc123";
    const shared = dl.sharedSecret(c.phantomPub, dapp.secretKey)!;
    const su = dl.signMessageUrl({ dappPub: dapp.publicKey, shared, session: c.session, message, redirect });
    // nothing but the protocol's own params goes in the URL
    expect([...new URL(su).searchParams.keys()].sort()).toEqual(["dapp_encryption_public_key", "nonce", "payload", "redirect_link"]);
    expect(su).not.toContain(dapp.secretKey);

    const signed = phantom.signMessage(su);
    expect(signed.message).toBe(message);
    const s = dl.parseSignReturn(signed.params, c.phantomPub, dapp.secretKey);
    if (!s.ok) throw new Error(s.error);
    // same check /api/auth/verify does
    expect(nacl.sign.detached.verify(new TextEncoder().encode(message), bs58.decode(s.signature), bs58.decode(c.address))).toBe(true);
  });

  it("rejects responses encrypted for a different dapp key", () => {
    const phantom = fakePhantom();
    const dapp = dl.newDappKeys();
    const other = dl.newDappKeys();
    const back = phantom.connect(dl.connectUrl({ appUrl: "https://x.example", dappPub: other.publicKey, redirect: "https://x.example/" }));
    expect(dl.parseConnectReturn(back.params, dapp.secretKey).ok).toBe(false);
  });

  it("rejects tampered or malformed params", () => {
    const phantom = fakePhantom();
    const dapp = dl.newDappKeys();
    const back = phantom.connect(dl.connectUrl({ appUrl: "https://x.example", dappPub: dapp.publicKey, redirect: "https://x.example/" }));
    const data = bs58.decode(back.params.get("data")!);
    data[0] ^= 1;
    const tampered = new URLSearchParams(back.params);
    tampered.set("data", bs58.encode(data));
    expect(dl.parseConnectReturn(tampered, dapp.secretKey).ok).toBe(false);
    for (const [k, v] of [["phantom_encryption_public_key", "notbase58!!"], ["phantom_encryption_public_key", bs58.encode(new Uint8Array(31))], ["nonce", "0OIl"], ["data", ""]] as const) {
      const p = new URLSearchParams(back.params); p.set(k, v);
      expect(dl.parseConnectReturn(p, dapp.secretKey).ok).toBe(false);
    }
    expect(dl.parseSignReturn(new URLSearchParams({ nonce: back.params.get("nonce")!, data: "x" }), phantom.pub, dapp.secretKey).ok).toBe(false);
  });

  it("maps Phantom errors without echoing their message", () => {
    const dapp = dl.newDappKeys();
    const r = dl.parseConnectReturn(new URLSearchParams({ errorCode: "4001", errorMessage: "<script>" }), dapp.secretKey);
    expect(r).toEqual({ ok: false, error: "Cancelled in Phantom", cancelled: true });
    const r2 = dl.parseSignReturn(new URLSearchParams({ errorCode: "-32603", errorMessage: "evil text" }), "x", dapp.secretKey);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error).not.toContain("evil");
  });

  it("decryptPayload returns null on bad input", () => {
    const shared = new Uint8Array(32);
    expect(dl.decryptPayload(null, null, shared)).toBeNull();
    expect(dl.decryptPayload("abc", bs58.encode(new Uint8Array(24)), shared)).toBeNull();
    const { nonce, payload } = dl.encryptPayload({ a: 1 }, shared);
    expect(dl.decryptPayload(payload, nonce, shared)).toEqual({ a: 1 });
  });

  it("sends iOS Chrome back to Chrome, everyone else to the https origin", () => {
    expect(dl.redirectLink("https://lotus-liart-psi.vercel.app", IOS_CHROME)).toBe("googlechromes://lotus-liart-psi.vercel.app/");
    expect(dl.redirectLink("https://lotus-liart-psi.vercel.app", IOS_SAFARI)).toBe("https://lotus-liart-psi.vercel.app/");
    expect(dl.redirectLink("https://lotus-liart-psi.vercel.app", ANDROID_CHROME)).toBe("https://lotus-liart-psi.vercel.app/");
  });

  it("picks the deeplink path only in mobile browsers without an injected wallet", () => {
    expect(dl.shouldUseDeeplink({}, IOS_SAFARI)).toBe(true);
    expect(dl.shouldUseDeeplink({}, IOS_CHROME)).toBe(true);
    expect(dl.shouldUseDeeplink({}, ANDROID_CHROME)).toBe(true);
    expect(dl.shouldUseDeeplink({}, DESKTOP)).toBe(false);
    expect(dl.shouldUseDeeplink({}, DESKTOP, 5)).toBe(true); // iPadOS
    expect(dl.shouldUseDeeplink({ phantom: { solana: { isPhantom: true } } }, IOS_SAFARI)).toBe(false);
    expect(dl.inWalletBrowser({ phantom: { solana: { isPhantom: true } } }, IOS_SAFARI)).toBe(true);
    expect(dl.inWalletBrowser({ phantom: { solana: { isPhantom: true } } }, DESKTOP)).toBe(false); // desktop extension
    expect(dl.inWalletBrowser({}, IOS_SAFARI)).toBe(false);
  });

  it("pending state survives a new tab via storage, expires, and rejects junk", () => {
    const m = new Map<string, string>();
    const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
    const p: dl.Pending = { v: 1, step: "connect", createdAt: 1_000_000, dapp: dl.newDappKeys() };
    dl.savePending(store, p);
    expect(dl.loadPending(store, 1_000_000 + 60_000)).toEqual(p);
    expect(dl.loadPending(store, 1_000_000 + dl.PENDING_TTL_MS + 1)).toBeNull();
    expect(m.size).toBe(0); // expired entry is removed
    m.set("lotus_phantom_dl", "{not json");
    expect(dl.loadPending(store)).toBeNull();
    m.set("lotus_phantom_dl", JSON.stringify({ v: 2 }));
    expect(dl.loadPending(store)).toBeNull();
    dl.savePending(store, p); dl.clearPending(store);
    expect(m.size).toBe(0);
  });
});
