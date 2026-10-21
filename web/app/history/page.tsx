"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth/client";
import type { HistoryEntry } from "@/lib/types";
import { TIER_LABEL, timeAgo, usd } from "@/lib/format";
import { CardThumb } from "@/components/CardThumb";
import { ConnectSheet } from "@/components/ConnectSheet";
import { Shard, Ticket } from "@/components/Icons";
import { MAX_TICKETS } from "@/lib/rules";

export default function History() {
  const { user, balances, loading } = useAuth();
  const [rows, setRows] = useState<HistoryEntry[] | null>(null);
  const [connect, setConnect] = useState(false);
  useEffect(() => {
    if (!user) return;
    void fetch("/api/history", { cache: "no-store" }).then((r) => r.json()).then((j: { history: HistoryEntry[] }) => setRows(j.history));
  }, [user]);

  if (loading) return <div className="docs" />;
  if (!user) return (
    <div className="docs">
      <p className="page-kicker">Prizes</p>
      <h1>Your pulls.</h1>
      <div className="panel-card empty">
        <p className="muted">Connect your wallet to see every crate you&apos;ve opened.</p>
        <button className="btn" onClick={() => setConnect(true)}>Connect wallet</button>
      </div>
      {connect && <ConnectSheet onClose={() => setConnect(false)} />}
    </div>
  );
  return (
    <div className="docs">
      <p className="page-kicker">Prizes</p>
      <h1>Your pulls.</h1>
      {balances && (
        <div className="stats">
          <div className="stat"><span>Shards</span><b><Shard size={22} />{balances.shards}<small>/ {balances.shardsPerTicket}</small></b><i className="bar"><i style={{ width: `${Math.min(100, ((balances.shards % balances.shardsPerTicket) / balances.shardsPerTicket) * 100)}%` }} /></i></div>
          <div className="stat"><span>Tickets</span><b><Ticket size={22} />{balances.tickets}<small>/ {MAX_TICKETS}</small></b></div>
          <div className="stat"><span>Opens left today</span><b>{balances.opensLeft}<small>/ {balances.freeOpensPerDay}</small></b></div>
          <div className="stat"><span>Cards won</span><b>{rows ? rows.filter((h) => h.result.kind === "card").length : "–"}</b></div>
        </div>
      )}
      {rows === null ? <p className="muted">Loading…</p> : rows.length === 0 ? (
        <div className="panel-card empty"><p className="muted">No crates opened yet. Head to the map and find one.</p><Link href="/" className="btn">Open the map</Link></div>
      ) : (
        <ul className="list">
          {rows.map((h) => (
            <li key={h.id} className="item">
              {h.result.kind === "card" ? <CardThumb tier={h.result.tier} grade={h.result.grade} imageUrl={h.result.imageUrl} size="sm" /> : <div className="ico"><Shard size={20} /></div>}
              <div className="grow">
                {h.result.kind === "card" ? <>
                  <strong>{h.result.cardName}</strong>
                  <div className="pull-meta"><span className={`tc-${h.result.tier}`}>{TIER_LABEL[h.result.tier]}</span><b>{usd(h.result.valueUsd)}</b><span className={`tag${h.result.status === "sent" ? " ok" : ""}`}>{h.result.status === "sent" ? "Delivered" : h.result.status === "failed" ? "Delivery delayed" : "On its way"}</span></div>
                </> : <><strong>+{h.result.shards} shard{h.result.shards === 1 ? "" : "s"}</strong>{h.result.ticketsGained > 0 && <div className="muted small">Earned a ticket</div>}</>}
              </div>
              <div className="faint small nowrap">{timeAgo(h.at)}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
