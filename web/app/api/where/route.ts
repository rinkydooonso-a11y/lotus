import { NextRequest, NextResponse } from "next/server";
import { haversineM } from "@/lib/geo";
import { SERVICE_CITIES } from "@/lib/cities";

export const dynamic = "force-dynamic";
// Nearest launch city to the visitor's IP location (Vercel geo headers), so the home map opens somewhere relevant.
export async function GET(req: NextRequest) {
  const lat = Number(req.headers.get("x-vercel-ip-latitude"));
  const lng = Number(req.headers.get("x-vercel-ip-longitude"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return NextResponse.json({ city: null });
  const city = [...SERVICE_CITIES].sort((a, b) => haversineM(a, { lat, lng }) - haversineM(b, { lat, lng }))[0];
  return NextResponse.json({ city: city.name }, { headers: { "cache-control": "private, max-age=3600" } });
}
