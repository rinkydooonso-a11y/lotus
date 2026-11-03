"use client";
import { useEffect } from "react";
import dynamic from "next/dynamic";
import { HeroCopy, HomeSections } from "@/components/HomePanels";
import { useFeed } from "@/components/PullsFeed";
import { useScrollLock } from "@/components/Portal";
import { useFullMap } from "@/lib/viewStore";

const MapView = dynamic(() => import("@/components/MapView"), { ssr: false, loading: () => <div className="mapwrap" /> });

/** One screen: the globe is the background and you can zoom into it; the pitch floats over it, and the extra info is in tabs. */
export default function Home() {
  const full = useFullMap();
  const feed = useFeed();
  useScrollLock(full);
  useEffect(() => { if (full) window.scrollTo(0, 0); }, [full]);
  return (
    <div className={full ? "home full" : "home"}>
      <section className="hero">
        <MapView />
        {!full && <HeroCopy />}
        {!full && <HomeSections feed={feed} />}
      </section>
    </div>
  );
}
