import type { Metadata } from "next";
import { game } from "@/lib/server";
import { LINKS, buyUrlFor, coinLive } from "@/lib/links";
import { usd } from "@/lib/format";
import { CaChip, XButton } from "@/components/CaChip";
import { FeeFlow, SiteFooter } from "@/components/Docs";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: `${LINKS.ticker} · CardQuest` };

export default async function Coin() {
  const vault = await game.vaultStats();
  const coin = await game.coinMint().catch(() => null);
  return (
    <div className="docs">
      <section className="docs-hero">
        <p className="page-kicker">The coin</p>
        <h1>{LINKS.ticker}</h1>
        <p className="docs-lede">The CardQuest coin. Every trade pays a creator fee, and that fee buys the graded cards hiding in the crates. More trading, fuller vault.</p>
        <div className="coin-actions">
          <div className="row-gap"><CaChip full /><XButton /></div>
          {(coin || coinLive) && <a className="btn btn-lg" href={coin ? buyUrlFor(coin) : LINKS.buy} target="_blank" rel="noopener noreferrer">Buy {LINKS.ticker}</a>}
          <p className="faint small">Not financial advice. Nothing here promises any price or return.</p>
        </div>
      </section>

      <section><h2>Where the fees go</h2><FeeFlow /></section>

      <section><h2>The vault right now</h2>
        <div className="stat-cards three">
          <div className="stat-card"><span className="eyebrow">Cards in vault</span><b>{vault.cardsInVault}</b></div>
          <div className="stat-card"><span className="eyebrow">Insured value</span><b>{usd(vault.totalValueUsd)}</b></div>
          <div className="stat-card"><span className="eyebrow">Cards sent</span><b>{vault.cardsSent}</b></div>
        </div>
      </section>

      <section><h2>Treasury activity</h2>
        {vault.recentTreasury.length === 0 ? <p>Nothing yet.</p> : (
          <ul className="tx-list">
            {vault.recentTreasury.map((e, i) => (
              <li key={i}><span className="faint">{new Date(e.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span><b className="cap">{e.kind}</b><span className="grow">{e.note}</span>{e.txSignature && <a href={`https://solscan.io/tx/${e.txSignature}`} target="_blank" rel="noopener noreferrer">Transaction ↗</a>}</li>
            ))}
          </ul>
        )}
      </section>
      <SiteFooter />
    </div>
  );
}
