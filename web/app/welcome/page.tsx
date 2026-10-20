import type { Metadata } from "next";
import Link from "next/link";
import "./landing.css";
import { LINKS } from "./config";

export const metadata: Metadata = {
  title: "Lotus: walk, find crates, win real graded cards",
  description: "A free-to-play location game. Open crates on the map and win real graded trading cards backed by a physical vault.",
};

const steps = [
  { i: "🔗", t: "Connect a wallet", d: "Phantom, Solflare or Backpack. Playing is free." },
  { i: "📍", t: "Turn on location", d: "Crates appear on the map around you. Your first one spawns where you stand." },
  { i: "🚶", t: "Walk to a crate", d: "Get within about 40 metres. No teleporting: we check your movement." },
  { i: "🎁", t: "Open it", d: "Win a graded card, or shards toward tickets. Cards land in your wallet." },
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
  ["Where do prizes come from?", "Prizes are bought with creator fees from trading of the Lotus coin. If there is less trading there is less to give away, so the vault can run low. Nothing here is a promise of returns."],
  ["Is Lotus affiliated with Collector Crypt?", "No. We buy cards like any customer. Redemption and shipping are handled by Collector Crypt on their site."],
];

export default function Welcome() {
  return (
    <div className="lp">
      <header className="lp-nav">
        <span className="lp-brand"><span className="lotus">✿</span> Lotus</span>
        <Link className="btn sm" href="/">Play</Link>
      </header>

      <section className="lp-hero">
        <p className="lp-eyebrow">Free to play · Solana</p>
        <h1>Walk. Find crates.<br />Win real graded cards.</h1>
        <p className="lp-sub">A map game where the prizes are real: graded trading cards from a physical vault, delivered to your wallet.</p>
        <div className="lp-cta">
          <Link className="btn" href="/">Start playing</Link>
          <Link className="btn ghost" href="/vault">See the vault &amp; odds</Link>
        </div>
        <div className="lp-crates" aria-hidden="true"><span>🎁</span><span>🎁</span><span className="t">🎟️</span></div>
      </section>

      <section className="lp-sec" id="how">
        <h2>How to play</h2>
        <ol className="lp-steps">
          {steps.map((s, n) => (
            <li key={s.t} className="card"><span className="lp-n">{n + 1}</span><span className="lp-ic">{s.i}</span><div><b>{s.t}</b><p className="muted">{s.d}</p></div></li>
          ))}
        </ol>
        <p className="muted small">Winners can keep the card NFT, sell it, or <a href={LINKS.collectorCrypt} rel="noopener noreferrer">redeem it on Collector Crypt</a> for the physical card.</p>
      </section>

      <section className="lp-sec" id="tiers">
        <h2>Prize tiers</h2>
        <p className="muted">Tiers are set by the card's insured value.</p>
        <div className="lp-tiers">
          {tiers.map((t) => (
            <div key={t.k} className={`card lp-tier t-${t.k}`}><span className={`badge b-${t.k}`}>{t.n}</span><b>{t.v}</b></div>
          ))}
        </div>
      </section>

      <section className="lp-sec" id="shards">
        <h2>Shards &amp; tickets</h2>
        <div className="lp-two">
          <div className="card"><span className="lp-big">💎</span><b>Shards</b><p className="muted">An empty crate still pays 1 to 3 shards.</p></div>
          <div className="card"><span className="lp-big">🎟️</span><b>Tickets</b><p className="muted">10 shards make 1 ticket, up to 5. Ticket crates are rarer on the map and have far better odds of a card.</p></div>
        </div>
        <Link className="lp-link" href="/vault">View live odds and what is in the vault →</Link>
      </section>

      <section className="lp-sec" id="coin">
        <h2>The Lotus coin</h2>
        <p className="muted">Trading fees from the coin buy the cards given away in the game. More trading means more cards in the vault. This is not financial advice and nothing here promises returns or any price.</p>
        <div className="card">
          <span className="muted small">Contract address</span>
          <code className="lp-ph">{LINKS.coin}</code>
          <div className="lp-cta">
            <a className="btn sm ghost" href={LINKS.pump} rel="noopener noreferrer">pump.fun</a>
            <a className="btn sm ghost" href={LINKS.x} rel="noopener noreferrer">{LINKS.xHandle}</a>
          </div>
        </div>
      </section>

      <section className="lp-sec" id="faq">
        <h2>FAQ</h2>
        {faq.map(([q, a]) => (
          <details key={q} className="card lp-faq"><summary>{q}</summary><p className="muted">{a}</p></details>
        ))}
      </section>

      <footer className="lp-foot">
        <Link className="btn wide" href="/">Open the map</Link>
        <p className="muted small">Lotus is an independent game and is not affiliated with Collector Crypt. Prizes depend on available inventory. Play where it is safe and legal; watch your surroundings.</p>
      </footer>
    </div>
  );
}
