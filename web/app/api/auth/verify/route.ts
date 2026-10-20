import { NextRequest, NextResponse } from "next/server";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { game } from "@/lib/server";
import { checkNonce, loginMessage, startSession } from "@/lib/auth/session";
import { verifyBody } from "@/lib/schemas";

export async function POST(req: NextRequest) {
  const parsed = verifyBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  const { address, signature, nonce } = parsed.data;
  if (!(await checkNonce(req.cookies.get("lotus_nonce")?.value, nonce))) return NextResponse.json({ error: "bad_nonce" }, { status: 401 });
  let ok = false;
  try { ok = nacl.sign.detached.verify(new TextEncoder().encode(loginMessage(nonce)), bs58.decode(signature), bs58.decode(address)); } catch { ok = false; }
  if (!ok) return NextResponse.json({ error: "bad_signature" }, { status: 401 });
  const playerId = await game.playerForWallet(address);
  const res = NextResponse.json({ ok: true, address });
  res.cookies.delete("lotus_nonce");
  await startSession(res, { playerId, address, method: "wallet" });
  return res;
}
