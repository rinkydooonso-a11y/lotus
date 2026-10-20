import "server-only";
import { NextResponse } from "next/server";
import { getSession, isAdmin, type Session } from "@/lib/auth/session";

export async function requireSession(): Promise<Session | NextResponse> {
  const s = await getSession();
  return s ?? NextResponse.json({ error: "unauthorized" }, { status: 401 });
}
export async function requireAdmin(): Promise<Session | NextResponse> {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return isAdmin(s) ? s : NextResponse.json({ error: "forbidden" }, { status: 403 });
}
export const isRes = (x: unknown): x is NextResponse => x instanceof NextResponse;

export function clientIp(req: Request): string | null {
  const h = req.headers.get("x-forwarded-for");
  return h ? h.split(",")[0].trim() : req.headers.get("x-real-ip");
}
