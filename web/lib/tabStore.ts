"use client";
import { useSyncExternalStore } from "react";

export type HomeTab = "stats" | "crates" | "pulls" | "collectors" | "how";
/** Which panel is open over the home globe. The top bar opens them, so this lives outside any one component. */
let current: HomeTab | null = null;
const subs = new Set<() => void>();

export function setTab(t: HomeTab | null) {
  current = t;
  subs.forEach((f) => f());
}
export const toggleTab = (t: HomeTab) => setTab(current === t ? null : t);
export function useTab(): HomeTab | null {
  return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => current, () => null);
}
