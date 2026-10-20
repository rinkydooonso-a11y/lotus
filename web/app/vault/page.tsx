import type { Metadata } from "next";
import { game } from "@/lib/server";
import { usd } from "@/lib/format";
import { SiteFooter, TierRows } from "@/components/Docs";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "The vault · CardQuest" };

export default async function Vault() {
  const v = await game.vaultStats();
  return (
    <div className="docs">
      <section className="docs-hero">
        <h1>The <em>vault.</em></h1>
        <p className="docs-lede">Every card you can pull is here, live and public. We never award a card the vault doesn&apos;t hold.</p>
      </section>
      <div className="stat-cards three">
        <div className="stat-card"><span className="eyebrow">Cards in vault</span><b>{v.cardsInVault}</b></div>
        <div className="stat-card"><span className="eyebrow">Insured value</span><b>{usd(v.totalValueUsd)}</b></div>
        <div className="stat-card"><span className="eyebrow">Cards sent</span><b>{v.cardsSent}</b></div>
      </div>
      <section><h2>Tiers and odds</h2>
        <p>Odds are per standard crate, before availability: a tier with no cards in the vault pays shards instead.</p>
        <TierRows right={(t) => <span className="tier-count"><b>{(v.byTier[t].odds * 100).toFixed(2)}%</b> · {v.byTier[t].count} in vault</span>} />
      </section>
      <section><h2>Treasury activity</h2>
        {v.recentTreasury.length === 0 ? <p>Nothing yet.</p> : (
          <ul className="tx-list">{v.recentTreasury.map((e, i) => <li key={i}><span className="faint">{new Date(e.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span><b className="cap">{e.kind}</b><span className="grow">{e.note}</span></li>)}</ul>
        )}
      </section>
      <SiteFooter />
    </div>
  );
}
