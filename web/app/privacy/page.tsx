import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy · CardQuest", description: "What CardQuest collects and why." };

// Plain-language draft. Have a lawyer review before mainnet launch. Retention matches PING_RETENTION_DAYS (default 30).
export default function Privacy() {
  return (
    <div className="page">
      <h1>Privacy</h1>
      <p className="muted small">Last updated: October 2026</p>
      <p>We collect what we need to run a location game and stop cheating, and no more. We do not sell your data and we do not ask for your name or email.</p>

      <h2>What we collect</h2>
      <ul>
        <li><b>Wallet address.</b> To sign you in and send prizes. Wallet addresses are public on the blockchain.</li>
        <li><b>Location.</b> Your device location while the map is open, so we can show nearby crates and check you are really there. We keep a short trail of recent pings for anti-cheat and delete pings older than 30 days.</li>
        <li><b>Device and network.</b> A random device ID stored in your browser and your IP address, used to limit abuse and spot one person running many wallets.</li>
        <li><b>Game history.</b> Crates opened, prizes won and sent, shards and tickets.</li>
        <li><b>Wallet checks.</b> For anti-cheat we may look up public on-chain facts about your wallet, such as its age.</li>
        <li><b>Sign-in cookie.</b> A signed cookie keeps you logged in. We use no advertising cookies.</li>
      </ul>

      <h2>How we use it</h2>
      <p>To run the game, send prizes, keep the game fair, fix problems, and meet legal duties. Winners, prize history and aggregate stats (for example live pulls and leaderboards) are shown publicly by wallet address.</p>

      <h2>Who handles it</h2>
      <p>We use service providers to host and run the game: our web host, database, anti-cheat cache, and a blockchain data provider. They process data for us and do not get it for their own use.</p>

      <h2>Backups and retention</h2>
      <p>Database backups are encrypted and kept for a short period. We keep game and prize records as long as needed to run the game and settle disputes. Blockchain records are permanent and outside our control.</p>

      <h2>Your choices</h2>
      <p>You can stop sharing location by closing the game or turning off location in your browser; you will not be able to open crates. To ask what we hold about a wallet or to ask for deletion of off-chain data, contact us on X at <a href="https://x.com/cardquestsol">@cardquestsol</a>. We may need to keep some records for safety or legal reasons.</p>

      <h2>Children</h2>
      <p>CardQuest is not for anyone under 18.</p>
    </div>
  );
}
