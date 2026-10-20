"use client";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth/client";
import type { AdminInventoryItem, FlaggedPlayer, OddsRow } from "@/lib/types";

export default function Admin() {
  const { user, loading } = useAuth();
  const [inv, setInv] = useState<AdminInventoryItem[]>([]);
  const [odds, setOdds] = useState<OddsRow[]>([]);
  const [flagged, setFlagged] = useState<FlaggedPlayer[]>([]);
  const [msg, setMsg] = useState("");
  const emptyForm = { nftMint: "", cardName: "", grade: "", valueUsd: "", imageUrl: "", costUsd: "", purchaseTxSignature: "", location: "hot" as "hot" | "vault" };
  const [form, setForm] = useState(emptyForm);

  const load = useCallback(async () => {
    const [a, b, c] = await Promise.all(["inventory", "odds", "flagged"].map((p) => fetch(`/api/admin/${p}`, { cache: "no-store" }).then((r) => r.json())));
    setInv(a.items ?? []); setOdds(b.rows ?? []); setFlagged(c.players ?? []);
  }, []);
  useEffect(() => { if (user?.isAdmin) void load(); }, [user, load]);

  if (loading) return <div className="docs" />;
  if (!user?.isAdmin) return <div className="docs"><h1>Admin</h1><p className="muted">Not authorised.</p></div>;

  const total = odds.reduce((s, r) => s + r.weight, 0);
  const saveOdds = async () => {
    if (total !== 1_000_000) { setMsg(`Weights must sum to 1,000,000 (now ${total.toLocaleString()}).`); return; }
    const r = await fetch("/api/admin/odds", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ rows: odds }) });
    setMsg(r.ok ? "Odds saved." : "Save failed.");
  };
  const freeze = async (p: FlaggedPlayer) => {
    await fetch("/api/admin/flagged", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ playerId: p.playerId, frozen: !p.frozen }) });
    await load();
  };

  const addItem = async () => {
    const r = await fetch("/api/admin/inventory", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nftMint: form.nftMint.trim(), cardName: form.cardName.trim(), grade: form.grade.trim() || undefined, valueUsd: Number(form.valueUsd), imageUrl: form.imageUrl.trim() || undefined, location: form.location, costUsd: form.costUsd.trim() ? Number(form.costUsd) : undefined, purchaseTxSignature: form.purchaseTxSignature.trim() || undefined }) });
    setMsg(r.ok ? "Card added." : "Couldn't add card (check fields)."); if (r.ok) { setForm(emptyForm); await load(); }
  };
  const setStatus = async (id: string, status: "available" | "withheld" | "removed") => {
    const r = await fetch("/api/admin/inventory", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, status }) });
    if (!r.ok) setMsg("Not allowed for this card.");
    await load();
  };

  return (
    <div className="docs wide">
      <h1>Admin <em>console.</em></h1>
      <h2>Odds (parts per 1,000,000)</h2>
      <div className="card">
        {odds.map((r, i) => (
          <label key={r.tier} className="orow"><span>{r.tier}</span><input type="number" min={0} value={r.weight} onChange={(e) => setOdds(odds.map((o, j) => (j === i ? { ...o, weight: Number(e.target.value) } : o)))} /><span className="muted small">{total ? ((r.weight / total) * 100).toFixed(2) : 0}%</span></label>
        ))}
        <div className="dline"><button className="btn sm" onClick={() => void saveOdds()}>Save odds</button><span className="muted small">{msg}</span></div>
      </div>
      <h2>Flagged players</h2>
      {flagged.length === 0 ? <p className="muted">None.</p> : (
        <ul className="list">
          {flagged.map((p) => (
            <li key={p.playerId} className="item"><div className="grow"><strong className="mono">{p.wallet.slice(0, 6)}…{p.wallet.slice(-4)}</strong><div className="muted small">{p.reasons.join(", ")}</div></div><button className="btn sm ghost" onClick={() => void freeze(p)}>{p.frozen ? "Unfreeze" : "Freeze"}</button></li>
          ))}
        </ul>
      )}
      <h2>Inventory ({inv.length})</h2>
      <div className="card">
        {(["nftMint", "cardName", "grade", "valueUsd", "imageUrl", "costUsd", "purchaseTxSignature"] as const).map((k) => (
          <label key={k} className="orow"><span>{k}</span><input value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} /></label>
        ))}
        <label className="orow"><span>location</span><select value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value as "hot" | "vault" })}><option value="hot">Hot wallet (in play now)</option><option value="vault">Squads vault (held back)</option></select></label>
        <div className="dline"><button className="btn sm" onClick={() => void addItem()}>Add card (tier set from value)</button><span className="muted small">A cost logs a purchase on the treasury record.</span></div>
      </div>
      <div className="tablewrap card"><table>
        <thead><tr><th>Card</th><th>Grade</th><th>Tier</th><th>Value</th><th>Status</th><th>Where</th><th></th></tr></thead>
        <tbody>{inv.map((i) => <tr key={i.id}><td>{i.cardName}</td><td>{i.grade}</td><td><span className={`tc-${i.tier}`}>{i.tier}</span></td><td>${i.valueUsd}</td><td><span className="tag">{i.status}</span></td><td>{i.location === "vault" ? "vault" : "hot"}</td><td>{i.status === "available" && <button className="btn sm ghost" onClick={() => void setStatus(i.id, "withheld")}>Withhold</button>}{i.status === "withheld" && i.location !== "vault" && <button className="btn sm ghost" onClick={() => void setStatus(i.id, "available")}>Release</button>}</td></tr>)}</tbody>
      </table></div>
    </div>
  );
}
