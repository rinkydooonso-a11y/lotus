// Launch day: set NEXT_PUBLIC_COIN_ADDRESS in Vercel (Production) and redeploy. Until it is set the site
// shows "Launching soon" and hides the buy button.
const COIN_ADDRESS = process.env.NEXT_PUBLIC_COIN_ADDRESS?.trim() || "COIN_ADDRESS_PLACEHOLDER";

export const LINKS = {
  ticker: "$QUEST", // pump.fun ticker, shown across the site
  coin: COIN_ADDRESS,
  x: "https://x.com/cardquestsol",
  xHandle: "@cardquestsol",
  pump: `https://pump.fun/coin/${COIN_ADDRESS}`,
  collectorCrypt: "https://collectorcrypt.com",
};

export const coinLive = !LINKS.coin.includes("PLACEHOLDER");
