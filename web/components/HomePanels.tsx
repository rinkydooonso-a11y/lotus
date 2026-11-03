"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth/client";
import { SERVICE_CITIES } from "@/lib/cities";
import { setCity } from "@/lib/cityStore";
import { MAX_TICKETS } from "@/lib/rules";
import { ConnectSheet } from "./ConnectSheet";
import { openFilm } from "./Film";
import { IconPlay, Shard, Ticket } from "./Icons";
import { QrCard } from "./QrCard";
import { useInWalletBrowser, WalletBrowserNotice } from "./WalletBrowserNotice";

export function WatchButton({ label = "Watch the film", className = "btn btn-lg btn-gray" }: { label?: string; className?: string }) {
  return <button className={className} onClick={openFilm}><IconPlay size={15} />{label}</button>;
}

export function ConnectButton({ className = "btn btn-lg", label = "Connect wallet to play" }: { className?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={className} onClick={() => setOpen(true)}>{label}</button>
      {open && <ConnectSheet onClose={() => setOpen(false)} />}
    </>
  );
}

/** The pitch over the globe: the headline, one sentence, the action, and the phone hand-off. */
export function HeroCopy() {
  const { user, balances } = useAuth();
  const walletBrowser = useInWalletBrowser();
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    void fetch("/api/where").then((r) => r.json()).then((j: { city: string | null }) => { if (j.city) setCity(j.city, false); }).catch(() => undefined);
  }, []);
  return (
    <div className="hero-copy">
      <h1 className="hero-title">Real cards.<br /><em>Hidden in<br />the street.</em></h1>
      <p className="hero-lede">Crates of graded trading cards are dropped on real streets. Walk to one, open it, and the card goes straight to your wallet.</p>
      {walletBrowser && !user ? <WalletBrowserNotice /> : (
        <div className="hero-actions">
          {!user && <ConnectButton className="btn btn-lg show-phone" label="Connect wallet to play" />}
          {user && balances && (
            <Link href="/history" className="hero-bal" aria-label="Your shards and tickets">
              <span><Shard size={18} /><b className="num">{balances.shards}</b><small>/ {balances.shardsPerTicket} shards</small></span>
              <span><Ticket size={18} /><b className="num">{balances.tickets}</b><small>/ {MAX_TICKETS} tickets</small></span>
            </Link>
          )}
          
        </div>
      )}
      <div className="hero-qr hide-phone"><QrCard className="qr-card" /></div>
    </div>
  );
}
