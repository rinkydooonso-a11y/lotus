import { NextRequest, NextResponse } from "next/server";
import { game } from "@/lib/server";
import { isRes, requireAdmin } from "@/lib/api";
import { freezeBody } from "@/lib/schemas";

export const dynamic = "force-dynamic";
export async function GET() {
  const s = await requireAdmin();
  if (isRes(s)) return s;
  return NextResponse.json({ players: await game.admin.flagged() });
}
export async function POST(req: NextRequest) {
  const s = await requireAdmin();
  if (isRes(s)) return s;
  const p = freezeBody.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  await game.admin.setFrozen(p.data.playerId, p.data.frozen);
  return NextResponse.json({ ok: true });
}
