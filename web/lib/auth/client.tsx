"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import bs58 from "bs58";
import type { Balances } from "../types";
import * as dl from "./phantomDeeplink";

/**
 * Client auth module. UI only talks to `useAuth()`. To add email login later,
 * add another method here (e.g. `signInWithEmail`) that ends in a /api/auth/* call setting the same session cookie.
 */
export interface AuthUser { address: string; method: "wallet" | "email"; isAdmin: boolean }
interface AuthCtx {
  user: AuthUser | null;
  balances: Balances | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
  signInWithWallet: () => Promise<void>;
  signOut: () => Promise<void>;
  setBalances: (b: Balances) => void;
  refresh: () => Promise<void>;
  /** Mobile browser without an injected wallet: Phantom is reached through its deeplink round trip. */
  phantomDeeplink: boolean;
  /** Back from Phantom's connect step, waiting for a tap to open Phantom again and sign. */
  phantomSign: { address: string; ready: boolean } | null;
  connectPhantom: () => void;
  continuePhantomSign: () => void;
  cancelPhantom: () => void;
}
const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { publicKey, signMessage, disconnect, connected } = useWallet();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [balances, setBalances] = useState<Balances | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phantomDeeplink, setPhantomDeeplink] = useState(false);
  const [phantomSign, setPhantomSign] = useState<{ address: string; ready: boolean } | null>(null);
  // login message prefetched before the sign tap, so the tap can navigate synchronously (iOS only opens
  // the Phantom app for universal links followed from a user gesture)
  const signMsg = useRef<{ nonce: string; message: string; at: number } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/me", { cache: "no-store" });
      const j = (await r.json()) as { user: AuthUser | null; balances?: Balances };
      setUser(j.user);
      setBalances(j.balances ?? null);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const fetchNonce = useCallback(async () => {
    const n = (await (await fetch("/api/auth/nonce", { cache: "no-store" })).json()) as { nonce: string; message: string };
    signMsg.current = { ...n, at: Date.now() };
    return n;
  }, []);

  const toSignStep = useCallback(async (address: string) => {
    setPhantomSign({ address, ready: false });
    try { await fetchNonce(); setPhantomSign({ address, ready: true }); }
    catch { setError("Couldn't start sign-in, check your connection"); }
  }, [fetchNonce]);

  // Phantom deeplink: detect environment and handle the redirect back from the Phantom app
  const handledReturn = useRef(false);
  useEffect(() => {
    if (handledReturn.current) return; // once per page load (StrictMode runs effects twice in dev)
    handledReturn.current = true;
    const touch = navigator.maxTouchPoints ?? 0;
    setPhantomDeeplink(dl.shouldUseDeeplink(window as never, navigator.userAgent, touch));
    const params = new URLSearchParams(window.location.search);
    const pending = dl.loadPending(localStorage);
    if (!dl.isPhantomReturn(params)) {
      if (pending?.step === "sign" && pending.address) void toSignStep(pending.address); // e.g. page reloaded mid-flow
      return;
    }
    // strip Phantom's params so a reload or shared link can't replay them
    window.history.replaceState(null, "", window.location.pathname + window.location.hash);
    if (!pending) { setError("Sign-in expired. Open CardQuest in the browser you started in and try again."); return; }

    if (pending.step === "connect") {
      const r = dl.parseConnectReturn(params, pending.dapp.secretKey);
      if (!r.ok) { dl.clearPending(localStorage); if (!r.cancelled) setError(r.error); return; }
      dl.savePending(localStorage, { ...pending, step: "sign", phantomPub: r.phantomPub, session: r.session, address: r.address });
      void toSignStep(r.address);
      return;
    }

    if (!pending.phantomPub || !pending.address || !pending.loginNonce) { dl.clearPending(localStorage); setError("Sign-in failed"); return; }
    const r = dl.parseSignReturn(params, pending.phantomPub, pending.dapp.secretKey);
    if (!r.ok) {
      // keep the Phantom session so they can retry the signature without reconnecting
      if (!r.cancelled) setError(r.error);
      void toSignStep(pending.address);
      return;
    }
    const address = pending.address;
    setBusy(true);
    void (async () => {
      try {
        const v = await fetch("/api/auth/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address, signature: r.signature, nonce: pending.loginNonce }) });
        if (!v.ok) {
          setError(v.status === 401 ? "Sign-in timed out, tap to sign again" : "Sign-in failed");
          void toSignStep(address);
          return;
        }
        dl.clearPending(localStorage);
        await refresh();
      } catch { setError("Sign-in failed"); void toSignStep(address); }
      finally { setBusy(false); }
    })();
  }, [refresh, toSignStep]);

  // the server nonce lives 5 minutes; keep the prefetched one fresh while the sign prompt is up
  useEffect(() => {
    if (!phantomSign?.ready) return;
    const t = setInterval(() => { void fetchNonce().catch(() => undefined); }, 4 * 60_000);
    return () => clearInterval(t);
  }, [phantomSign?.ready, fetchNonce]);

  const connectPhantom = useCallback(() => {
    setError(null);
    const dapp = dl.newDappKeys();
    dl.savePending(localStorage, { v: 1, step: "connect", createdAt: Date.now(), dapp });
    window.location.href = dl.connectUrl({ appUrl: window.location.origin, dappPub: dapp.publicKey, redirect: dl.redirectLink(window.location.origin, navigator.userAgent) });
  }, []);

  const continuePhantomSign = useCallback(() => {
    const pending = dl.loadPending(localStorage);
    const m = signMsg.current;
    const shared = pending?.phantomPub ? dl.sharedSecret(pending.phantomPub, pending.dapp.secretKey) : null;
    if (!pending || pending.step !== "sign" || !pending.session || !shared) { setPhantomSign(null); setError("Sign-in expired, connect again"); return; }
    if (!m) { setError("Still preparing, try again in a second"); return; }
    setError(null);
    // restart the 10 minute window so a slow signature doesn't expire the key mid-flight
    dl.savePending(localStorage, { ...pending, loginNonce: m.nonce, createdAt: Date.now() });
    window.location.href = dl.signMessageUrl({ dappPub: pending.dapp.publicKey, shared, session: pending.session, message: m.message, redirect: dl.redirectLink(window.location.origin, navigator.userAgent) });
  }, []);

  const cancelPhantom = useCallback(() => { dl.clearPending(localStorage); signMsg.current = null; setPhantomSign(null); }, []);

  const signInWithWallet = useCallback(async () => {
    if (!publicKey || !signMessage) { setError("Wallet can't sign messages"); return; }
    setBusy(true); setError(null);
    try {
      const n = (await (await fetch("/api/auth/nonce", { cache: "no-store" })).json()) as { nonce: string; message: string };
      const sig = await signMessage(new TextEncoder().encode(n.message));
      const r = await fetch("/api/auth/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: publicKey.toBase58(), signature: bs58.encode(sig), nonce: n.nonce }) });
      if (!r.ok) throw new Error("Sign-in failed");
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Sign-in failed"); }
    finally { setBusy(false); }
  }, [publicKey, signMessage, refresh]);

  // once a wallet connects and there's no session (or a different wallet), ask for the signature
  useEffect(() => {
    if (loading || busy || !connected || !publicKey) return;
    if (!user || user.address !== publicKey.toBase58()) void signInWithWallet();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, publicKey, loading, user?.address]);

  const signOut = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null); setBalances(null);
    cancelPhantom();
    await disconnect().catch(() => undefined);
  }, [disconnect, cancelPhantom]);

  useEffect(() => { if (user) { setPhantomSign(null); signMsg.current = null; } }, [user]);

  const value = useMemo(
    () => ({ user, balances, loading, busy, error, signInWithWallet, signOut, setBalances, refresh, phantomDeeplink, phantomSign, connectPhantom, continuePhantomSign, cancelPhantom }),
    [user, balances, loading, busy, error, signInWithWallet, signOut, refresh, phantomDeeplink, phantomSign, connectPhantom, continuePhantomSign, cancelPhantom],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function useAuth(): AuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth outside AuthProvider");
  return c;
}
