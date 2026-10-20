"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { cityByName, useCity } from "@/lib/cityStore";
import { Mark } from "./Logo";
import { QrCard } from "./QrCard";

/** Open the "How CardQuest works" film from anywhere. */
export const openFilm = () => window.dispatchEvent(new Event("cq:film"));

const STYLE_URL = process.env.NEXT_PUBLIC_MAP_STYLE_URL || "https://tiles.openfreemap.org/styles/dark";
const CH_MS = 5600;

interface Chapter { name: string; title: string; caption: string; map: boolean; stage: string }
const CHAPTERS: Chapter[] = [
  { name: "Crates", title: "Cards are dropping on your streets.", caption: "Crates land on sidewalks, paths and parks, and everyone nearby sees the same ones.", map: true, stage: "drops" },
  { name: "Walk", title: "Walk up to one.", caption: "Get within 40 metres and it unlocks. Everyone gets a daily stack of crates.", map: true, stage: "walk" },
  { name: "Open", title: "Open it up.", caption: "Every crate rolls for a real card. Some pay shards instead, so keep walking.", map: false, stage: "burst" },
  { name: "Pull", title: "Pull a graded slab.", caption: "Professionally graded, insured, and yours the second it flips.", map: false, stage: "card" },
  { name: "Tiers", title: "Grail down to common.", caption: "Four tiers, one public vault. You can check every card before you walk.", map: false, stage: "tiers" },
  { name: "Keep", title: "It lands in your wallet.", caption: "Keep it, sell it, or redeem it on Collector Crypt and get the slab shipped.", map: false, stage: "wallet" },
  { name: "Vault", title: "Every trade fills the vault.", caption: "Creator fees from $CQ trading buy the cards that go into the crates.", map: false, stage: "flow" },
  { name: "Play", title: "Your first crate is waiting.", caption: "CardQuest plays on your phone. Scan this to open it there.", map: true, stage: "qr" },
];

function Words({ text }: { text: string }) {
  return <>{text.split(" ").map((w, i) => <span key={i} className="w"><span style={{ animationDelay: `${i * 60}ms` }}>{w}</span></span>)}</>;
}

function Cube({ gold }: { gold?: boolean }) {
  return <span className={gold ? "crate ticket film-crate" : "crate film-crate"}><span className="crate-ring" /><span className="crate-body"><Mark size={40} /></span></span>;
}

function Stage({ stage, p }: { stage: string; p: number }) {
  switch (stage) {
    case "drops":
      return <div className="fs fs-drops">{[[22, 40], [48, 28], [70, 46], [36, 62], [60, 70], [82, 30]].map(([x, y], i) => <span key={i} className="fs-at" style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${0.3 + i * 0.25}s` }}><Cube gold={i === 4} /></span>)}<span className="fs-you" style={{ left: "50%", top: "52%" }} /></div>;
    case "walk": {
      const m = Math.max(0, Math.round(120 * (1 - Math.min(1, p * 1.4))));
      return <div className="fs fs-walk"><span className="fs-at" style={{ left: "64%", top: "38%" }}><Cube /></span><span className={m <= 40 ? "fs-tag in" : "fs-tag"} style={{ left: "64%", top: "30%" }}>{m <= 40 ? "In reach" : `${m} m`}</span><span className="fs-you" style={{ left: `${30 + 30 * Math.min(1, p * 1.4)}%`, top: `${70 - 26 * Math.min(1, p * 1.4)}%` }} /></div>;
    }
    case "burst":
      return <div className="fs fs-burst"><span className="fs-glow" /><span className="fs-rays" /><span className="fs-big"><Mark size={120} /></span></div>;
    case "card":
      return <div className="fs fs-card"><div className="fan"><div className="slab s-common lg back l"><div className="slab-label"><span>PSA 9</span></div><div className="slab-art"><i /></div></div><div className="slab s-uncommon lg back r"><div className="slab-label"><span>CGC 9</span></div><div className="slab-art"><i /></div></div><div className="slab s-rare lg front"><div className="slab-label"><span>PSA 10</span></div><div className="slab-art"><i /></div></div></div><b className="fs-price tc-rare">$280</b><span className="tag">PSA GEM MINT 10</span></div>;
    case "tiers":
      return <div className="fs fs-tiers">{([["grail", "Grail", "$300+", 3], ["rare", "Rare", "$75–$300", 9], ["uncommon", "Uncommon", "$30–$75", 24], ["common", "Common", "Under $30", 61]] as const).map(([k, n, r, c], i) => <div key={k} className={`fs-tier s-${k}`} style={{ animationDelay: `${i * 0.12}s` }}><b className={`tc-${k}`}>{n}</b><small>{r}</small><span>{c}</span></div>)}</div>;
    case "wallet":
      return <div className="fs fs-wallet"><div className="slab s-grail lg"><div className="slab-label"><span>PSA 10</span></div><div className="slab-art"><i /></div></div><span className="fs-arrow" style={{ opacity: Math.min(1, p * 2) }}>→</span><div className="fs-walletbox" style={{ opacity: Math.min(1, p * 2) }}><b>Your wallet</b><span>Received 1 NFT</span></div></div>;
    case "flow":
      return <div className="fs fs-flow"><div className="flow-node"><b>Every $CQ trade</b><span>on pump.fun</span></div><span className="fs-dots" /><div className="flow-tag">creator fee</div><span className="fs-dots" /><div className="flow-node"><b>Treasury</b><span>swapped to USDC</span></div><span className="fs-dots" /><div className="flow-node vault"><b>The vault</b><span>fills the crates</span></div></div>;
    case "qr":
      return <div className="fs fs-qr"><QrCard className="film-qr" /></div>;
    default:
      return null;
  }
}

/** The film: a full-screen scripted reel over a slowly turning 3D map, with chapters like a video. */
export function FilmHost() {
  const [open, setOpen] = useState(false);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(true);
  const mapEl = useRef<HTMLDivElement>(null);
  const city = useCity();
  const total = CHAPTERS.length * CH_MS;

  useEffect(() => {
    const on = () => { setOpen(true); setT(0); setPlaying(true); };
    window.addEventListener("cq:film", on);
    return () => window.removeEventListener("cq:film", on);
  }, []);

  // playback clock
  useEffect(() => {
    if (!open || !playing) return;
    let raf = 0, last = performance.now();
    const tick = (now: number) => {
      setT((x) => { const n = Math.min(total, x + (now - last)); if (n >= total) setPlaying(false); return n; });
      last = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [open, playing, total]);

  // background map: non-interactive, tilted, slowly orbiting the selected city
  useEffect(() => {
    if (!open || !mapEl.current) return;
    const c = cityByName(city);
    const m = new maplibregl.Map({ container: mapEl.current, style: STYLE_URL, center: [c.lng, c.lat], zoom: 15.3, pitch: 60, bearing: -20, interactive: false, attributionControl: false, pixelRatio: Math.min(window.devicePixelRatio || 1, 1.5) });
    let raf = 0;
    const orbit = () => { m.setBearing(m.getBearing() + 0.03); raf = requestAnimationFrame(orbit); };
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) m.once("load", () => { raf = requestAnimationFrame(orbit); });
    return () => { cancelAnimationFrame(raf); m.remove(); };
  }, [open, city]);

  const close = useCallback(() => setOpen(false), []);
  const ch = Math.min(CHAPTERS.length - 1, Math.floor(t / CH_MS));
  const go = useCallback((i: number) => { setT(Math.max(0, Math.min(CHAPTERS.length - 1, i)) * CH_MS); setPlaying(true); }, []);
  const done = t >= total;
  const toggle = useCallback(() => { if (done) { setT(0); setPlaying(true); } else setPlaying((p) => !p); }, [done]);

  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === " ") { e.preventDefault(); toggle(); }
      else if (e.key === "ArrowRight") go(ch + 1);
      else if (e.key === "ArrowLeft") go(ch - 1);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, close, toggle, go, ch]);
  if (!open) return null;

  const c = CHAPTERS[ch];
  const p = (t - ch * CH_MS) / CH_MS;
  return (
    <div className="reel" role="dialog" aria-modal="true" aria-label="How CardQuest works">
      <div className="reel-map" ref={mapEl} aria-hidden="true" />
      <div className="reel-veil" style={{ opacity: c.map ? 0.45 : 0.94 }} />
      <div className="reel-stage" key={`s${ch}`}><Stage stage={c.stage} p={p} /></div>
      <div className="reel-top">
        <div className="reel-chapters">{CHAPTERS.map((x, i) => <button key={x.name} onClick={() => go(i)} aria-label={`Chapter ${i + 1}: ${x.name}`}><i style={{ transform: `scaleX(${Math.max(0, Math.min(1, (t - i * CH_MS) / CH_MS))})` }} /></button>)}</div>
        <button className="reel-close" onClick={close} aria-label="Close">✕</button>
      </div>
      <div className="reel-copy" key={`c${ch}`}>
        <h2 className="film-title"><Words text={c.title} /></h2>
        <p className="film-caption">{c.caption}</p>
        {done && <button className="pill outline" onClick={() => go(0)}>Watch again</button>}
      </div>
      <div className="reel-controls">
        <button onClick={() => go(ch - 1)} aria-label="Previous chapter"><svg width="18" height="18" viewBox="0 0 24 24"><path d="M15 5 8 12l7 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg></button>
        <button className="reel-play" onClick={toggle} aria-label={done ? "Replay" : playing ? "Pause" : "Play"}>{done ? "↻" : playing ? <svg width="18" height="18" viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" /><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" /></svg> : <svg width="18" height="18" viewBox="0 0 24 24"><path d="M7 4v16l13-8z" fill="currentColor" /></svg>}</button>
        <button onClick={() => go(ch + 1)} aria-label="Next chapter"><svg width="18" height="18" viewBox="0 0 24 24"><path d="m9 5 7 7-7 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg></button>
        <span className="reel-where"><b>{c.name}</b><small>{ch + 1} / {CHAPTERS.length}</small></span>
      </div>
    </div>
  );
}
