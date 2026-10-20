"use client";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth/client";
import type { HistoryEntry } from "@/lib/types";

export default function History() {
  const { user, balances, loading } = useAuth();
  const [rows, setRows] = useState<HistoryEntry[] | null>(null);
  useEffect(() => {
    if (!user) return;
    void fetch("/api/history", { cache: "no-store" }).then((r) => r.json()).then((j: { history: HistoryEntry[] }) => setRows(j.history));
  }, [user]);

  if (loading) return <div className="page" />;
  if (!user) return <div className="page"><h1>Prizes</h1><p className="muted">Connect your wallet from the map to see your history.</p></div>;
  return (
    <div className="page">
      <h1>Prizes</h1>
      {balances && (
        <div className="stats">
          <div className="stat"><b>◆ {balances.shards}</b><span>shards</span><i style={{ width: `${(balances.shards % 10) * 10}%` }} /></div>
          <div className="stat"><b>🎟 {balances.tickets}</b><span>tickets (max 5)</span></div>
        </div>
      )}
      {rows === null ? <p className="muted">Loading…</p> : rows.length === 0 ? <p className="muted">No crates opened yet. Go find one.</p> : (
        <ul className="list">
          {rows.map((h) => (
            <li key={h.id} className="item">
              <div className={`ico ${h.result.kind === "card" ? "b-" + h.result.tier : ""}`}>{h.result.kind === "card" ? "🃏" : "◆"}</div>
              <div className="grow">
                {h.result.kind === "card" ? <><strong>{h.result.cardName}</strong><div className="muted small">{h.result.grade} · ${h.result.valueUsd} · {h.result.status === "sent" ? "delivered" : h.result.status === "failed" ? "delivery delayed" : "on its way"}</div></> : h.result.kind === "shards" ? <><strong>+{h.result.shards} shards</strong>{h.result.ticketsGained > 0 && <div className="muted small">Earned a ticket</div>}</> : null}
              </div>
              <div className="muted small">{new Date(h.at).toLocaleDateString()}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
