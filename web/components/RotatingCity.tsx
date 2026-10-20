"use client";
import { useEffect, useState } from "react";
import { SERVICE_CITIES } from "@/lib/cities";

/** Cycles through the launch cities, for headlines. */
export function RotatingCity() {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setI((n) => (n + 1) % SERVICE_CITIES.length), 2400);
    return () => clearInterval(t);
  }, []);
  return <em key={i} className="hero-city">{SERVICE_CITIES[i].name}.</em>;
}
