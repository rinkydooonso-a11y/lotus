"use client";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletReadyState } from "@solana/wallet-adapter-base";
import { useAuth } from "@/lib/auth/client";
import { Icon } from "./Icon";
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
  // Portalled to <body>: the glass header's backdrop-filter would otherwise trap this fixed sheet inside the header.
  return createPortal(
    <div className="sheet-back modal" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <button className="x" onClick={onClose} aria-label="Close"><Icon name="close" size={14} /></button>
        <div className="sheet-mark"><Mark size={44} /></div>
        <h2>Connect a wallet</h2>
        <p className="muted sheet-p">Sign a free message to start hunting. No transaction, no fees.</p>
        <div className="stack list-group">
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
                <span className={installed ? "row-status ok" : "row-status"}>{viaDeeplink ? "Open app" : installed ? (connecting && wallet?.adapter.name === w.adapter.name) || busy ? "Connecting…" : "Detected" : "Install"}</span>
                <Icon name="chevron" size={16} className="row-chev" />
              </button>
            );
          })}
        </div>
        {error && <p className="err">{error}</p>}
      </div>
    </div>,
    document.body,
  );
}
