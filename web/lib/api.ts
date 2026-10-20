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

/**
 * A dependency (database, Redis) failed or timed out. Logs it and returns a 503 so players get a
 * "try again" instead of a crash page; nothing about the failure is sent to the client.
 */
export function unavailable(where: string, err: unknown, body: Record<string, unknown> = { error: "unavailable" }): NextResponse {
  console.error(`${where} failed`, err instanceof Error ? err.message : err);
  return NextResponse.json(body, { status: 503, headers: { "retry-after": "5" } });
}
export const BUSY_MESSAGE = "CardQuest is busy right now. Try again in a few seconds.";
