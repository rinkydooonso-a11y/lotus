"use client";
import { useEffect, useState } from "react";
import { inWalletBrowser } from "@/lib/auth/phantomDeeplink";

/** Wallet in-app browsers on phones never answer the location prompt; send players to their real browser. */
export function useInWalletBrowser(): boolean {
  const [v, setV] = useState(false);
  useEffect(() => { setV(inWalletBrowser(window as never, navigator.userAgent, navigator.maxTouchPoints ?? 0)); }, []);
  return v;
}

export function WalletBrowserNotice() {
  const [copied, setCopied] = useState(false);
  const copy = () => { void navigator.clipboard?.writeText(window.location.origin).then(() => setCopied(true)).catch(() => undefined); };
  return (
    <>
      <p className="eyebrow">Wrong browser</p>
      <h2>Open CardQuest in <em>Safari or Chrome.</em></h2>
      <p className="muted">Location doesn&apos;t work inside the wallet&apos;s browser. You can still sign in with Phantom from Safari or Chrome.</p>
      <button className="btn wide" onClick={copy}>{copied ? "Link copied" : "Copy link"}</button>
    </>
  );
}
