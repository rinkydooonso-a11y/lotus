"use client";
import { useCity } from "@/lib/cityStore";

/** The selected launch city, animated in whenever it changes. */
export function CitySwap() {
  const city = useCity();
  return <span key={city} className="city-swap">{city}.</span>;
}
