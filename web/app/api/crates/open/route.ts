import { NextRequest, NextResponse } from "next/server";
import { game } from "@/lib/server";
import { clientIp, isRes, requireSession } from "@/lib/api";
import { openBody } from "@/lib/schemas";

export const dynamic = "force-dynamic";
export async function POST(req: NextRequest) {
  const s = await requireSession();
  if (isRes(s)) return s;
  const p = openBody.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  const { crateId, ...ping } = p.data;
  return NextResponse.json({ result: await game.openCrate(s.playerId, crateId, { ...ping, ip: clientIp(req) }), balances: await game.balances(s.playerId) });
}
