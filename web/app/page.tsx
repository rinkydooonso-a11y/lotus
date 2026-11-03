"use client";
import { useEffect } from "react";
import dynamic from "next/dynamic";
import { FinalCta, GlobeHead, Hero, HowSection, Marquee, NumbersBand, PullsSection } from "@/components/HomePanels";
import { SiteFooter } from "@/components/Docs";
import { useFeed } from "@/components/PullsFeed";
import { useScrollLock } from "@/components/Portal";
import { setExploring, useExploring, useFullMap } from "@/lib/viewStore";

const MapView = dynamic(() => import("@/components/MapView"), { ssr: false, loading: () => <div className="mapwrap" /> });

/** A scrolling landing page with the globe in the middle of it. Once playing (or exploring), the globe takes the whole screen. */
export default function Home() {
  const full = useFullMap();
  const exploring = useExploring();
  const feed = useFeed();
  useScrollLock(full);
  useEffect(() => { if (full) window.scrollTo(0, 0); }, [full]);
  useEffect(() => {
    if (!exploring) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector(".scrim")) setExploring(false); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [exploring]);
  useEffect(() => () => setExploring(false), []);
  return (
    <div className={full ? "home full" : "home"}>
      <div className="home-page">
        <Hero />
        <Marquee feed={feed} />
        <HowSection />
        <PullsSection feed={feed} />
      </div>
      <section className="globe-sec">
        {!full && <GlobeHead />}
        <div className="stage"><MapView /></div>
      </section>
      <div className="home-page">
        <NumbersBand feed={feed} />
        <FinalCta />
        <SiteFooter />
      </div>
    </div>
  );
}
