import type { Metadata } from "next";
import { game } from "@/lib/server";
import { SERVICE_CITIES } from "@/lib/cities";
import { TIER_LABEL, timeAgo, usd } from "@/lib/format";
import { CardThumb } from "@/components/CardThumb";
import { FeeFlow, SiteFooter, TierRows } from "@/components/Docs";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Live stats · CardQuest" };

export default async function Stats() {
  const [feed, vault] = await Promise.all([game.feed(), game.vaultStats()]);
  const n = (x: number) => x.toLocaleString("en-US");
  return (
    <div className="docs">
      <section className="docs-hero">
        <p className="page-kicker"><span className="live-dot" />Live stats</p>
        <h1 className="big-number"><em>{n(feed.totals.cardsPulled)}</em> cards pulled by players.</h1>
      </section>

      <section><h2>Who plays</h2>
        <div className="stat-cards">
          <div className="stat-card"><span className="eyebrow">Collectors</span><b>{n(feed.totals.collectors)}</b><p>Wallets that have signed in to play.</p></div>
          <div className="stat-card"><span className="eyebrow">Won by players</span><b>{usd(feed.totals.wonUsd)}</b><p>Insured value of every card pulled.</p></div>
          <div className="stat-card"><span className="eyebrow">Cards sent</span><b>{n(vault.cardsSent)}</b><p>Delivered on-chain to winners.</p></div>
          <div className="stat-card"><span className="eyebrow">Launch cities</span><b>{SERVICE_CITIES.length}</b><p>Where crates are dropping today.</p></div>
        </div>
      </section>

      <section><h2>What&apos;s in the crates</h2>
        <p>{n(vault.cardsInVault)} cards worth {usd(vault.totalValueUsd)} are in the vault right now.</p>
        <TierRows right={(t) => <span className="tier-count"><b>{vault.byTier[t].count}</b> in vault · {(vault.byTier[t].odds * 100).toFixed(2)}%</span>} />
      </section>

      <section><h2>Where the money goes</h2><FeeFlow /></section>

      <section><h2>Recent pulls</h2>
        {feed.recent.length === 0 ? <p>No pulls yet.</p> : (
          <ul className="list">
            {feed.recent.slice(0, 12).map((p) => (
              <li key={p.id} className="item">
                <CardThumb tier={p.tier} grade={p.grade} imageUrl={p.imageUrl} size="sm" />
                <div className="grow">
                  <strong>{p.cardName} {p.grade}</strong>
                  <div className="pull-meta"><span className={`tc-${p.tier}`}>{TIER_LABEL[p.tier]}</span><b>{usd(p.valueUsd)}</b></div>
                  <div className="pull-by"><span className="mono">{p.collector}</span><span>{timeAgo(p.at)}</span></div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <SiteFooter />
    </div>
  );
}
