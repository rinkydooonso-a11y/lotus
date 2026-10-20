import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

/**
 * Server-side session. Method-agnostic: a session is { playerId, address, method }.
 * Adding email login later = a new route that calls `startSession` after its own verification.
 */
export interface Session { playerId: string; address: string; method: "wallet" | "email" }

const COOKIE = "lotus_session";
const key = () => {
  const s = process.env.LOTUS_SESSION_SECRET;
  if (!s && process.env.NODE_ENV === "production") throw new Error("LOTUS_SESSION_SECRET is required in production");
  return new TextEncoder().encode(s || "dev-only-insecure-secret-change-me");
};

export async function startSession(res: NextResponse, s: Session): Promise<void> {
  const jwt = await new SignJWT({ ...s }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("14d").sign(key());
  res.cookies.set(COOKIE, jwt, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 14 * 86400 });
}
export function endSession(res: NextResponse): void { res.cookies.delete(COOKIE); }

export async function getSession(): Promise<Session | null> {
  const c = cookies().get(COOKIE)?.value;
  if (!c) return null;
  try {
    const { payload } = await jwtVerify(c, key());
    return { playerId: String(payload.playerId), address: String(payload.address), method: payload.method === "email" ? "email" : "wallet" };
  } catch { return null; }
}

export function isAdmin(s: Session | null): boolean {
  if (!s) return false;
  return (process.env.LOTUS_ADMIN_WALLETS ?? "").split(",").map((x) => x.trim()).filter(Boolean).includes(s.address);
}

export async function nonceToken(): Promise<{ nonce: string; token: string }> {
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString("hex");
  const token = await new SignJWT({ nonce }).setProtectedHeader({ alg: "HS256" }).setExpirationTime("5m").sign(key());
  return { nonce, token };
}
export async function checkNonce(token: string | undefined, nonce: string): Promise<boolean> {
  if (!token) return false;
  try { const { payload } = await jwtVerify(token, key()); return payload.nonce === nonce; } catch { return false; }
}

export const loginMessage = (nonce: string) => `Sign in to Lotus\nNonce: ${nonce}`;
