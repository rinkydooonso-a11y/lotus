"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import bs58 from "bs58";
import type { Balances } from "../types";

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
}
const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { publicKey, signMessage, disconnect, connected } = useWallet();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [balances, setBalances] = useState<Balances | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/me", { cache: "no-store" });
      const j = (await r.json()) as { user: AuthUser | null; balances?: Balances };
      setUser(j.user);
      setBalances(j.balances ?? null);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

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
    await disconnect().catch(() => undefined);
  }, [disconnect]);

  const value = useMemo(() => ({ user, balances, loading, busy, error, signInWithWallet, signOut, setBalances, refresh }), [user, balances, loading, busy, error, signInWithWallet, signOut, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function useAuth(): AuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth outside AuthProvider");
  return c;
}
