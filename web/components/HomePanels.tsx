"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth/client";
import { SERVICE_CITIES } from "@/lib/cities";
import { setCity } from "@/lib/cityStore";
import { usd } from "@/lib/format";
import { COIN_HOLD_USD, FREE_OPENS_PER_DAY, MAX_TICKETS } from "@/lib/rules";
import { LINKS, coinLive } from "@/lib/links";
import type { Feed, VaultStats } from "@/lib/types";
import { CitySwap } from "./CitySwap";
import { ConnectSheet } from "./ConnectSheet";
import { SiteFooter } from "./Docs";
import { openFilm } from "./Film";
import { CrateGlyph, IconChevronRight, IconClose, IconPlay, Shard, Ticket } from "./Icons";
import { Mark } from "./Logo";
import { PullsShowcase } from "./PullsFeed";
import { QrCard } from "./QrCard";
import { CardThumb } from "./CardThumb";
import { useInWalletBrowser, WalletBrowserNotice } from "./WalletBrowserNotice";

export function WatchButton({ label = "Watch the film", className = "btn btn-lg btn-gray" }: { label?: string; className?: string }) {
  return <button className={className} onClick={openFilm}><IconPlay size={15} />{label}</button>;
}

function ConnectButton({ className = "btn btn-lg" }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={className} onClick={() => setOpen(true)}>Connect wallet to play</button>
      {open && <ConnectSheet onClose={() => setOpen(false)} />}
    </>
  );
}

/** The pitch over the globe: one line of status, the headline, one sentence, two buttons. */
export function HeroCopy() {
  const { user, balances, loading } = useAuth();
  const walletBrowser = useInWalletBrowser();
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    void fetch("/api/where").then((r) => r.json()).then((j: { city: string | null }) => { if (j.city) setCity(j.city, false); }).catch(() => undefined);
  }, []);
  return (
    <div className="hero-copy">
      <p className="hero-live"><span className="live-dot" />Live in {SERVICE_CITIES.length} cities</p>
      <h1 className="hero-title">Graded cards are dropping in <CitySwap /></h1>
      <p className="hero-lede">Crates are hidden on the streets of twelve cities. Find one before anybody else does, open it on your phone, and a real graded card could be yours.</p>
      {walletBrowser && !user ? <WalletBrowserNotice /> : (
        <div className="hero-actions">
          {!loading && !user && <ConnectButton />}
          {user && balances && (
            <Link href="/history" className="hero-bal" aria-label="Your shards and tickets">
              <span><Shard size={18} /><b className="num">{balances.shards}</b><small>/ {balances.shardsPerTicket} shards</small></span>
              <span><Ticket size={18} /><b className="num">{balances.tickets}</b><small>/ {MAX_TICKETS} tickets</small></span>
            </Link>
          )}
          <WatchButton label="How it works" />
        </div>
      )}
      <div className="hero-qr hide-phone"><QrCard className="qr-card" /></div>
    </div>
  );
}

function Stat({ value, label, children }: { value: string; label: string; children?: React.ReactNode }) {
  return <div className="bignum"><b key={value} className="num tick">{value}</b><span>{label}</span>{children}</div>;
}

function Numbers({ feed, vault }: { feed: Feed | null; vault: VaultStats | null }) {
  const n = (x: number) => x.toLocaleString("en-US");
  return (
    <div className="bignums">
      <Stat value={feed ? usd(feed.totals.wonUsd) : "–"} label="won by players" />
      <Stat value={feed ? n(feed.totals.cardsPulled) : "–"} label="cards pulled" />
      <Stat value={feed ? n(feed.totals.collectors) : "–"} label="collectors" />
      <Stat value={vault ? n(vault.cardsInVault) : "–"} label="cards in the vault"><a href={LINKS.vault} target="_blank" rel="noopener noreferrer" className="more">See them<IconChevronRight size={14} /></a></Stat>
    </div>
  );
}

const STEPS = [
  { t: "Connect a wallet", d: "Phantom, Solflare or Backpack. Signing in is a free message, never a transaction.", art: "wallet" },
  { t: "Walk to a crate", d: `Crates sit on streets, paths and parks in ${SERVICE_CITIES.length} cities. Get within 40 metres to open one. First to arrive takes it.`, art: "walk" },
  { t: "Open it", d: `${FREE_OPENS_PER_DAY} free opens a day. Pull a graded card, sent straight to your wallet, or shards that add up to tickets for extra opens.`, art: "open" },
] as const;

function StepArt({ art }: { art: (typeof STEPS)[number]["art"] }) {
  if (art === "wallet") return (
    <div className="art art-wallet" aria-hidden="true">
      <div className="art-phone"><Mark size={30} /><span className="art-line" /><span className="art-line short" /><span className="art-btn">Sign message</span></div>
    </div>
  );
  if (art === "walk") return (
    <div className="art art-walk" aria-hidden="true">
      <span className="art-radius" /><span className="art-crate"><CrateGlyph size={34} /></span><span className="art-path" /><span className="art-you" /><span className="art-dist">40 m</span>
    </div>
  );
  return (
    <div className="art art-open" aria-hidden="true">
      <span className="art-glow" />
      <div className="art-slab"><CardThumb tier="rare" grade="PSA 10" size="md" /></div>
      <span className="art-shards"><Shard size={18} /><Shard size={14} /></span>
    </div>
  );
}

type Tab = "pulls" | "how" | "phone" | "more";
const TABS: { id: Tab; label: string }[] = [
  { id: "pulls", label: "Live pulls" },
  { id: "how", label: "How it works" },
  { id: "phone", label: "Play on phone" },
  { id: "more", label: "More" },
];

/** Tabs along the bottom of the globe: each opens its panel over the map, so the home page itself never scrolls. */
export function HomeSections({ feed }: { feed: Feed | null }) {
  const { user, loading } = useAuth();
  const [tab, setTab] = useState<Tab | null>(null);
  const [vault, setVault] = useState<VaultStats | null>(null);
  useEffect(() => { void fetch("/api/vault").then((r) => (r.ok ? r.json() : null)).then((v: VaultStats | null) => v && setVault(v)).catch(() => undefined); }, []);
  useEffect(() => {
    if (!tab) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setTab(null); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [tab]);
  return (
    <div className="home-tabs">
      {tab && (
        <div className="tab-panel" role="tabpanel">
          <button className="tab-close" onClick={() => setTab(null)} aria-label="Close"><IconClose size={16} /></button>
          {tab === "pulls" && (
            <section className="sec sec-pulls" id="pulls">
              <div className="wrap center">
                <p className="kicker"><span className="live-dot" />Live pulls</p>
                <h2 className="sec-title">Real cards, pulled on real streets.</h2>
                <p className="sec-lede">Every prize is a professionally graded card from a public vault, sent to the winner&apos;s wallet.</p>
              </div>
              <PullsShowcase feed={feed} />
              <div className="wrap"><Numbers feed={feed} vault={vault} /></div>
            </section>
          )}
          {tab === "how" && (
            <section className="sec sec-how" id="how-it-works">
              <div className="wrap center">
                <p className="kicker">How it works</p>
                <h2 className="sec-title">Three steps, one walk.</h2>
              </div>
              <div className="wrap">
                <ol className="steps3">
                  {STEPS.map((s, i) => (
                    <li key={s.t} className="tile">
                      <StepArt art={s.art} />
                      <div className="tile-copy"><span className="step-n">{i + 1}</span><h3>{s.t}</h3><p>{s.d}</p></div>
                    </li>
                  ))}
                </ol>
                <div className="sec-actions">
                  <WatchButton label="Watch the film" />
                  <Link href="/how" className="link-more">Read the full guide<IconChevronRight size={15} /></Link>
                </div>
              </div>
            </section>
          )}
          {tab === "phone" && (
            <section className="sec sec-phone">
              <div className="wrap">
                <div className="tile phone-tile">
                  <div className="phone-copy">
                    <p className="kicker">Made for the walk</p>
                    <h2 className="sec-title left">Crates open on your phone.</h2>
                    <p className="sec-lede left">You have to be next to a crate to open it, so scan the code and play on your phone. CardQuest runs in its browser.</p>
                  </div>
                  <QrCard className="qr-card big" />
                </div>
              </div>
            </section>
          )}
          {tab === "more" && (
            <section className="sec sec-cta">
              <div className="wrap center">
                <div className="cta-mark"><CrateGlyph size={64} /></div>
                <h2 className="sec-title">Your first crate is waiting.</h2>
                <p className="sec-lede">{coinLive ? `Hold $${COIN_HOLD_USD} of ${LINKS.ticker} to open crates.` : "Free to play."} 18+. Play where it&apos;s safe and legal.</p>
                {!loading && !user && <div className="sec-actions"><ConnectButton /></div>}
              </div>
              <SiteFooter />
            </section>
          )}
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
