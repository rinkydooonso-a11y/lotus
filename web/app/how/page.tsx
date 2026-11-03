import type { Metadata } from "next";
import { WatchButton } from "@/components/HomePanels";
import { FeeFlow, SiteFooter, TierRows } from "@/components/Docs";
import { CaChip } from "@/components/CaChip";
import { Mark } from "@/components/Logo";
import { CardThumb } from "@/components/CardThumb";
import { CrateGlyph } from "@/components/Icons";
import { SERVICE_CITIES } from "@/lib/cities";
import { LINKS, coinLive } from "@/lib/links";
import { COIN_HOLD_USD, FREE_OPENS_PER_DAY, MAX_TICKETS, SHARDS_PER_TICKET } from "@/lib/rules";

export const metadata: Metadata = { title: "How CardQuest works", description: "Walk to crates on the map, open them, and win real graded trading cards from a public vault." };

const steps = [
  ["Connect a wallet", "Phantom, Solflare or Backpack. Signing in is a free message, never a transaction."],
  ["Head out in a launch city", `Crates sit on streets, paths and parks across ${SERVICE_CITIES.length} cities. They are shared: whoever gets there first takes it.`],
  ["Walk up to a crate", "Get within about 40 metres and it unlocks. We check your movement, so no teleporting."],
  ["Open it", "You get a graded card, or shards toward a ticket. Cards go straight to your wallet."],
];
const rules = [
  ["One player, one account", "Multiple accounts or shared wallets get frozen."],
  ["Real movement only", "Spoofed GPS, emulators and impossible speeds are flagged automatically."],
  [`${FREE_OPENS_PER_DAY} opens a day`, `Everyone gets ${FREE_OPENS_PER_DAY} free opens each day. Tickets earned from shards buy you more.`],
  ...(coinLive ? [[`Hold $${COIN_HOLD_USD} of ${LINKS.ticker}`, `Opening a crate needs $${COIN_HOLD_USD} of ${LINKS.ticker} in your wallet. We check when you open, and the amount is fixed for 48 hours once you qualify. Dip below it in that window and opening pauses until the window ends.`]] : []),
  ["Unsent prizes can be held", "If an account is under review, its pending cards wait until it's cleared."],
  ["Play safe", "Watch where you're walking. Never go somewhere unsafe or off-limits for a crate."],
];
const faq = [
  ["Is it free to play?", coinLive ? `Opening crates costs nothing, but you need to hold $${COIN_HOLD_USD} of ${LINKS.ticker} in your wallet to open them. We check when you open, and the amount is fixed for 48 hours once you qualify. If you drop below it in that window, opening pauses until the window ends.` : "Yes. Connecting a wallet and opening crates costs nothing."],
  ["Are the cards real?", "Yes. Each prize is a Collector Crypt NFT backed by a professionally graded physical card held in a vault. Keep it, sell it, or redeem it on Collector Crypt to have the card shipped."],
  ["What are shards and tickets?", `Crates without a card pay 1 to 3 shards. ${SHARDS_PER_TICKET} shards make a ticket, up to ${MAX_TICKETS}. Spending a ticket buys another open the same day.`],
  ["Why can't I see crates?", `Crates are only placed inside the ${SERVICE_CITIES.length} launch cities right now, and one near you may already have been opened. More cities open as the vault grows.`],
  ["Is CardQuest affiliated with Collector Crypt?", "No. We buy cards like any customer. Redemption and shipping happen on their site."],
];

function Phone({ children, caption }: { children: React.ReactNode; caption: string }) {
  return <figure className="phone"><div className="phone-screen">{children}</div><figcaption>{caption}</figcaption></figure>;
}

export default function How() {
  return (
    <div className="docs">
      <section className="docs-hero how-hero">
        <p className="page-kicker">How it works</p>
        <h1>Find a crate. Crack it open. Keep the card.</h1>
        <p className="docs-lede">CardQuest is a map game where the prizes are real: professionally graded trading cards from a public vault, sent to your wallet the moment you pull one.</p>
        <WatchButton />
      </section>

      <div className="phones">
        <Phone caption="Crates waiting nearby"><div className="ph-map"><span className="ph-crate" style={{ left: "30%", top: "34%" }}><CrateGlyph size={40} /></span><span className="ph-crate" style={{ left: "66%", top: "50%" }}><CrateGlyph size={40} gold /></span><span className="ph-you" /></div></Phone>
        <Phone caption="Walk up and open one"><div className="ph-open"><span className="ph-burst" /><Mark size={84} /></div></Phone>
        <Phone caption="A real slab, in your wallet"><div className="ph-card"><CardThumb tier="rare" grade="PSA 10" size="md" /></div></Phone>
      </div>

      <section id="play"><h2>How to play</h2>
        <ol className="steps">{steps.map(([t, d], i) => <li key={t}><span className="step-n">{i + 1}</span><div><b>{t}</b><p>{d}</p></div></li>)}</ol>
      </section>

      <section id="inside"><h2>What&apos;s inside a crate</h2>
        <p>Every crate rolls on our server for a tier. Tiers are set by each card&apos;s insured value. If a tier is empty in the vault, you get shards instead.</p>
        <TierRows />
      </section>

      <section id="money"><h2>Where the prizes come from</h2>
        <p>Cards are bought with creator fees from trading the CardQuest coin. More trading means a fuller vault; quieter weeks mean fewer cards. It&apos;s never a promise of returns.</p>
        <FeeFlow />
      </section>

      <section id="real"><h2>Your card is real</h2>
        <p>Every prize is a Collector Crypt NFT backed by a graded physical card in an insured vault. Keep it in your wallet, sell it, or <a href={LINKS.collectorCrypt} rel="noopener noreferrer">redeem it</a> and have the slab shipped to you.</p>
      </section>

      <section id="fair"><h2>Fair by design</h2>
        <ol className="timeline">
          <li><span className="tl-dot" /><div><b>You open a crate</b><p>Your phone sends where you are. The server checks you&apos;re really there.</p></div></li>
          <li><span className="tl-dot accent" /><div><b>The server rolls</b><p>The vault is public, and we never award a card the vault doesn&apos;t hold.</p></div></li>
          <li><span className="tl-dot done" /><div><b>The card is sent</b><p>It moves on-chain to your wallet, usually within a minute.</p></div></li>
        </ol>
      </section>

      <section id="rules"><h2>House rules</h2>
        <ol className="rule-cards">{rules.map(([t, d], i) => <li key={t}><span className="step-n">{i + 1}</span><b>{t}</b><p>{d}</p></li>)}</ol>
      </section>

      <section id="coin"><h2>{LINKS.ticker}</h2>
        <p>The CardQuest coin&apos;s trading fees stock the vault. This is not financial advice, and nothing here promises any price.</p>
        <CaChip full />
      </section>

      <section id="faq"><h2>Questions</h2>
        <div className="faq-list">{faq.map(([q, a]) => <details key={q} className="faq"><summary>{q}</summary><p>{a}</p></details>)}</div>
      </section>
      <SiteFooter />
    </div>
  );
}
