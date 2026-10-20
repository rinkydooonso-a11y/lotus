"use client";
import { useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletReadyState } from "@solana/wallet-adapter-base";
import { useAuth } from "@/lib/auth/client";

export function ConnectSheet({ onClose }: { onClose?: () => void }) {
  const { wallets, select, connect, wallet, connecting } = useWallet();
  const { busy, error, user } = useAuth();
  // close once signed in; the sheet can be mounted by several parents that don't all watch `user`
  useEffect(() => { if (user) onClose?.(); }, [user, onClose]);
  const pick = async (name: (typeof wallets)[number]["adapter"]["name"]) => {
    select(name);
    // `connect` needs the selected adapter to be set; wait a tick
    setTimeout(() => { void connect().then(() => onClose?.()).catch(() => undefined); }, 50);
  };
  return (
    <div className="sheet-back" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <h2>Connect a wallet</h2>
        <p className="muted">Sign a free message to log in. No transaction, no fees.</p>
        <div className="stack">
          {wallets.map((w) => {
            const installed = w.readyState === WalletReadyState.Installed || w.readyState === WalletReadyState.Loadable;
            return (
              <button key={w.adapter.name} className="row-btn" onClick={() => (installed ? pick(w.adapter.name) : window.open(w.adapter.url, "_blank"))}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={w.adapter.icon} alt="" width={28} height={28} />
                <span>{w.adapter.name}</span>
                <span className="muted small">{installed ? (connecting && wallet?.adapter.name === w.adapter.name) || busy ? "Connecting…" : "Detected" : "Install"}</span>
              </button>
            );
          })}
        </div>
        {error && <p className="err">{error}</p>}
      </div>
    </div>
  );
}
