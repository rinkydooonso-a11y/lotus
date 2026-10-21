"use client";
import { useEffect, type ReactNode } from "react";
import { Portal, useScrollLock } from "./Portal";
import { IconClose } from "./Icons";

/** A sheet that rises from the bottom on phones and floats centred on desktop. Escape or the scrim closes it. */
export function Sheet({ onClose, children, label, className = "", center = false }: { onClose?: () => void; children: ReactNode; label: string; className?: string; center?: boolean }) {
  useScrollLock();
  useEffect(() => {
    if (!onClose) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <Portal>
      <div className={center ? "scrim center" : "scrim"} onClick={onClose}>
        <div className={`sheet ${className}`} role="dialog" aria-modal="true" aria-label={label} onClick={(e) => e.stopPropagation()}>
          {!center && <div className="grab" aria-hidden="true" />}
          {onClose && <button className="sheet-x" onClick={onClose} aria-label="Close"><IconClose size={16} /></button>}
          {children}
        </div>
      </div>
    </Portal>
  );
}
