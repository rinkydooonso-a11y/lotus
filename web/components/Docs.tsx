import Link from "next/link";
import type { ReactNode } from "react";
import type { Tier } from "@/lib/types";
import { LINKS } from "@/lib/links";
import { CaChip } from "./CaChip";
import { Logo } from "./Logo";
import { IconArrowUpRight } from "./Icons";

export const TIER_ROWS: { t: Tier; label: string; band: string }[] = [
  { t: "grail", label: "Grail", band: "$300 and up" },
  { t: "rare", label: "Rare", band: "$75 to $300" },
  { t: "uncommon", label: "Uncommon", band: "$30 to $75" },
  { t: "common", label: "Common", band: "Under $30" },
];

/** Tier rows as a grouped list, as on the vault and stats pages. `right` fills the right column per tier. */
export function TierRows({ right }: { right?: (t: Tier) => ReactNode }) {
  return (
    <ul className="group tier-rows">
      {TIER_ROWS.map(({ t, label, band }) => (
        <li key={t} className={`group-row tier-row t-${t}`}>
          <span className="tier-chip" /><b className={`tc-${t}`}>{label}</b><span className="grow" />
          {right ? right(t) : <span className="muted">{band}</span>}
        </li>
      ))}
    </ul>
  );
}

/** Where the cards come from: coin fees → treasury → card buys → vault → your wallet. */
export function FeeFlow() {
  return (
    <ol className="flow">
      <li className="flow-node"><b>Every {LINKS.ticker} trade</b><span>on pump.fun</span></li>
      <li className="flow-link"><span>creator fee</span></li>
      <li className="flow-node"><b>Treasury</b><span>swapped to USDC</span></li>
      <li className="flow-link" />
      <li className="flow-split">
        <div className="flow-node"><b>Everyday cards</b><span>most of the budget</span></div>
        <div className="flow-node"><b>Big pulls</b><span>a slice for grails</span></div>
      </li>
      <li className="flow-link" />
      <li className="flow-node vault"><b>The vault</b><span>fills the crates</span></li>
      <li className="flow-link" />
      <li className="flow-node you"><b>Your wallet</b><span>when you pull one</span></li>
    </ol>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="wrap">
        <div className="sf-top">
          <Link href="/" className="brand" aria-label="CardQuest home"><Logo size={22} /></Link>
          <div className="sf-social"><CaChip /><a className="sf-x" href={LINKS.x} target="_blank" rel="noopener noreferrer">{LINKS.xHandle}</a></div>
        </div>
        <div className="sf-cols">
          <nav aria-label="Game">
            <h3>Game</h3>
            <Link href="/">Play</Link><Link href="/how">How it works</Link><Link href="/history">My prizes</Link>
          </nav>
          <nav aria-label="Transparency">
            <h3>Transparency</h3>
            <Link href="/vault">The vault and odds</Link><Link href="/stats">Live stats</Link><Link href="/coin">Where the money goes</Link>
          </nav>
          <nav aria-label="Cards">
            <h3>Your cards</h3>
            <a href={LINKS.collectorCrypt} rel="noopener noreferrer">Collector Crypt<IconArrowUpRight size={12} /></a>
            <a href={LINKS.x} target="_blank" rel="noopener noreferrer">Follow on X<IconArrowUpRight size={12} /></a>
          </nav>
          <nav aria-label="Legal">
            <h3>Legal</h3>
            <Link href="/terms">Terms of Play</Link><Link href="/privacy">Privacy</Link><Link href="/safe-play">Safe play</Link>
          </nav>
        </div>
        <p className="sf-fine">CardQuest is an independent game and is not affiliated with Collector Crypt. Prizes depend on available inventory. Nothing here is financial advice or a promise of returns. Play where it is safe and legal, and watch your surroundings. 18+.</p>
      </div>
    </footer>
  );
}
