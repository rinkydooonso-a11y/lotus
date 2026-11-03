"use client";
import { useEffect, useRef, useState } from "react";
import type { Feed } from "@/lib/types";
import { TIER_LABEL, timeAgo, usd } from "@/lib/format";
import { CardThumb } from "./CardThumb";
import { IconChevronLeft, IconChevronRight } from "./Icons";

const TABS = [
  { k: "recent", label: "Latest" },
  { k: "biggest", label: "Biggest" },
  { k: "collectors", label: "Top collectors" },
] as const;
type TabKey = (typeof TABS)[number]["k"];

export function useFeed(): Feed | null {
  const [feed, setFeed] = useState<Feed | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => fetch("/api/feed").then((r) => (r.ok ? r.json() : null)).then((j: Feed | null) => { if (alive && j) setFeed(j); }).catch(() => undefined);
    void load();
    const t = setInterval(load, 20_000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  return feed;
}

export function Segmented<K extends string>({ items, value, onChange, label }: { items: readonly { k: K; label: string }[]; value: K; onChange: (k: K) => void; label: string }) {
  return (
    <div className="seg" role="tablist" aria-label={label}>
      {items.map((t) => <button key={t.k} role="tab" aria-selected={value === t.k} className={value === t.k ? "on" : ""} onClick={() => onChange(t.k)}>{t.label}</button>)}
    </div>
  );
}

/** The live feed as a shelf of slabs (latest, biggest) or a leaderboard (top collectors). */
export function PullsShowcase({ feed }: { feed: Feed | null }) {
  const [tab, setTab] = useState<TabKey>("recent");
  const shelf = useRef<HTMLUListElement>(null);
  const page = (dir: number) => { const s = shelf.current; if (s) s.scrollBy({ left: dir * s.clientWidth * 0.8, behavior: "smooth" }); };
  return (
    <div className="showcase">
      <div className="wrap showcase-bar"><Segmented items={TABS} value={tab} onChange={setTab} label="Live pulls" /></div>
      {!feed ? <div className="shelf-empty">Loading…</div> : tab === "collectors" ? (
        feed.collectors.length === 0 ? <div className="shelf-empty">No collectors yet. Be the first.</div> : (
          <div className="wrap narrow">
            <ol className="group leaders">
              {feed.collectors.map((c, i) => (
                <li key={c.collector} className="group-row">
                  <span className={`rank r${i + 1}`}>{i + 1}</span>
                  <span className="grow mono">{c.collector}</span>
                  <span className="muted">{c.cards} card{c.cards === 1 ? "" : "s"}</span>
                  <b className="num">{usd(c.totalUsd)}</b>
                </li>
              ))}
            </ol>
          </div>
        )
      ) : feed[tab].length === 0 ? <div className="shelf-empty">No pulls yet. Go open a crate.</div> : (
        <>
        <ul className="shelf" key={tab} ref={shelf}>
          {feed[tab].map((p, i) => (
            <li key={p.id} className="shelf-item" style={{ animationDelay: `${Math.min(i, 8) * 50}ms` }}>
              <CardThumb tier={p.tier} grade={p.grade} imageUrl={p.imageUrl} name={p.cardName} size="xl" />
              <div className="shelf-meta">
                <p className="shelf-name">{p.cardName}</p>
                <p className="shelf-sub"><span className={`tier-name tc-${p.tier}`}>{TIER_LABEL[p.tier]}</span><span>{p.grade}</span></p>
                <p className="shelf-val num">{usd(p.valueUsd)}</p>
                <p className="shelf-by"><span className="mono">{p.collector}</span><span>{timeAgo(p.at)}</span></p>
                <span className={p.crateKind === "ticket" ? "tag gold" : "tag"}>{p.crateKind === "ticket" ? "Ticket open" : "Street crate"}</span>
              </div>
            </li>
          ))}
        </ul>
        <div className="wrap paddles hide-phone">
          <button className="icon-btn" onClick={() => page(-1)} aria-label="Scroll back"><IconChevronLeft size={18} /></button>
          <button className="icon-btn" onClick={() => page(1)} aria-label="Scroll forward"><IconChevronRight size={18} /></button>
        </div>
        </>
      )}
    </div>
  );
}
