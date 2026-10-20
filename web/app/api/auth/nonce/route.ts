import { NextResponse } from "next/server";
import { loginMessage, nonceToken } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export async function GET() {
  const { nonce, token } = await nonceToken();
  const res = NextResponse.json({ nonce, message: loginMessage(nonce) });
  res.cookies.set("lotus_nonce", token, { httpOnly: true, sameSite: "lax", maxAge: 300, path: "/api/auth" });
  return res;
}
