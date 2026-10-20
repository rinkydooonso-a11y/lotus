import Link from "next/link";
import type { ReactNode } from "react";
import type { Tier } from "@/lib/types";
import { LINKS } from "@/lib/links";
import { CaChip } from "./CaChip";

export const TIER_ROWS: { t: Tier; label: string; band: string }[] = [
  { t: "grail", label: "Grail", band: "$300 and up" },
  { t: "rare", label: "Rare", band: "$75 to $300" },
  { t: "uncommon", label: "Uncommon", band: "$30 to $75" },
  { t: "common", label: "Common", band: "Under $30" },
];

/** Tier rows with a tinted gradient, as on the vault and stats pages. `right` fills the right column per tier. */
export function TierRows({ right }: { right?: (t: Tier) => ReactNode }) {
  return (
    <ul className="tier-rows">
      {TIER_ROWS.map(({ t, label, band }) => (
        <li key={t} className={`tier-row s-${t}`}>
          <span className="tier-sq" /><b className={`tc-${t}`}>{label}</b><span className="grow" />
          {right ? right(t) : <span className="tier-band">{band}</span>}
        </li>
      ))}
    </ul>
  );
}

/** Where the cards come from: coin fees → treasury → card buys → vault → crates → your wallet. */
export function FeeFlow() {
  return (
    <div className="flow">
      <div className="flow-node"><b>Every {LINKS.ticker} trade</b><span>on pump.fun</span></div>
      <div className="flow-link"><span className="flow-tag">creator fee</span></div>
      <div className="flow-node"><b>Treasury</b><span>swapped to USDC</span></div>
      <div className="flow-link" />
      <div className="flow-split">
        <div className="flow-node"><b>Everyday cards</b><span>most of the budget</span></div>
        <div className="flow-node"><b>Big pulls</b><span>a slice for grails</span></div>
      </div>
      <div className="flow-link" />
      <div className="flow-node vault"><b>The vault</b><span>fills the crates</span></div>
      <div className="flow-link" />
      <div className="flow-node you"><b>Your wallet</b><span>when you pull one</span></div>
    </div>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="sf-row"><CaChip /><a href={LINKS.x} target="_blank" rel="noopener noreferrer">{LINKS.xHandle}</a></div>
      <nav className="sf-links"><Link href="/">Play</Link><Link href="/how">How it works</Link><Link href="/stats">Live stats</Link><Link href="/coin">Where the money goes</Link><Link href="/vault">The vault</Link><a href={LINKS.collectorCrypt} rel="noopener noreferrer">Collector Crypt</a></nav>
      <p className="sf-fine">CardQuest is an independent game and is not affiliated with Collector Crypt. Prizes depend on available inventory. Nothing here is financial advice or a promise of returns. Play where it is safe and legal, and watch your surroundings. 18+.</p>
    </footer>
  );
}
