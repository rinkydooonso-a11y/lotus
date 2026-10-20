import { NextResponse } from "next/server";
import { game } from "@/lib/server";

export const dynamic = "force-dynamic";
// Public: card pulls only, wallets masked. Short edge cache so the feed stays cheap under load.
export async function GET() {
  return NextResponse.json(await game.feed(), { headers: { "cache-control": "public, s-maxage=15, stale-while-revalidate=45" } });
}
