import { NextRequest, NextResponse } from "next/server";
import { game } from "@/lib/server";
import { BUSY_MESSAGE, clientIp, isRes, requireSession, unavailable } from "@/lib/api";
import { openBody } from "@/lib/schemas";

export const dynamic = "force-dynamic";
export async function POST(req: NextRequest) {
  const s = await requireSession();
  if (isRes(s)) return s;
  const p = openBody.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  const { crateId, ...ping } = p.data;
  // Anti-cheat fails closed: if Redis or the database is down the open is refused, never let through.
  let result;
  try {
    result = await game.openCrate(s.playerId, crateId, { ...ping, ip: clientIp(req) });
  } catch (err) {
    return unavailable("open crate", err, { result: { kind: "rejected", code: "unavailable", message: BUSY_MESSAGE } });
  }
  // The open is already recorded; a failed balance read must not hide its result.
  const balances = await game.balances(s.playerId).catch(() => undefined);
  return NextResponse.json({ result, balances });
}
