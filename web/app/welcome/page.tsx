import type { Metadata } from "next";
import Link from "next/link";
import "./landing.css";
import { LINKS } from "./config";
import { Logo } from "@/components/Logo";
import { Hero } from "@/components/Hero";
import { QrCard } from "@/components/QrCard";
import { LiveFeedPanel } from "@/components/LiveFeedPanel";
import { SERVICE_CITIES } from "@/lib/cities";

export const metadata: Metadata = {
  title: "CardQuest: walk, find crates, win real graded cards",
  description: "A free-to-play location game. Open crates on the map and win real graded trading cards backed by a physical vault.",
};

const steps = [
  { i: "◈", t: "Connect a wallet", d: "Phantom, Solflare or Backpack. Playing is free." },
  { i: "◎", t: "Turn on location", d: "In a launch city, crates appear on the map around you. Your first one spawns where you stand." },
  { i: "➶", t: "Walk to a crate", d: "Get within about 40 metres. No teleporting: we check your movement." },
  { i: "✦", t: "Open it", d: "Win a graded card, or shards toward tickets. Cards land in your wallet." },
];
const tiers = [
  { k: "common", n: "Common", v: "Under $30" },
  { k: "uncommon", n: "Uncommon", v: "$30 to $75" },
  { k: "rare", n: "Rare", v: "$75 to $300" },
  { k: "grail", n: "Grail", v: "$300+" },
];
const faq = [
  ["Is it free to play?", "Yes. Connecting a wallet and opening crates costs nothing."],
  ["Are the cards real?", "Yes. Each prize is a Collector Crypt NFT backed by a professionally graded physical card held in a vault. You can keep the NFT, sell it, or redeem it on Collector Crypt to have the card shipped."],
  ["What are shards and tickets?", "Crates that hold no card pay 1 to 3 shards. Collect 10 shards for 1 ticket, up to 5 tickets. Ticket crates have much better odds."],
  ["Can I see the odds and the vault?", "Yes. The vault and live odds are public so you can check what is available before you walk anywhere."],
  ["Can I cheat with fake GPS?", "Don't. The server checks distance, speed between location pings, cooldowns and device signals. Flagged accounts are frozen and unsent prizes are withheld."],
  ["Where do prizes come from?", "Prizes are bought with creator fees from trading of the CardQuest coin. If there is less trading there is less to give away, so the vault can run low. Nothing here is a promise of returns."],
  ["Is CardQuest affiliated with Collector Crypt?", "No. We buy cards like any customer. Redemption and shipping are handled by Collector Crypt on their site."],
];

export default function Welcome() {
  return (
    <div className="lp">
      <header className="lp-nav">
        <Link href="/" aria-label="CardQuest home" className="brand"><Logo /></Link>
        <nav className="lp-links"><a href="#how">How it works</a><a href="#cities">Cities</a><a href="#tiers">Prizes</a><a href="#faq">FAQ</a></nav>
        <Link className="btn sm" href="/">Play now</Link>
      </header>

      <section className="lp-hero">
        <div className="lp-hero-l">
          <Hero>
            <div className="lp-cta">
              <Link className="btn" href="/">Open the map</Link>
              <Link className="btn ghost" href="/vault">See the vault &amp; odds</Link>
            </div>
          </Hero>
          <QrCard />
        </div>
        <LiveFeedPanel />
      </section>

      <section className="lp-sec" id="how">
        <p className="eyebrow">How it works</p>
        <h2>Four steps from your sofa <em>to a slab.</em></h2>
        <ol className="lp-steps">
          {steps.map((s, n) => (
            <li key={s.t} className="lp-step"><span className="lp-n">{String(n + 1).padStart(2, "0")}</span><span className="lp-ic" aria-hidden="true">{s.i}</span><b>{s.t}</b><p className="muted">{s.d}</p></li>
          ))}
        </ol>
        <p className="muted small">Winners can keep the card NFT, sell it, or <a href={LINKS.collectorCrypt} rel="noopener noreferrer">redeem it on Collector Crypt</a> for the physical card.</p>
      </section>

      <section className="lp-sec" id="cities">
        <p className="eyebrow">Launch cities</p>
        <h2>Live in {SERVICE_CITIES.length} cities. <em>Yours could be next.</em></h2>
        <ul className="lp-cities">
          {SERVICE_CITIES.map((c) => <li key={c.name}><b>{c.name}</b><span className="muted small">{c.radiusKm} km play zone</span></li>)}
        </ul>
        <p className="muted small">Crates only spawn inside a launch city&apos;s play zone. We open new cities as the vault grows.</p>
      </section>

      <section className="lp-sec" id="tiers">
        <p className="eyebrow">Prize tiers</p>
        <h2>Set by each card&apos;s <em>insured value.</em></h2>
        <div className="lp-tiers">
          {tiers.map((t) => (
            <div key={t.k} className={`lp-tier s-${t.k}`}><span className={`badge b-${t.k}`}>{t.n}</span><b>{t.v}</b></div>
          ))}
        </div>
      </section>

      <section className="lp-sec" id="shards">
        <p className="eyebrow">Shards &amp; tickets</p>
        <h2>No card? <em>Still progress.</em></h2>
        <div className="lp-two">
          <div className="lp-box"><span className="lp-big">◆</span><b>Shards</b><p className="muted">An empty crate still pays 1 to 3 shards.</p></div>
          <div className="lp-box"><span className="lp-big gold">🎟</span><b>Tickets</b><p className="muted">10 shards make 1 ticket, up to 5. Ticket crates are rarer on the map and have far better odds of a card.</p></div>
        </div>
        <Link className="lp-link" href="/vault">View live odds and what is in the vault →</Link>
      </section>

      <section className="lp-sec" id="coin">
        <p className="eyebrow">The coin</p>
        <h2>Trading fees <em>fill the vault.</em></h2>
        <p className="muted">Trading fees from the coin buy the cards given away in the game. More trading means more cards in the vault. This is not financial advice and nothing here promises returns or any price.</p>
        <div className="lp-box">
          <span className="muted small">Contract address</span>
          <code className="lp-ph">{LINKS.coin}</code>
          <div className="lp-cta">
            <a className="btn sm ghost" href={LINKS.pump} rel="noopener noreferrer">pump.fun</a>
            <a className="btn sm ghost" href={LINKS.x} rel="noopener noreferrer">{LINKS.xHandle}</a>
          </div>
        </div>
      </section>

      <section className="lp-sec" id="faq">
        <p className="eyebrow">FAQ</p>
        <h2>Good <em>questions.</em></h2>
        {faq.map(([q, a]) => (
          <details key={q} className="lp-faq"><summary>{q}</summary><p className="muted">{a}</p></details>
        ))}
      </section>

      <footer className="lp-foot">
        <h2>The next crate is <em>around the corner.</em></h2>
        <Link className="btn" href="/">Open the map</Link>
        <p className="muted small">CardQuest is an independent game and is not affiliated with Collector Crypt. Prizes depend on available inventory. Play where it is safe and legal; watch your surroundings.</p>
      </footer>
    </div>
  );
}
