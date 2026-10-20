"use client";
import dynamic from "next/dynamic";
import { HomePanels } from "@/components/HomePanels";

const MapView = dynamic(() => import("@/components/MapView"), { ssr: false, loading: () => <div className="mapwrap" /> });
export default function Home() {
  return <div className="home"><MapView /><HomePanels /></div>;
}
