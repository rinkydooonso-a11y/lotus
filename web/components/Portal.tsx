"use client";
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Render overlays on <body>, so a blurred header or a transformed parent can't trap a fixed sheet inside itself. */
export function Portal({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return ready ? createPortal(children, document.body) : null;
}

/** Lock page scroll while a full-screen overlay is open (counted, so overlays can stack). */
let locks = 0;
export function useScrollLock(on = true) {
  useEffect(() => {
    if (!on) return;
    const el = document.documentElement;
    if (locks++ === 0) el.classList.add("locked");
    return () => { if (--locks === 0) el.classList.remove("locked"); };
  }, [on]);
}
