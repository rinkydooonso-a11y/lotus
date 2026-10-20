"use client";
import { useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletReadyState } from "@solana/wallet-adapter-base";
import { useAuth } from "@/lib/auth/client";
import { Mark } from "./Logo";

export function ConnectSheet({ onClose }: { onClose?: () => void }) {
  const { wallets, select, connect, wallet, connecting } = useWallet();
  const { busy, error, user, phantomDeeplink, connectPhantom } = useAuth();
  // close once signed in; the sheet can be mounted by several parents that don't all watch `user`
  useEffect(() => { if (user) onClose?.(); }, [user, onClose]);
  const pick = async (name: (typeof wallets)[number]["adapter"]["name"]) => {
    select(name);
    // `connect` needs the selected adapter to be set; wait a tick
    setTimeout(() => { void connect().then(() => onClose?.()).catch(() => undefined); }, 50);
  };
  return (
    <div className="sheet-back modal" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <button className="x" onClick={onClose} aria-label="Close">✕</button>
        <div className="sheet-mark"><Mark size={44} /></div>
        <h2>Connect a wallet</h2>
        <p className="muted">Sign a free message to start hunting. No transaction, no fees.</p>
        <div className="stack">
          {wallets.map((w) => {
            // In a phone browser the adapter would reopen the site inside Phantom's browser, where location
            // doesn't work, so Phantom goes through the deeplink round trip and the player stays here.
            const viaDeeplink = phantomDeeplink && w.adapter.name === "Phantom";
            const installed = viaDeeplink || w.readyState === WalletReadyState.Installed || w.readyState === WalletReadyState.Loadable;
            return (
              <button key={w.adapter.name} className="row-btn" onClick={() => (viaDeeplink ? connectPhantom() : installed ? pick(w.adapter.name) : window.open(w.adapter.url, "_blank"))}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={w.adapter.icon} alt="" width={28} height={28} />
                <span>{w.adapter.name}</span>
                <span className={installed ? "chip ok" : "chip"}>{viaDeeplink ? "Open app" : installed ? (connecting && wallet?.adapter.name === w.adapter.name) || busy ? "Connecting…" : "Detected" : "Install"}</span>
              </button>
            );
          })}
        </div>
        {error && <p className="err">{error}</p>}
      </div>
    </div>
  );
}
