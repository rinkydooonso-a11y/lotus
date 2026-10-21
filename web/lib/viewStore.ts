"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useAuth } from "./auth/client";

/** Desktop visitors can open the home map full screen ("Explore the map"); phones signed in always play full screen. */
let exploring = false;
const subs = new Set<() => void>();

export function setExploring(v: boolean) {
  if (exploring === v) return;
  exploring = v;
  subs.forEach((f) => f());
}
export function useExploring(): boolean {
  return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => exploring, () => false);
}

export function useMedia(query: string): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const m = window.matchMedia(query);
    const sync = () => setOn(m.matches);
    sync();
    m.addEventListener("change", sync);
    return () => m.removeEventListener("change", sync);
  }, [query]);
  return on;
}

export const PHONE_QUERY = "(max-width: 899px)";
export const usePhone = () => useMedia(PHONE_QUERY);

/** True when the home map takes the whole screen: the game on a phone once signed in, or a desktop visitor exploring. */
export function useFullMap(): boolean {
  const { user } = useAuth();
  const phone = usePhone();
  const ex = useExploring();
  return ex || (phone && !!user);
}
