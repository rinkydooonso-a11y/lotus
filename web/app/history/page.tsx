"use client";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth/client";
import type { HistoryEntry } from "@/lib/types";
import { TIER_LABEL, timeAgo, usd } from "@/lib/format";
import { CardThumb } from "@/components/CardThumb";

export default function History() {
  const { user, balances, loading } = useAuth();
  const [rows, setRows] = useState<HistoryEntry[] | null>(null);
  useEffect(() => {
    if (!user) return;
    void fetch("/api/history", { cache: "no-store" }).then((r) => r.json()).then((j: { history: HistoryEntry[] }) => setRows(j.history));
  }, [user]);

  if (loading) return <div className="page" />;
  if (!user) return <div className="page"><h1>Your <em>pulls.</em></h1><div className="panel-card empty"><p className="muted">Connect your wallet from the map to see every crate you&apos;ve opened.</p></div></div>;
  return (
    <div className="page">
      <h1>Your <em>pulls.</em></h1>
      {balances && (
        <div className="stats">
          <div className="stat"><span>Shards</span><b>◆ {balances.shards}<small> / 10</small></b><i className="bar"><i style={{ width: `${(balances.shards % 10) * 10}%` }} /></i></div>
          <div className="stat"><span>Tickets</span><b>🎟 {balances.tickets}<small> / 5</small></b></div>
          <div className="stat"><span>Cards won</span><b>{rows ? rows.filter((h) => h.result.kind === "card").length : "–"}</b></div>
        </div>
      )}
      {rows === null ? <p className="muted">Loading…</p> : rows.length === 0 ? <div className="panel-card empty"><p className="muted">No crates opened yet. Head to the map and find one.</p></div> : (
        <ul className="list">
          {rows.map((h) => (
            <li key={h.id} className="item">
              {h.result.kind === "card" ? <CardThumb tier={h.result.tier} grade={h.result.grade} imageUrl={h.result.imageUrl} /> : <div className="ico">◆</div>}
              <div className="grow">
                {h.result.kind === "card" ? <>
                  <strong>{h.result.cardName}</strong>
                  <div className="pull-meta"><span className={`tc-${h.result.tier}`}>{TIER_LABEL[h.result.tier]}</span><b>{usd(h.result.valueUsd)}</b><span className={`tag${h.result.status === "sent" ? " ok" : ""}`}>{h.result.status === "sent" ? "Delivered" : h.result.status === "failed" ? "Delivery delayed" : "On its way"}</span></div>
                </> : <><strong>+{h.result.shards} shard{h.result.shards === 1 ? "" : "s"}</strong>{h.result.ticketsGained > 0 && <div className="muted small">Earned a ticket</div>}</>}
              </div>
              <div className="muted small nowrap">{timeAgo(h.at)}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
