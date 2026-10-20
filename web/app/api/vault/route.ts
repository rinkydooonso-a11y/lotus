import { NextResponse } from "next/server";
import { game } from "@/lib/server";

export const dynamic = "force-dynamic";
export async function GET() { return NextResponse.json(await game.vaultStats()); }
