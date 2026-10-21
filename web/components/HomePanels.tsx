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
import { Icon } from "./Icon";
import { PullsFeed, useFeed } from "./PullsFeed";
import { QrCard } from "./QrCard";

/** A number that ticks in whenever it changes. */
function Tick({ v }: { v: string }) {
  return <b key={v} className="tick">{v}</b>;
}

export function WatchButton({ className = "" }: { className?: string }) {
  return (
    <button className={`btn secondary ${className}`} onClick={openFilm}>
      <Icon name="play" size={14} />Watch the film
    </button>
  );
}

/** Desktop sidebar over the map: pitch, cities, live numbers, the pulls feed and the phone QR, in one scrolling column. */
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

  return (
    <>
      <div className={exploring ? "desk-columns exploring" : "desk-columns"}>
        <section className="desk-panel desk-left" aria-label="CardQuest">
          <div className="side-hero">
            <p className="status"><span className="live-dot" />Live in {SERVICE_CITIES.length} cities</p>
            <h1 className="desk-title">Graded cards are dropping in <CitySwap /></h1>
            <p className="desk-lede">Crates land on the streets around you. Walk to one, open it on your phone, and a real graded card could be yours.</p>
            {user && balances ? (
              <div className="desk-me">
                <div><span className="label"><Icon name="shard" size={14} />Shards</span><b>{balances.shards}<small> / 10</small></b><i className="bar"><i style={{ width: `${balances.shards * 10}%` }} /></i></div>
                <div><span className="label gold"><Icon name="ticket" size={14} />Tickets</span><b>{balances.tickets}<small> / 5</small></b><i className="bar gold"><i style={{ width: `${balances.tickets * 20}%` }} /></i></div>
              </div>
            ) : !loading && !user ? <button className="btn lg wide" onClick={() => setConnect(true)}>Connect wallet to play</button> : null}
            <WatchButton className="wide" />
          </div>

          <div className="side-group">
            <h2 className="side-h">Launch cities</h2>
            <ol className="city-grid" aria-label="Launch cities">
              {SERVICE_CITIES.map((c) => <li key={c.name}><button className={c.name === city ? "on" : ""} aria-current={c.name === city ? "true" : undefined} onClick={() => pickCity(c.name)}>{c.name}</button></li>)}
            </ol>
          </div>

          <div className="side-group">
            <h2 className="side-h">Right now</h2>
            <dl className="numbers">
              <div><dt>Collectors</dt><dd><Tick v={feed ? feed.totals.collectors.toLocaleString("en-US") : "–"} /></dd></div>
              <div><dt>Cards pulled</dt><dd><Tick v={feed ? feed.totals.cardsPulled.toLocaleString("en-US") : "–"} /></dd></div>
              <div><dt>Won by players</dt><dd><Tick v={feed ? usd(feed.totals.wonUsd) : "–"} /></dd></div>
              <div><dt>In the vault</dt><dd><Tick v={vault ? String(vault.cardsInVault) : "–"} /><Link href="/vault" className="see">See them<Icon name="arrow" size={12} /></Link></dd></div>
            </dl>
          </div>

          <div className="side-group side-feed"><PullsFeed feed={feed} /></div>

          <div className="side-group">
            <QrCard />
            <p className="desk-foot">You have to be next to a crate to open it, so bring your phone.</p>
          </div>
          <p className="desk-legal">18+ · <Link href="/terms">Terms</Link> · <Link href="/privacy">Privacy</Link> · <Link href="/safe-play">Safe play</Link> · <Link href="/vault">Odds</Link></p>
        </section>
      </div>
      <button className="desk-explore" aria-pressed={exploring} aria-label={exploring ? "Show panel" : "Explore the map"} title={exploring ? "Show panel" : "Explore the map"} onClick={() => setExploring((x) => !x)}>
        <Icon name="sidebar" size={18} /><span>{exploring ? "Show panel" : "Explore the map"}</span>
      </button>
      {connect && <ConnectSheet onClose={() => setConnect(false)} />}
    </>
  );
}
