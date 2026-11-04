"use client";
import { useEffect, useState } from "react";
import { LINKS, coinLive } from "./links";

export interface CoinInfo {
  /** The coin address, or the placeholder text before launch. */
  coin: string;
  live: boolean;
  buyUrl: string;
}

const fallback: CoinInfo = { coin: LINKS.coin, live: coinLive, buyUrl: LINKS.buy };
let shared: CoinInfo | null = null;
let inflight: Promise<CoinInfo> | null = null;

/** Fetches the coin the admin set at launch, once per page load. Starts from the build-time fallback. */
function load(): Promise<CoinInfo> {
  inflight ??= fetch("/api/config", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((j: { coin?: string | null; buyUrl?: string | null } | null) => {
      shared = j?.coin ? { coin: j.coin, live: true, buyUrl: j.buyUrl ?? fallback.buyUrl } : fallback;
      return shared;
    })
    .catch(() => fallback);
  return inflight;
}

export function useCoin(): CoinInfo {
  const [info, setInfo] = useState<CoinInfo>(shared ?? fallback);
  useEffect(() => { let on = true; void load().then((i) => { if (on) setInfo(i); }); return () => { on = false; }; }, []);
  return info;
}
