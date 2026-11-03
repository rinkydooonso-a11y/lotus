"use client";
import { useEffect } from "react";
import dynamic from "next/dynamic";
import { HeroCopy } from "@/components/HomePanels";
import { useScrollLock } from "@/components/Portal";
import { useFullMap } from "@/lib/viewStore";

const MapView = dynamic(() => import("@/components/MapView"), { ssr: false, loading: () => <div className="mapwrap" /> });

/** One screen: the globe is the background and you can zoom into it; the pitch floats over it, and the header links go to their own pages. */
export default function Home() {
  const full = useFullMap();
  useScrollLock(full);
  useEffect(() => { if (full) window.scrollTo(0, 0); }, [full]);
  return (
    <div className={full ? "home full" : "home"}>
      <section className="hero">
        <MapView />
        {!full && <HeroCopy />}
      </section>
    </div>
  );
}
