import type { Metadata } from "next";
import { WatchButton } from "@/components/HomePanels";
import { FeeFlow, SiteFooter, TierRows } from "@/components/Docs";
import { CaChip } from "@/components/CaChip";
import { Mark } from "@/components/Logo";
import { SERVICE_CITIES } from "@/lib/cities";
import { LINKS } from "@/lib/links";

export const metadata: Metadata = { title: "How CardQuest works", description: "Walk to crates on the map, open them, and win real graded trading cards from a public vault." };

const steps = [
  ["Connect a wallet", "Phantom, Solflare or Backpack. Signing in is a free message, never a transaction."],
  ["Head out in a launch city", `Crates land on streets, paths and parks in ${SERVICE_CITIES.length} cities. Your first one spawns right where you stand.`],
  ["Walk up to a crate", "Get within about 40 metres and it unlocks. We check your movement, so no teleporting."],
  ["Open it", "You get a graded card, or shards toward a ticket. Cards go straight to your wallet."],
];
const rules = [
  ["One player, one account", "Multiple accounts or shared wallets get frozen."],
  ["Real movement only", "Spoofed GPS, emulators and impossible speeds are flagged automatically."],
  ["Daily limits", "There's a cap on crates per day so everyone gets a fair go."],
  ["Unsent prizes can be held", "If an account is under review, its pending cards wait until it's cleared."],
  ["Play safe", "Watch where you're walking. Never go somewhere unsafe or off-limits for a crate."],
];
const faq = [
  ["Is it free to play?", "Yes. Connecting a wallet and opening crates costs nothing."],
  ["Are the cards real?", "Yes. Each prize is a Collector Crypt NFT backed by a professionally graded physical card held in a vault. Keep it, sell it, or redeem it on Collector Crypt to have the card shipped."],
  ["What are shards and tickets?", "Crates without a card pay 1 to 3 shards. 10 shards make a ticket, up to 5. Ticket crates have much better odds."],
  ["Why can't I see crates?", `Crates only spawn inside the ${SERVICE_CITIES.length} launch cities right now. More open as the vault grows.`],
  ["Is CardQuest affiliated with Collector Crypt?", "No. We buy cards like any customer. Redemption and shipping happen on their site."],
];

function Phone({ children, caption }: { children: React.ReactNode; caption: string }) {
  return <figure className="phone"><div className="phone-screen">{children}</div><figcaption>{caption}</figcaption></figure>;
}

export default function How() {
  return (
    <div className="docs">
      <section className="docs-hero">
        <h1>Find a crate. Crack it open. <em>Keep the card.</em></h1>
        <p className="docs-lede">CardQuest is a map game where the prizes are real: professionally graded trading cards from a public vault, sent to your wallet the moment you pull one.</p>
        <WatchButton />
      </section>

      <div className="phones">
        <Phone caption="Crates land around you"><div className="ph-map"><span className="ph-crate" style={{ left: "30%", top: "34%" }}><Mark size={30} /></span><span className="ph-crate" style={{ left: "62%", top: "52%" }}><Mark size={30} /></span><span className="ph-you" /></div></Phone>
        <Phone caption="Walk up and open one"><div className="ph-open"><span className="ph-burst" /><Mark size={64} /></div></Phone>
        <Phone caption="A real slab, in your wallet"><div className="ph-card"><div className="slab s-rare lg"><div className="slab-label"><span>PSA 10</span></div><div className="slab-art"><i /></div></div></div></Phone>
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
          <li><span className="tl-dot accent" /><div><b>The server rolls</b><p>Odds are public on the vault page, and we never award a card the vault doesn&apos;t hold.</p></div></li>
          <li><span className="tl-dot done" /><div><b>The card is sent</b><p>It moves on-chain to your wallet, usually within a minute.</p></div></li>
        </ol>
      </section>

      <section id="rules"><h2>House rules</h2>
        <ol className="rule-cards">{rules.map(([t, d], i) => <li key={t}><span className="rule-n">{i + 1}</span><b>{t}</b><p>{d}</p></li>)}</ol>
      </section>

      <section id="coin"><h2>{LINKS.ticker}</h2>
        <p>The CardQuest coin&apos;s trading fees stock the vault. This is not financial advice, and nothing here promises any price.</p>
        <CaChip full />
      </section>

      <section id="faq"><h2>Questions</h2>
        {faq.map(([q, a]) => <details key={q} className="faq"><summary>{q}</summary><p>{a}</p></details>)}
      </section>
      <SiteFooter />
    </div>
  );
}
