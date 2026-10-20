import { NextResponse } from "next/server";
import { game } from "@/lib/server";
import { getSession, isAdmin } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.json({ user: null });
  const balances = await game.balances(s.playerId);
  return NextResponse.json({ user: { address: s.address, method: s.method, isAdmin: isAdmin(s) }, balances });
}
