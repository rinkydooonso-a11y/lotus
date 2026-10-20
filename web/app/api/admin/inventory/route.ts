import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { game } from "@/lib/server";
import { isRes, requireAdmin } from "@/lib/api";

export const dynamic = "force-dynamic";
const addBody = z.object({ nftMint: z.string().min(32).max(64), cardName: z.string().min(1).max(200), grade: z.string().max(40).optional(), valueUsd: z.number().positive().max(1_000_000), imageUrl: z.string().url().max(500).optional() });
const statusBody = z.object({ id: z.string().min(1), status: z.enum(["available", "withheld", "removed"]) });

export async function GET() {
  const s = await requireAdmin();
  if (isRes(s)) return s;
  return NextResponse.json({ items: await game.admin.inventory() });
}
export async function POST(req: NextRequest) {
  const s = await requireAdmin();
  if (isRes(s)) return s;
  const p = addBody.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  return NextResponse.json(await game.admin.addItem(p.data));
}
export async function PATCH(req: NextRequest) {
  const s = await requireAdmin();
  if (isRes(s)) return s;
  const p = statusBody.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  await game.admin.setItemStatus(p.data.id, p.data.status);
  return NextResponse.json({ ok: true });
}
