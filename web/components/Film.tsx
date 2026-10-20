"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Mark } from "./Logo";

/** Open the "How CardQuest works" film from anywhere. */
export const openFilm = () => window.dispatchEvent(new Event("cq:film"));

const SCENES = [
  { t: "Crates drop in launch cities", d: "Every few minutes, new crates land on the streets around you." },
  { t: "Walk up to one", d: "Get within 40 metres. Your phone's location unlocks it." },
  { t: "Open it", d: "Each crate rolls for a graded card, or shards toward a ticket." },
  { t: "The card is yours", d: "Real slabs from a public vault, sent straight to your wallet." },
];
const SCENE_MS = 4500;

/** A short animated explainer that plays like a video: scenes, progress, play/pause, replay. */
export function FilmHost() {
  const [open, setOpen] = useState(false);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(true);
  const last = useRef(0);
  const total = SCENES.length * SCENE_MS;

  useEffect(() => {
    const on = () => { setOpen(true); setT(0); setPlaying(true); };
    window.addEventListener("cq:film", on);
    return () => window.removeEventListener("cq:film", on);
  }, []);
  useEffect(() => {
    if (!open || !playing) return;
    let raf = 0;
    last.current = performance.now();
    const tick = (now: number) => {
      setT((x) => { const n = Math.min(total, x + (now - last.current)); if (n >= total) setPlaying(false); return n; });
      last.current = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [open, playing, total]);
  const close = useCallback(() => setOpen(false), []);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") close(); if (e.key === " ") { e.preventDefault(); setPlaying((p) => !p); } };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, close]);
  if (!open) return null;

  const scene = Math.min(SCENES.length - 1, Math.floor(t / SCENE_MS));
  const local = (t - scene * SCENE_MS) / SCENE_MS;
  const done = t >= total;
  const toggle = () => { if (done) { setT(0); setPlaying(true); } else setPlaying((p) => !p); };
  const sec = (ms: number) => `0:${String(Math.floor(ms / 1000)).padStart(2, "0")}`;
  return (
    <div className="film-back" onClick={close}>
      <div className="film" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="How CardQuest works">
        <button className="x film-x" onClick={close} aria-label="Close">✕</button>
        <div className={`stage s${scene}`} style={{ ["--p" as string]: local }} onClick={toggle}>
          <div className="stage-map" aria-hidden="true"><i /><i /><i /><i /><i /><i /></div>
          {scene === 0 && <div className="sc sc0" aria-hidden="true">{[0, 1, 2, 3, 4].map((i) => <span key={i} className="drop" style={{ animationDelay: `${i * 0.45}s`, left: `${18 + i * 16}%`, top: `${30 + ((i * 37) % 40)}%` }}>🎁</span>)}</div>}
          {scene === 1 && <div className="sc sc1" aria-hidden="true"><span className="walker" /><span className="target">🎁</span><span className="ring" /></div>}
          {scene === 2 && <div className="sc sc2" aria-hidden="true"><span className="burst" /><span className="box">🎁</span></div>}
          {scene === 3 && <div className="sc sc3" aria-hidden="true"><div className="slab s-grail lg"><div className="slab-label"><span>PSA 10</span></div><div className="slab-art"><i /></div></div><span className="to-wallet">→ wallet</span></div>}
          <div className="caption" key={scene}><span className="eyebrow">Step {scene + 1} of {SCENES.length}</span><b>{SCENES[scene].t}</b><p>{SCENES[scene].d}</p></div>
          {!playing && !done && <span className="bigplay" aria-hidden="true">▶</span>}
          <span className="film-brand"><Mark size={22} /> CardQuest</span>
        </div>
        <div className="controls">
          <button onClick={toggle} aria-label={done ? "Replay" : playing ? "Pause" : "Play"}>{done ? "↻" : playing ? "❚❚" : "▶"}</button>
          <div className="segs">{SCENES.map((_, i) => <button key={i} aria-label={`Step ${i + 1}`} onClick={() => { setT(i * SCENE_MS); setPlaying(true); }}><i style={{ width: `${Math.max(0, Math.min(1, (t - i * SCENE_MS) / SCENE_MS)) * 100}%` }} /></button>)}</div>
          <span className="time mono">{sec(t)} / {sec(total)}</span>
        </div>
      </div>
    </div>
  );
}
