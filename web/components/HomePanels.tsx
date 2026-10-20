"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth/client";
import { SERVICE_CITIES } from "@/lib/cities";
import { pickCity, setCity, useCity } from "@/lib/cityStore";
import { usd } from "@/lib/format";
import type { VaultStats } from "@/lib/types";
import { CitySwap } from "./CitySwap";
import { ConnectSheet } from "./ConnectSheet";
import { openFilm } from "./Film";
import { PullsFeed, useFeed } from "./PullsFeed";
import { QrCard } from "./QrCard";

/** A number that ticks in whenever it changes. */
function Tick({ v }: { v: string }) {
  return <b key={v} className="tick">{v}</b>;
}

export function WatchButton({ className = "" }: { className?: string }) {
  return (
    <button className={`watch ${className}`} onClick={openFilm}>
      <span className="watch-play" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 16 16"><path d="M4 2.5v11L13 8z" fill="#fff" /></svg></span>
      <span className="watch-text"><b>Watch the film</b><small>See how CardQuest works</small></span>
    </button>
  );
}

/** Desktop overlays around the map: pitch + QR on the left, live pulls on the right, cities and live stats along the bottom. */
export function HomePanels() {
  const { user, balances, loading } = useAuth();
  const feed = useFeed();
  const city = useCity();
  const [vault, setVault] = useState<VaultStats | null>(null);
  const [connect, setConnect] = useState(false);
  const [exploring, setExploring] = useState(false);
  const asked = useRef(false);

  useEffect(() => {
    void fetch("/api/vault").then((r) => (r.ok ? r.json() : null)).then((v: VaultStats | null) => v && setVault(v)).catch(() => undefined);
    if (asked.current) return;
    asked.current = true;
    void fetch("/api/where").then((r) => r.json()).then((j: { city: string | null }) => { if (j.city) setCity(j.city, false); }).catch(() => undefined);
  }, []);

  const cityBar = useRef<HTMLElement>(null);
  // Keep the order stable (so a pill never jumps under the cursor) and scroll the selected one into view.
  useEffect(() => { cityBar.current?.querySelector(".on")?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" }); }, [city]);
  return (
    <>
      <div className={exploring ? "desk-columns exploring" : "desk-columns"}>
        <section className="desk-panel desk-left">
          <h1 className="desk-title">Graded cards are dropping in <CitySwap /></h1>
          <p className="desk-lede">Crates land on the streets around you. Walk to one, open it on your phone, and a real graded card could be yours.</p>
          {!loading && !user && <button className="pill primary" onClick={() => setConnect(true)}>Connect wallet to play</button>}
          {user && balances && (
            <div className="desk-me">
              <div><span className="eyebrow">Shards</span><b>◆ {balances.shards}<small> / 10</small></b><i className="bar"><i style={{ width: `${balances.shards * 10}%` }} /></i></div>
              <div><span className="eyebrow">Tickets</span><b className="gold">🎟 {balances.tickets}<small> / 5</small></b></div>
            </div>
          )}
          <WatchButton className="desk-watch" />
          <QrCard />
          <p className="desk-foot">You have to be next to a crate to open it, so bring your phone.</p>
          <p className="desk-foot desk-legal">18+ · <Link href="/terms">Terms</Link> · <Link href="/privacy">Privacy</Link> · <Link href="/safe-play">Safe play</Link> · <Link href="/vault">Odds</Link></p>
        </section>
        <section className="desk-panel desk-side"><PullsFeed feed={feed} /></section>
      </div>

      <footer className="desk-bottom">
        <div className="desk-bottom-row">
          <nav className="desk-cities" aria-label="Launch cities" ref={cityBar}>
            <ol>{SERVICE_CITIES.map((c) => <li key={c.name}><button className={c.name === city ? "on" : ""} aria-current={c.name === city ? "true" : undefined} onClick={() => pickCity(c.name)}>{c.name}</button></li>)}</ol>
          </nav>
          <button className="desk-explore" aria-pressed={exploring} onClick={() => setExploring((x) => !x)}>
            <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d={exploring ? "M9 3v6H3M15 3v6h6M9 21v-6H3M15 21v-6h6" : "M3 9V3h6M21 9V3h-6M3 15v6h6M21 15v6h-6"} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            {exploring ? "Show panels" : "Explore the map"}
          </button>
        </div>
        <ul className="desk-strip">
          <li><span className="live-dot" /><Tick v={String(SERVICE_CITIES.length)} />launch cities live</li>
          <li><Tick v={feed ? feed.totals.collectors.toLocaleString("en-US") : "–"} />collectors</li>
          <li><Tick v={feed ? feed.totals.cardsPulled.toLocaleString("en-US") : "–"} />cards pulled</li>
          <li><Tick v={feed ? usd(feed.totals.wonUsd) : "–"} />won by players</li>
          <li><Tick v={vault ? String(vault.cardsInVault) : "–"} />cards in the vault <Link href="/vault" className="desk-vault">See them ↗</Link></li>
        </ul>
      </footer>
      {connect && <ConnectSheet onClose={() => setConnect(false)} />}
    </>
  );
}
