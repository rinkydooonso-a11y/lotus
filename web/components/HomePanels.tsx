"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth/client";
import { SERVICE_CITIES } from "@/lib/cities";
import { pickCity, setCity, useCity } from "@/lib/cityStore";
import { TIER_LABEL, usd } from "@/lib/format";
import { COIN_HOLD_USD, FREE_OPENS_PER_DAY, MAX_TICKETS } from "@/lib/rules";
import { OPEN_RADIUS_M } from "@/lib/geo";
import { LINKS, coinLive } from "@/lib/links";
import type { Feed, Tier, VaultStats } from "@/lib/types";
import { ConnectSheet } from "./ConnectSheet";
import { SiteFooter } from "./Docs";
import { openFilm } from "./Film";
import { IconArrowUpRight, IconChevronRight, IconClose, IconPlay, Shard, Ticket } from "./Icons";
import { PullsShowcase } from "./PullsFeed";
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
      <p className="tagline"><span className="live-dot" />Live in {SERVICE_CITIES.length} cities</p>
      <h1 className="hero-title">Find the crate.<br /><em>Pull the card.</em></h1>
      <p className="hero-lede">Graded trading cards are hidden in crates on real streets. Walk up to one with your phone, open it, and the card goes straight to your wallet.</p>
      {walletBrowser && !user ? <WalletBrowserNotice /> : (
        <div className="hero-actions">
          {!user && <ConnectButton className="btn btn-lg show-phone" label="Connect wallet to play" />}
          {user && balances && (
            <Link href="/history" className="hero-bal" aria-label="Your shards and tickets">
              <span><Shard size={18} /><b className="num">{balances.shards}</b><small>/ {balances.shardsPerTicket} shards</small></span>
              <span><Ticket size={18} /><b className="num">{balances.tickets}</b><small>/ {MAX_TICKETS} tickets</small></span>
            </Link>
          )}
          <Link href="/how" className="btn btn-lg btn-gray">How it works</Link>
        </div>
      )}
      <div className="hero-qr hide-phone"><QrCard className="qr-card" /></div>
    </div>
  );
}

type Tab = "stats" | "crates" | "pulls" | "collectors" | "how" | "more";
const TABS: { id: Tab; label: string }[] = [
  { id: "stats", label: "Live stats" },
  { id: "crates", label: "In the crates" },
  { id: "pulls", label: "Pulls" },
  { id: "collectors", label: "Top collectors" },
  { id: "how", label: "How it works" },
  { id: "more", label: "More" },
];

const TIERS: Tier[] = ["grail", "rare", "uncommon", "common"];
const BANDS: Record<Tier, string> = { grail: "$300+", rare: "$75 to $300", uncommon: "$30 to $75", common: "Under $30" };
const n = (x: number) => x.toLocaleString("en-US");

function Big({ value, label, note }: { value: string; label: string; note?: string }) {
  return <div className="bignum"><b key={value} className="num tick">{value}</b><span>{label}</span>{note && <small>{note}</small>}</div>;
}

function StatsPanel({ feed, vault }: { feed: Feed | null; vault: VaultStats | null }) {
  return (
    <section className="panel-sec">
      <p className="eyebrow"><span className="live-dot" />Live stats</p>
      <h2 className="panel-title">The game, right now.</h2>
      <div className="bignums">
        <Big value={feed ? n(feed.totals.cardsPulled) : "–"} label="cards pulled" />
        <Big value={feed ? usd(feed.totals.wonUsd) : "–"} label="won by players" note="Insured value of every card pulled" />
        <Big value={feed ? n(feed.totals.collectors) : "–"} label="collectors" note="Wallets that have pulled a graded card" />
        <Big value={vault ? n(vault.cardsInVault) : "–"} label="cards in the vault" note={vault ? `${usd(vault.totalValueUsd)} insured` : undefined} />
        <Big value={vault ? n(vault.cardsSent) : "–"} label="cards sent to wallets" />
        <Big value={String(SERVICE_CITIES.length)} label="cities live" note={`${FREE_OPENS_PER_DAY} free opens a day, ${OPEN_RADIUS_M} m to open`} />
      </div>
      <div className="panel-actions"><a className="link-more" href={LINKS.vault} target="_blank" rel="noopener noreferrer">See every card in the vault<IconArrowUpRight size={15} /></a><Link href="/stats" className="link-more">All stats<IconChevronRight size={15} /></Link></div>
    </section>
  );
}

function CratesPanel({ vault }: { vault: VaultStats | null }) {
  return (
    <section className="panel-sec">
      <p className="eyebrow">In the crates</p>
      <h2 className="panel-title">What&apos;s in the vault.</h2>
      <p className="panel-sub">Every crate rolls for a graded card. A tier with no cards in the vault pays shards instead, so we never award a card we don&apos;t hold.</p>
      <ul className="tier-list">
        {TIERS.map((t) => (
          <li key={t} className={`t-${t}`}>
            <span className="tier-chip" /><b className={`tc-${t}`}>{TIER_LABEL[t]}</b><span className="muted">{BANDS[t]}</span><span className="grow" />
            <span className="tier-count"><b className="num">{vault ? vault.byTier[t].count : "–"}</b> {vault && vault.byTier[t].count === 1 ? "card" : "cards"}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CollectorsPanel({ feed }: { feed: Feed | null }) {
  return (
    <section className="panel-sec">
      <p className="eyebrow">Top collectors</p>
      <h2 className="panel-title">Most valuable hauls.</h2>
      <p className="panel-sub">Players by the value of the cards they pulled.</p>
      {!feed ? <p className="muted">Loading…</p> : feed.collectors.length === 0 ? <p className="muted">No collectors yet. Be the first.</p> : (
        <ol className="rank-list">
          {feed.collectors.map((c, i) => (
            <li key={c.collector}><span className={`rank r${i + 1}`}>{i + 1}</span><span className="grow mono">{c.collector}</span><span className="muted">{c.cards} card{c.cards === 1 ? "" : "s"}</span><b className="num">{usd(c.totalUsd)}</b></li>
          ))}
        </ol>
      )}
    </section>
  );
}

const STEPS = [
  { t: "Connect a wallet", d: "Phantom, Solflare or Backpack. Signing in is a free message, never a transaction." },
  { t: "Walk to a crate", d: `Crates sit on streets, paths and parks in ${SERVICE_CITIES.length} cities. Get within ${OPEN_RADIUS_M} metres to open one. First to arrive takes it.` },
  { t: "Open it", d: `${FREE_OPENS_PER_DAY} free opens a day. Pull a graded card, sent straight to your wallet, or shards that add up to tickets for extra opens.` },
];

function HowPanel() {
  return (
    <section className="panel-sec">
      <p className="eyebrow">How it works</p>
      <h2 className="panel-title">Three steps. One walk.</h2>
      <ol className="steps-list">
        {STEPS.map((s, i) => <li key={s.t}><span className="step-no">0{i + 1}</span><div><h3>{s.t}</h3><p>{s.d}</p></div></li>)}
      </ol>
      <div className="panel-actions">
        <WatchButton label="Watch the film" />
        <Link href="/how" className="link-more">Read the full guide<IconChevronRight size={15} /></Link>
      </div>
    </section>
  );
}

function MorePanel() {
  const { user, loading } = useAuth();
  const city = useCity();
  return (
    <section className="panel-sec">
      <p className="eyebrow">Where it&apos;s live</p>
      <h2 className="panel-title">{SERVICE_CITIES.length} cities. Tap one to fly there.</h2>
      <ul className="city-grid" aria-label="Launch cities">
        {SERVICE_CITIES.map((c, i) => (
          <li key={c.name}><button className={c.name === city ? "on" : ""} onClick={() => pickCity(c.name)}><span className="mono">{String(i + 1).padStart(2, "0")}</span>{c.name}</button></li>
        ))}
      </ul>
      <div className="more-cta">
        <p>{coinLive ? `Hold $${COIN_HOLD_USD} of ${LINKS.ticker} to open crates.` : "Free to play."} 18+. Play where it&apos;s safe and legal.</p>
        {!loading && !user && <ConnectButton />}
      </div>
      <SiteFooter />
    </section>
  );
}

/** Tabs along the bottom of the globe: each opens its panel over the map, so the home page itself never scrolls. */
export function HomeSections({ feed }: { feed: Feed | null }) {
  const [tab, setTab] = useState<Tab | null>(null);
  const [vault, setVault] = useState<VaultStats | null>(null);
  useEffect(() => { void fetch("/api/vault").then((r) => (r.ok ? r.json() : null)).then((v: VaultStats | null) => v && setVault(v)).catch(() => undefined); }, []);
  useEffect(() => {
    if (!tab) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setTab(null); };
    const picked = () => setTab(null);
    window.addEventListener("keydown", k);
    window.addEventListener("cq:city", picked);
    return () => { window.removeEventListener("keydown", k); window.removeEventListener("cq:city", picked); };
  }, [tab]);
  return (
    <div className="home-tabs">
      {tab && (
        <div className="tab-panel" role="tabpanel">
          <button className="tab-close" onClick={() => setTab(null)} aria-label="Close"><IconClose size={16} /></button>
          {tab === "stats" && <StatsPanel feed={feed} vault={vault} />}
          {tab === "crates" && <CratesPanel vault={vault} />}
          {tab === "pulls" && (
            <section className="panel-sec wide">
              <p className="eyebrow"><span className="live-dot" />Pulls</p>
              <h2 className="panel-title">Real cards, pulled on real streets.</h2>
              <PullsShowcase feed={feed} />
            </section>
          )}
          {tab === "collectors" && <CollectorsPanel feed={feed} />}
          {tab === "how" && <HowPanel />}
          {tab === "more" && <MorePanel />}
        </div>
      )}
      <nav className="tab-bar" role="tablist" aria-label="More about CardQuest">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(tab === t.id ? null : t.id)}>{t.label}</button>
        ))}
      </nav>
    </div>
  );
}

