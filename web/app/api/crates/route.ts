import { NextRequest, NextResponse } from "next/server";
import { game } from "@/lib/server";
import { clientIp, isRes, requireSession } from "@/lib/api";
import { isAdmin } from "@/lib/auth/session";
import { nearbyQuery } from "@/lib/schemas";
import { haversineM } from "@/lib/geo";
import { SERVICE_CITIES } from "@/lib/cities";

export const dynamic = "force-dynamic";
// POST (not GET) so location isn't logged in URLs. Spawns crates near the player and returns the active ones.
export async function POST(req: NextRequest) {
  const s = await requireSession();
  if (isRes(s)) return s;
  const p = nearbyQuery.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  const anywhere = isAdmin(s);
  const crates = await game.nearbyCrates(s.playerId, { ...p.data, ip: clientIp(req), anywhere });
  // Tell players outside every launch city why the map is empty, and which city is closest.
  const nearest = SERVICE_CITIES.map((c) => ({ name: c.name, km: Math.max(0, haversineM(c, p.data) / 1000 - c.radiusKm) })).sort((a, b) => a.km - b.km)[0];
  const outside = !anywhere && process.env.LOTUS_CITY_GATE !== "off" && nearest.km > 0;
  return NextResponse.json({ crates, outside, nearest: outside ? { name: nearest.name, km: Math.round(nearest.km) } : undefined });
}
