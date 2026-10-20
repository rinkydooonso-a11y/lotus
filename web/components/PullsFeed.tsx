"use client";
import { useEffect, useState } from "react";
import type { Feed } from "@/lib/types";
import { TIER_LABEL, timeAgo, usd } from "@/lib/format";
import { CardThumb } from "./CardThumb";

const TABS = [
  { k: "recent", label: "Live pulls" },
  { k: "biggest", label: "Biggest" },
  { k: "collectors", label: "Collectors" },
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

export function PullsFeed({ feed }: { feed: Feed | null }) {
  const [tab, setTab] = useState<TabKey>("recent");
  return (
    <div className="feed">
      <div className="seg" role="tablist">
        {TABS.map((t) => (
          <button key={t.k} role="tab" aria-selected={tab === t.k} className={tab === t.k ? "on" : ""} onClick={() => setTab(t.k)}>
            {t.k === "recent" && <span className="live-dot" />}{t.label}
          </button>
        ))}
      </div>
      <div className="feed-list">
        {!feed ? <p className="muted feed-empty">Loading…</p> : tab === "collectors" ? (
          feed.collectors.length === 0 ? <p className="muted feed-empty">No collectors yet. Be the first.</p> : (
            <ol className="collectors">
              {feed.collectors.map((c, i) => (
                <li key={c.collector}>
                  <span className={`rank r${i + 1}`}>{i + 1}</span>
                  <span className="grow mono">{c.collector}</span>
                  <span className="muted small">{c.cards} card{c.cards === 1 ? "" : "s"}</span>
                  <b>{usd(c.totalUsd)}</b>
                </li>
              ))}
            </ol>
          )
        ) : feed[tab].length === 0 ? <p className="muted feed-empty">No pulls yet. Go open a crate.</p> : (
          <ul className="pulls">
            {feed[tab].map((p) => (
              <li key={p.id} className="pull">
                <CardThumb tier={p.tier} grade={p.grade} imageUrl={p.imageUrl} />
                <div className="grow">
                  <div className="pull-name">{p.cardName} {p.grade}</div>
                  <div className="pull-meta"><span className={`tc-${p.tier}`}>{TIER_LABEL[p.tier]}</span><b>{usd(p.valueUsd)}</b><span className={`tag${p.crateKind === "ticket" ? " gold" : ""}`}>{p.crateKind === "ticket" ? "Ticket crate" : "Street crate"}</span></div>
                  <div className="pull-by muted"><span className="mono">{p.collector}</span><span>{timeAgo(p.at)}</span></div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
