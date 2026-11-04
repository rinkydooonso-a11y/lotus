import { NextResponse } from "next/server";
import { game } from "@/lib/server";
import { buyUrlFor } from "@/lib/links";

export const dynamic = "force-dynamic";

/** Public: the coin address and buy link the site should show right now (set in the admin box at launch). */
export async function GET() {
  let coin: string | null = null;
  try { coin = await game.coinMint(); } catch { /* database trouble: show not-launched rather than fail the page */ }
  return NextResponse.json({ coin, buyUrl: coin ? buyUrlFor(coin) : null }, { headers: { "cache-control": "public, s-maxage=5, stale-while-revalidate=10" } });
}
