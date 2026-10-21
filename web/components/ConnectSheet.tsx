"use client";
import { useEffect } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletReadyState } from "@solana/wallet-adapter-base";
import { useAuth } from "@/lib/auth/client";
import { Mark } from "./Logo";
import { Sheet } from "./Sheet";
import { IconChevronRight } from "./Icons";

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
    <Sheet onClose={onClose} label="Connect a wallet">
      <div className="sheet-head">
        <Mark size={48} />
        <h2>Connect a wallet</h2>
        <p>Sign a free message to start hunting. No transaction, no fees.</p>
      </div>
      <div className="group">
        {wallets.map((w) => {
          // In a phone browser the adapter would reopen the site inside Phantom's browser, where location
          // doesn't work, so Phantom goes through the deeplink round trip and the player stays here.
          const viaDeeplink = phantomDeeplink && w.adapter.name === "Phantom";
          const installed = viaDeeplink || w.readyState === WalletReadyState.Installed || w.readyState === WalletReadyState.Loadable;
          const status = viaDeeplink ? "Open app" : installed ? (connecting && wallet?.adapter.name === w.adapter.name) || busy ? "Connecting…" : "Detected" : "Install";
          return (
            <button key={w.adapter.name} className="group-row wallet-row" onClick={() => (viaDeeplink ? connectPhantom() : installed ? pick(w.adapter.name) : window.open(w.adapter.url, "_blank"))}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={w.adapter.icon} alt="" width={32} height={32} />
              <span className="grow">{w.adapter.name}</span>
              <span className={installed ? "wallet-status ok" : "wallet-status"}>{status}</span>
              <IconChevronRight size={16} className="row-chev" />
            </button>
          );
        })}
      </div>
      {error && <p className="err">{error}</p>}
      <p className="sheet-fine">18+ only. By connecting you agree to the <Link href="/terms" onClick={onClose}>Terms of Play</Link>.</p>
    </Sheet>
  );
}
