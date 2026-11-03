// Launch day: set NEXT_PUBLIC_COIN_ADDRESS in Vercel (Production) and redeploy. Until it is set the site
// shows "Launching soon" and hides the buy button.
const COIN_ADDRESS = process.env.NEXT_PUBLIC_COIN_ADDRESS?.trim() || "COIN_ADDRESS_PLACEHOLDER";
// The prize wallet (the one holding the cards). Set NEXT_PUBLIC_PRIZE_WALLET in Vercel; until then the vault link goes to the marketplace.
const PRIZE_WALLET = process.env.NEXT_PUBLIC_PRIZE_WALLET?.trim();

export const LINKS = {
  ticker: "$QUEST", // coin ticker, shown across the site
  coin: COIN_ADDRESS,
  x: "https://x.com/cardquestsol",
  xHandle: "@cardquestsol",
  // Where "Get the coin" goes. Defaults to a Jupiter swap into the coin (works for any Raydium coin); set NEXT_PUBLIC_BUY_URL to the Float coin page to send people there instead.
  buy: process.env.NEXT_PUBLIC_BUY_URL?.trim() || `https://jup.ag/swap/SOL-${COIN_ADDRESS}`,
  collectorCrypt: "https://collectorcrypt.com",
  vault: PRIZE_WALLET ? `https://collectorcrypt.com/account/${PRIZE_WALLET}` : "https://collectorcrypt.com",
};

export const coinLive = !LINKS.coin.includes("PLACEHOLDER");
