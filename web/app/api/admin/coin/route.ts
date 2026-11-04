import { NextRequest, NextResponse } from "next/server";
import { game } from "@/lib/server";
import { isRes, requireAdmin } from "@/lib/api";
import { coinBody } from "@/lib/schemas";

export const dynamic = "force-dynamic";
export async function GET() {
  const s = await requireAdmin();
  if (isRes(s)) return s;
  return NextResponse.json(await game.admin.coinSettings());
}
export async function PUT(req: NextRequest) {
  const s = await requireAdmin();
  if (isRes(s)) return s;
  const p = coinBody.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "invalid_input", message: "Paste the coin address." }, { status: 400 });
  try {
    return NextResponse.json(await game.admin.setCoin(p.data));
  } catch (e) {
    return NextResponse.json({ error: "rejected", message: e instanceof Error ? e.message : "Could not save." }, { status: 400 });
  }
}
