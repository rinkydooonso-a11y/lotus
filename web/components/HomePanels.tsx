"use client";
import { useState } from "react";
import { useAuth } from "@/lib/auth/client";
import { TIER_LABEL, timeAgo, usd } from "@/lib/format";
import { Hero } from "./Hero";
import { QrCard } from "./QrCard";
import { PullsFeed, useFeed } from "./PullsFeed";
import { ConnectSheet } from "./ConnectSheet";

/** Floating panels around the map: pitch + QR on the left, live pulls on the right, a ticker on phones. */
export function HomePanels() {
  const { user, balances, loading } = useAuth();
  const feed = useFeed();
  const [connect, setConnect] = useState(false);
  const [sheet, setSheet] = useState(false);
  const latest = feed?.recent[0];
  return (
    <>
      <aside className="side side-l">
        <Hero>
          {!loading && !user && <button className="btn" onClick={() => setConnect(true)}>Connect wallet to play</button>}
          {user && balances && (
            <div className="panel-card me-card">
              <div><b>◆ {balances.shards}<small>/10</small></b><span className="muted small">shards to next ticket</span><i className="bar"><i style={{ width: `${balances.shards * 10}%` }} /></i></div>
              <div><b>🎟 {balances.tickets}</b><span className="muted small">tickets</span></div>
            </div>
          )}
        </Hero>
        <QrCard />
        <p className="side-foot muted">Crates only open when you&apos;re standing next to them, so the game lives on your phone.</p>
      </aside>
      <aside className="side side-r"><PullsFeed feed={feed} /></aside>

      {latest && (
        <button className="ticker" onClick={() => setSheet(true)}>
          <span className="live-dot" /><span className="ticker-t"><b>{latest.cardName}</b> <span className={`tc-${latest.tier}`}>{TIER_LABEL[latest.tier]}</span> {usd(latest.valueUsd)}</span><span className="muted">{timeAgo(latest.at)}</span>
        </button>
      )}
      {sheet && (
        <div className="sheet-back" onClick={() => setSheet(false)}>
          <div className="sheet feed-sheet" onClick={(e) => e.stopPropagation()}><div className="grab" /><PullsFeed feed={feed} /></div>
        </div>
      )}
      {connect && <ConnectSheet onClose={() => setConnect(false)} />}
    </>
  );
}
