import Link from "next/link";
import type { ReactNode } from "react";
import { SERVICE_CITIES } from "@/lib/cities";
import { RotatingCity } from "./RotatingCity";

/** The big CardQuest pitch: used in the home side panel and on /welcome. */
export function Hero({ children }: { children?: ReactNode }) {
  return (
    <div className="hero">
      <h1 className="hero-h">Graded cards are dropping in <RotatingCity /></h1>
      <p className="hero-sub">Crates spawn on the map around you. Walk up, open one, and you could land a real slabbed card, delivered straight to your wallet.</p>
      <p className="hero-cities"><span className="live-dot" />Live in {SERVICE_CITIES.length} launch cities, from {SERVICE_CITIES[0].name} to {SERVICE_CITIES[SERVICE_CITIES.length - 1].name}</p>
      {children}
      <Link href="/welcome" className="panel-card howto">
        <span className="howto-ic" aria-hidden="true">▶</span>
        <span><b>How CardQuest works</b><span className="muted">Four steps, about a minute to read</span></span>
      </Link>
    </div>
  );
}
