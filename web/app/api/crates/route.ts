import { NextRequest, NextResponse } from "next/server";
import { game } from "@/lib/server";
import { clientIp, isRes, requireSession } from "@/lib/api";
import { nearbyQuery } from "@/lib/schemas";

export const dynamic = "force-dynamic";
// POST (not GET) so location isn't logged in URLs. Spawns crates near the player and returns the active ones.
export async function POST(req: NextRequest) {
  const s = await requireSession();
  if (isRes(s)) return s;
  const p = nearbyQuery.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  return NextResponse.json({ crates: await game.nearbyCrates(s.playerId, { ...p.data, ip: clientIp(req) }) });
}
