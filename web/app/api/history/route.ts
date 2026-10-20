import { NextResponse } from "next/server";
import { game } from "@/lib/server";
import { isRes, requireSession } from "@/lib/api";

export const dynamic = "force-dynamic";
export async function GET() {
  const s = await requireSession();
  if (isRes(s)) return s;
  return NextResponse.json({ history: await game.history(s.playerId) });
}
