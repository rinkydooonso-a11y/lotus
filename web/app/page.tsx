"use client";
import { useEffect } from "react";
import dynamic from "next/dynamic";
import { HeroCopy, HomeSections } from "@/components/HomePanels";
import { PullTicker, useFeed } from "@/components/PullsFeed";
import { useScrollLock } from "@/components/Portal";
import { setExploring, useExploring, useFullMap } from "@/lib/viewStore";

const MapView = dynamic(() => import("@/components/MapView"), { ssr: false, loading: () => <div className="mapwrap" /> });

/** The globe with the pitch over it, and the story below. Once playing (or exploring), the map takes the whole screen. */
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
      <section className="hero">
        <MapView />
        {!full && <HeroCopy />}
        {!full && <PullTicker feed={feed} />}
      </section>
      {!full && <HomeSections feed={feed} />}
    </div>
  );
}
