import type { Metadata } from "next";
import { SiteFooter } from "@/components/Docs";
import Link from "next/link";
import { LINKS, coinLive } from "@/lib/links";
import { COIN_HOLD_USD, DAILY_PRIZE_CAP_USD, FREE_OPENS_PER_DAY, SHARDS_PER_TICKET } from "@/lib/rules";

export const metadata: Metadata = { title: "Terms of Play · CardQuest", description: "The rules for playing CardQuest." };

// Plain-language draft. Have a lawyer review before mainnet launch; eligibility and prize rules vary by country.
export default function Terms() {
  return (
    <div className="docs prose">
      <h1>Terms of Play</h1>
      <p className="updated">Last updated: October 2026</p>
      <p>CardQuest is a map game. You walk to crates, open them, and can win shards, tickets or a real graded trading card sent to your Solana wallet. By connecting a wallet you agree to these terms.</p>

      <h2>Who can play</h2>
      <p>You must be 18 or older, or the age of majority where you live. You are responsible for checking that games with crypto prizes are allowed where you are. Do not play if they are not.</p>

      <h2>Crates and opens</h2>
      <ul>
        <li>Crates exist only in our launch cities. They are shared: there is one set per city, and the first player to reach a crate takes it. It then disappears for everyone.</li>
        <li>Every player gets {FREE_OPENS_PER_DAY} free opens a day. The day resets at midnight UTC. {SHARDS_PER_TICKET} shards make one ticket, and spending a ticket gives you another open.</li>
        <li>Odds are public on the Vault page. They can change, and a prize is never guaranteed.</li>
      </ul>

      <h2>Holding the coin</h2>
      {coinLive ? (
        <>
          <p>Opening crates costs no fee, but your wallet must hold ${COIN_HOLD_USD} worth of {LINKS.ticker} to open them. We check this each time you open. Once you qualify, the requirement is fixed for 48 hours. If your holding drops below it during that window, opening pauses until the window ends.</p>
          <p>Buying the coin is your choice and carries risk, including losing all of its value. See &quot;No financial advice&quot; below.</p>
        </>
      ) : (
        <p>Once the CardQuest coin launches, your wallet will need to hold ${COIN_HOLD_USD} worth of it to open crates. We will announce the date on X. Until then this requirement does not apply.</p>
      )}
      <p>Connecting a wallet is a sign-in message only; it does not move funds. We will never ask for your seed phrase or private key.</p>

      <h2>Prizes</h2>
      <ul>
        <li>Card prizes are NFTs of graded physical cards. You can keep, trade or redeem them with the card custodian under their own terms.</li>
        <li>We only award cards that are in stock. Odds are public on the Vault page and change as stock changes. If a tier has no stock, its share moves to shards.</li>
        <li>Cards are sent from the prize wallet to the wallet you connected when you won. We cannot send to a different address afterwards. If a send fails we retry, but we cannot recover a prize sent to a wallet you do not control.</li>
        <li>Card prizes are limited by a daily cap of ${DAILY_PRIZE_CAP_USD} in total card value across all players, counted per UTC day. Once it is reached, opens pay shards only until the day resets.</li>
        <li>Prizes have no guaranteed value. Card values change.</li>
      </ul>

      <h2>Fair play</h2>
      <p>Play in person, on your own device, on foot or by other safe, legal means. Fake GPS, teleporting, emulators, bots, running many wallets or devices, and any other attempt to cheat are not allowed. We check for this automatically, including location, wallets, devices and network (for example VPNs). If we flag your account we may freeze it, hold or deny prizes while we review it, and remove you from the game. We may reverse prizes won by cheating.</p>

      <h2>Your safety</h2>
      <p>You play at your own risk. Stay aware of your surroundings, follow the law, and never go anywhere unsafe or private for a crate. See the <Link href="/safe-play">Safe play</Link> page.</p>

      <h2>No financial advice</h2>
      <p>CardQuest is a game, not an investment. Nothing here is financial advice or a promise of returns. Prizes are funded by the project&apos;s treasury and depend on what is in the vault. Holding the coin does not entitle you to any prize or return. We are not affiliated with or endorsed by Collector Crypt or any wallet provider.</p>

      <h2>Changes and availability</h2>
      <p>The game may change, pause or stop at any time, for example for maintenance, safety or legal reasons. We may update these terms; continuing to play means you accept the new version.</p>

      <h2>Liability</h2>
      <p>The game is provided as is. To the extent the law allows, we are not liable for lost prizes sent to a wallet you chose, blockchain or wallet failures, downtime, or any injury or loss while playing.</p>

      <h2>Contact</h2>
      <p>Find us on X at <a href="https://x.com/cardquestsol">@cardquestsol</a>.</p>
      <SiteFooter />
    </div>
  );
}
