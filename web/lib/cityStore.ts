"use client";
import { useSyncExternalStore } from "react";
import { SERVICE_CITIES } from "./cities";

/** The launch city the home screen is showing (picked from the city bar, or the visitor's nearest). */
let current: string = SERVICE_CITIES[0].name;
let picked = false;
const subs = new Set<() => void>();

export function setCity(name: string, byUser = true) {
  if (!byUser && picked) return;
  if (byUser) picked = true;
  current = name;
  subs.forEach((f) => f());
}
/** A visitor picked a city (city bar, globe dot, phone chips): select it and fly the map there, even if it's already selected. */
export function pickCity(name: string) {
  setCity(name);
  window.dispatchEvent(new CustomEvent("cq:city", { detail: name }));
}
export function useCity(): string {
  return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => current, () => current);
}
export const cityByName = (name: string) => SERVICE_CITIES.find((c) => c.name === name) ?? SERVICE_CITIES[0];
