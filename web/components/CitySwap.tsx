"use client";
import { useEffect, useRef, useState } from "react";
import { SERVICE_CITIES } from "@/lib/cities";
import { pickCity, useCity } from "@/lib/cityStore";
import { usePhone } from "@/lib/viewStore";
import { IconCheck, IconChevronDown } from "./Icons";
import { Sheet } from "./Sheet";

function CityList({ city, onPick }: { city: string; onPick: (name: string) => void }) {
  return (
    <ul className="city-list" role="listbox" aria-label="Launch cities">
      {SERVICE_CITIES.map((c) => (
        <li key={c.name}>
          <button role="option" aria-selected={c.name === city} className={c.name === city ? "on" : ""} onClick={() => onPick(c.name)}>
            <span>{c.name}</span>{c.name === city && <IconCheck size={16} />}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The launch city in the headline. Tap it to pick another city; the map flies there. */
export function CitySwap() {
  const city = useCity();
  const phone = usePhone();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open || phone) return;
    const off = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", off);
    window.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", off); window.removeEventListener("keydown", esc); };
  }, [open, phone]);
  const pick = (name: string) => { setOpen(false); pickCity(name); };
  return (
    <span className="city-pick-wrap" ref={wrap}>
      <button className="city-pick" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)} title="Change city">
        <span key={city} className="city-swap">{city}</span>
        <IconChevronDown className="city-chev" strokeWidth={2.4} />
      </button>
      {open && !phone && <div className="city-pop"><p className="city-pop-title">{SERVICE_CITIES.length} launch cities</p><CityList city={city} onPick={pick} /></div>}
      {open && phone && (
        <Sheet onClose={() => setOpen(false)} label="Launch cities" className="city-sheet">
          <div className="sheet-head left"><h2>Launch cities</h2><p>Crates are dropping in {SERVICE_CITIES.length} cities. Pick one to fly there.</p></div>
          <CityList city={city} onPick={pick} />
        </Sheet>
      )}
    </span>
  );
}
