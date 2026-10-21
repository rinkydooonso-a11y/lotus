import { NextRequest, NextResponse } from "next/server";
import { game } from "@/lib/server";
import { clientIp, isRes, requireSession, unavailable } from "@/lib/api";
import { nearbyQuery } from "@/lib/schemas";

export const dynamic = "force-dynamic";
export async function POST(req: NextRequest) {
  const s = await requireSession();
  if (isRes(s)) return s;
  const p = nearbyQuery.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  try {
    return NextResponse.json(await game.useTicket(s.playerId, { ...p.data, ip: clientIp(req) }));
  } catch (err) {
    return unavailable("use ticket", err, { ok: false, code: "unavailable" });
  }
}
