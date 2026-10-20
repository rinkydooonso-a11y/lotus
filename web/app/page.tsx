"use client";
import dynamic from "next/dynamic";

const MapView = dynamic(() => import("@/components/MapView"), { ssr: false, loading: () => <div className="mapwrap" /> });
export default function Home() { return <MapView />; }
