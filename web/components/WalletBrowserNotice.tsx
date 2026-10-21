"use client";
import { useEffect, useState } from "react";
import { inWalletBrowser } from "@/lib/auth/phantomDeeplink";
import { IconCheck, IconCopy } from "./Icons";

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
    <div className="notice">
      <p className="notice-kicker">Wrong browser</p>
      <h2>Open CardQuest in Safari or Chrome.</h2>
      <p>Location doesn&apos;t work inside the wallet&apos;s browser. You can still sign in with Phantom from Safari or Chrome.</p>
      <button className="btn btn-lg wide" onClick={copy}>{copied ? <><IconCheck size={18} />Link copied</> : <><IconCopy size={18} />Copy link</>}</button>
    </div>
  );
}
