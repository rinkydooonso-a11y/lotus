"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth/client";
import { SERVICE_CITIES } from "@/lib/cities";
import { pickCity, setCity, useCity } from "@/lib/cityStore";
import { setExploring } from "@/lib/viewStore";
import { usd } from "@/lib/format";
import { COIN_HOLD_USD, FREE_OPENS_PER_DAY } from "@/lib/rules";
import { OPEN_RADIUS_M } from "@/lib/geo";
import { LINKS, coinLive } from "@/lib/links";
import type { Feed, VaultStats } from "@/lib/types";
import { ConnectSheet } from "./ConnectSheet";
import { openFilm } from "./Film";
import { IconArrowUpRight, IconPlay, Shard, Ticket } from "./Icons";
import { QrCard } from "./QrCard";
import { PullsShowcase } from "./PullsFeed";
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

/** The opening screen: one loud headline, one action (a QR on desktop, since crates only open on a phone), and a tile of art. */
export function Hero({ map }: { map: React.ReactNode }) {
  const { user, balances } = useAuth();
  const walletBrowser = useInWalletBrowser();
  const n = SERVICE_CITIES.length;
  return (
    <section className="hero2">
      <div className="hero2-in wrap">
        <div className="hero2-copy">
          <p className="tagline"><span className="live-dot" />Live in {n} cities</p>
          <h1 className="hero2-title">Find the crate.<br /><em>Pull the card.</em></h1>
          <p className="hero2-lede">Graded trading cards are hidden in crates on real streets. Walk up to one with your phone, open it, and the card goes straight to your wallet.</p>
          {walletBrowser && !user ? <WalletBrowserNotice /> : (
            <div className="hero2-actions">
              {!user && <ConnectButton className="btn btn-lg show-phone" label="Connect wallet to play" />}
              {user && balances && (
                <Link href="/history" className="hero-bal" aria-label="Your shards and tickets">
                  <span><Shard size={18} /><b className="num">{balances.shards}</b><small>/ {balances.shardsPerTicket} shards</small></span>
                  <span><Ticket size={18} /><b className="num">{balances.tickets}</b></span>
                </Link>
              )}
              <Link href="/how" className="btn btn-lg btn-gray">How it works</Link>
            </div>
          )}
          <div className="hero2-qr hide-phone"><QrCard className="qr-card" /></div>
        </div>
        <div className="hero2-map">{map}</div>
      </div>
    </section>
  );
}

/** Scrolling strip of the latest pulls, with house phrases as filler so it is never empty. */
export function Marquee({ feed }: { feed: Feed | null }) {
  const pulls = (feed?.recent ?? []).slice(0, 6).map((p) => `${p.grade} ${p.cardName} ${usd(p.valueUsd)}`);
  const base = [`${SERVICE_CITIES.length} cities live`, `${FREE_OPENS_PER_DAY} free opens a day`, "Real graded cards", `Open within ${OPEN_RADIUS_M} m`, "Sent to your wallet"];
  const items = pulls.length ? [...pulls.map((t) => `Just pulled: ${t}`), ...base] : base;
  const row = (k: string) => <div className="mq-row" aria-hidden={k === "b"} key={k}>{items.map((t, i) => <span key={i}>{t}<i /></span>)}</div>;
  return <div className="mq" role="marquee" aria-label="Latest pulls"><div className="mq-track">{row("a")}{row("b")}</div></div>;
}

const STEPS = [
  { t: "Connect a wallet", d: "Phantom, Solflare or Backpack. Signing in is a free message, never a transaction." },
  { t: "Walk to a crate", d: `Crates sit on streets, paths and parks in ${SERVICE_CITIES.length} cities. Get within ${OPEN_RADIUS_M} metres to open one. First to arrive takes it.` },
  { t: "Open it", d: `${FREE_OPENS_PER_DAY} free opens a day. Pull a graded card, sent straight to your wallet, or shards that add up to tickets for extra opens.` },
];

/** The counter: a paper-white band, so the page breaks rhythm. */
export function HowSection() {
  return (
    <section className="paper" id="how-it-works">
      <div className="wrap">
        <div className="sec-head">
          <p className="eyebrow">How it works</p>
          <h2 className="big-h">Three steps.<br />One walk.</h2>
        </div>
        <ol className="how-list">
          {STEPS.map((s, i) => (
            <li key={s.t}><span className="how-n">0{i + 1}</span><div><h3>{s.t}</h3><p>{s.d}</p></div></li>
          ))}
        </ol>
        <div className="how-actions">
          <WatchButton label="Watch the film" className="btn btn-lg btn-ink" />
          <Link href="/how" className="ink-link">Read the full guide<IconArrowUpRight size={15} /></Link>
        </div>
      </div>
    </section>
  );
}

export function PullsSection({ feed }: { feed: Feed | null }) {
  return (
    <section className="pulls-sec" id="pulls">
      <div className="wrap sec-head">
        <p className="eyebrow"><span className="live-dot" />Live pulls</p>
        <h2 className="big-h">Real cards. Real streets.</h2>
        <p className="sec-sub">Every prize is a professionally graded card from a public vault, sent to the winner&apos;s wallet.</p>
      </div>
      <PullsShowcase feed={feed} />
    </section>
  );
}

/** Title and city list above the globe. Picking a city flies the globe there; it never asks for location. */
export function GlobeHead() {
  const city = useCity();
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    void fetch("/api/where").then((r) => r.json()).then((j: { city: string | null }) => { if (j.city) setCity(j.city, false); }).catch(() => undefined);
  }, []);
  return (
    <div className="globe-head">
      <div className="sec-head">
        <p className="eyebrow">Where it&apos;s live</p>
        <h2 className="big-h">{SERVICE_CITIES.length} cities.<br />One map.</h2>
        <p className="sec-sub">Crates only open on a phone, standing next to them. More cities open as the vault grows.</p>
        <button className="btn btn-lg" onClick={() => setExploring(true)}>Explore the map full screen</button>
      </div>
      <ul className="city-grid" aria-label="Launch cities">
        {SERVICE_CITIES.map((c, i) => (
          <li key={c.name}><button className={c.name === city ? "on" : ""} onClick={() => pickCity(c.name)}><span className="mono">{String(i + 1).padStart(2, "0")}</span>{c.name}</button></li>
        ))}
      </ul>
    </div>
  );
}

export function NumbersBand({ feed }: { feed: Feed | null }) {
  const [vault, setVault] = useState<VaultStats | null>(null);
  useEffect(() => { void fetch("/api/vault").then((r) => (r.ok ? r.json() : null)).then((v: VaultStats | null) => v && setVault(v)).catch(() => undefined); }, []);
  const n = (x: number) => x.toLocaleString("en-US");
  const cells = [
    { v: String(SERVICE_CITIES.length), l: "cities live" },
    { v: vault ? n(vault.cardsInVault) : "–", l: "cards in the vault", href: LINKS.vault },
    { v: String(FREE_OPENS_PER_DAY), l: "free opens a day" },
    { v: feed ? usd(feed.totals.wonUsd) : "–", l: "won by players" },
  ];
  return (
    <section className="numbers">
      <div className="wrap nums-grid">
        {cells.map((c) => (
          <div key={c.l} className="nums-cell"><b className="num">{c.v}</b><span>{c.l}</span>{c.href && <a href={c.href} target="_blank" rel="noopener noreferrer">See them<IconArrowUpRight size={13} /></a>}</div>
        ))}
      </div>
    </section>
  );
}

export function FinalCta() {
  const { user, loading } = useAuth();
  return (
    <section className="final">
      <div className="wrap final-in">
        <h2 className="big-h">Your first crate<br />is waiting.</h2>
        <div className="final-side">
          <p>{coinLive ? `Hold $${COIN_HOLD_USD} of ${LINKS.ticker} to open crates.` : "Free to play."} 18+. Play where it&apos;s safe and legal.</p>
          <div className="hero2-qr hide-phone"><QrCard className="qr-card ink" /></div>
          {!loading && !user && <ConnectButton className="btn btn-lg btn-ink show-phone" label="Connect wallet to play" />}
        </div>
      </div>
    </section>
  );
}

