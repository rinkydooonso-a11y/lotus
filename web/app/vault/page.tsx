import { game } from "@/lib/server";
import type { Tier } from "@/lib/types";

export const dynamic = "force-dynamic";
const TIERS: { t: Tier; label: string; band: string }[] = [
  { t: "common", label: "Common", band: "under $30" },
  { t: "uncommon", label: "Uncommon", band: "$30 – $75" },
  { t: "rare", label: "Rare", band: "$75 – $300" },
  { t: "grail", label: "Grail", band: "$300+" },
];

export default async function Vault() {
  const v = await game.vaultStats();
  return (
    <div className="page">
      <h1>Vault</h1>
      <p className="muted">Everything here is live and public. We never award a card the vault doesn&apos;t hold.</p>
      <div className="stats">
        <div className="stat"><b>{v.cardsInVault}</b><span>cards in vault</span></div>
        <div className="stat"><b>${Math.round(v.totalValueUsd).toLocaleString()}</b><span>insured value</span></div>
        <div className="stat"><b>{v.cardsSent}</b><span>cards sent</span></div>
      </div>
      <h2>Prize tiers and odds</h2>
      <ul className="list">
        {TIERS.map(({ t, label, band }) => (
          <li key={t} className="item">
            <div className={`ico b-${t}`}>🃏</div>
            <div className="grow"><strong>{label}</strong><div className="muted small">{band} · {v.byTier[t].count} in vault</div></div>
            <div><b>{(v.byTier[t].odds * 100).toFixed(2)}%</b><div className="muted small">per crate</div></div>
          </li>
        ))}
      </ul>
      <p className="muted small">Odds are before availability adjustments: a tier with no cards in the vault pays shards instead.</p>
      <h2>Treasury activity</h2>
      {v.recentTreasury.length === 0 ? <p className="muted">Nothing yet.</p> : (
        <ul className="list">
          {v.recentTreasury.map((e, i) => (
            <li key={i} className="item"><div className="grow"><strong>{e.kind}</strong><div className="muted small">{e.note}</div></div><div className="muted small">{new Date(e.at).toLocaleDateString()}</div></li>
          ))}
        </ul>
      )}
    </div>
  );
}
