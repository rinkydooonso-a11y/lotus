import { NextRequest, NextResponse } from "next/server";
import { game } from "@/lib/server";
import { isRes, requireAdmin } from "@/lib/api";
import { oddsBody } from "@/lib/schemas";

export const dynamic = "force-dynamic";
export async function GET() {
  const s = await requireAdmin();
  if (isRes(s)) return s;
  return NextResponse.json({ rows: await game.admin.odds() });
}
export async function PUT(req: NextRequest) {
  const s = await requireAdmin();
  if (isRes(s)) return s;
  const p = oddsBody.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  await game.admin.setOdds(p.data.rows);
  return NextResponse.json({ ok: true });
}
