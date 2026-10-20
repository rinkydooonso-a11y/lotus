"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useAuth } from "@/lib/auth/client";
import { haversineM, OPEN_RADIUS_M } from "@/lib/geo";
import { deviceId } from "@/lib/device";
import { SERVICE_CITIES } from "@/lib/cities";
import type { Crate, OpenResult } from "@/lib/types";
import { ResultModal } from "./ResultModal";
import { ConnectSheet } from "./ConnectSheet";
import { CitySwap } from "./CitySwap";
import { CaChip, XButton } from "./CaChip";
import { Mark } from "./Logo";
import { cityByName, pickCity, useCity } from "@/lib/cityStore";
import { openFilm } from "./Film";
import { useInWalletBrowser, WalletBrowserNotice } from "./WalletBrowserNotice";

const STYLE_URL = process.env.NEXT_PUBLIC_MAP_STYLE_URL || "https://tiles.openfreemap.org/styles/dark";
const PITCH_3D = 55;
const BEARING_3D = -17;

/** Swap the flat building fill for extruded buildings (OpenFreeMap/OpenMapTiles schema). */
function add3dBuildings(m: maplibregl.Map) {
  if (m.getLayer("building-3d")) return;
  const flat = m.getLayer("building") as { source?: string; minzoom?: number } | undefined;
  const source = flat?.source ?? "openmaptiles";
  if (!m.getSource(source)) return;
  if (flat) m.setLayoutProperty("building", "visibility", "none");
  // Lift roads and street names slightly so the neutral dark base stays readable under the extrusions.
  const set = (id: string, prop: string, v: string) => { if (m.getLayer(id)) m.setPaintProperty(id, prop, v); };
  set("highway_minor", "line-color", "#2e2e31");
  set("highway_major_inner", "line-color", "#3a3a3d");
  set("highway_major_subtle", "line-color", "#3a3a3d");
  set("highway_path", "line-color", "#2a2a2d");
  set("highway_name_other", "text-color", "#8a8a8e");
  set("highway_name_motorway", "text-color", "#8a8a8e");
  m.addLayer({
    id: "building-3d", type: "fill-extrusion", source, "source-layer": "building", minzoom: 14,
    paint: {
      "fill-extrusion-color": ["interpolate", ["linear"], ["coalesce", ["get", "render_height"], 0], 0, "#151516", 60, "#1c1c1e", 200, "#262628"],
      "fill-extrusion-height": ["coalesce", ["get", "render_height"], 6],
      "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
      "fill-extrusion-opacity": 0.9,
    },
  });
}
/** Glowing launch-city dots and labels, drawn on the GPU so the spinning globe stays smooth. Hidden once zoomed into streets. */
function addCityLayers(m: maplibregl.Map) {
  if (m.getSource("cities")) return;
  m.addSource("cities", {
    type: "geojson",
    data: { type: "FeatureCollection", features: SERVICE_CITIES.map((c) => ({ type: "Feature", properties: { name: c.name }, geometry: { type: "Point", coordinates: [c.lng, c.lat] } })) },
  });
  m.addLayer({ id: "cities-glow", type: "circle", source: "cities", maxzoom: 10, paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 0, 10, 6, 28], "circle-color": "#a463ff", "circle-opacity": 0.35, "circle-blur": 1 } });
  m.addLayer({ id: "cities-dot", type: "circle", source: "cities", maxzoom: 10, paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 0, 3.5, 6, 6], "circle-color": "#fff", "circle-stroke-color": "#a463ff", "circle-stroke-width": 2.5 } });
  if (!m.getStyle().glyphs) return;
  m.addLayer({
    id: "cities-label", type: "symbol", source: "cities", minzoom: 1.2, maxzoom: 10,
    layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Bold"], "text-size": 13, "text-offset": [0, 1.3], "text-anchor": "top", "text-letter-spacing": 0.04 },
    paint: { "text-color": "#f5f4f8", "text-halo-color": "#0b0b0d", "text-halo-width": 1.6 },
  });
}
/** Maps currently running one of our camera flights (padding updates wait for these). */
const flying = new WeakMap<maplibregl.Map, object>();
function fly(m: maplibregl.Map, opts: maplibregl.FlyToOptions) {
  const id = {};
  // Start first: flyTo stops any running flight, and that flight's moveend must not clear this one.
  m.flyTo(opts);
  flying.set(m, id);
  m.once("moveend", () => { if (flying.get(m) === id) flying.delete(m); });
}
function flyToCity(m: maplibregl.Map, c: { lat: number; lng: number }) {
  fly(m, { center: [c.lng, c.lat], zoom: 14.6, pitch: PITCH_3D, bearing: BEARING_3D, duration: 3600, curve: 1.6, essential: true });
}
/** Isometric crate marker; colours come from CSS (purple, or gold for ticket crates). */
const CRATE_SVG = `<svg viewBox="0 0 48 48" aria-hidden="true"><path class="lid" d="M24 4 43 14.5 24 25 5 14.5z"/><path class="l" d="M5 14.5 24 25v19L5 33.5z"/><path class="r" d="M43 14.5 24 25v19l19-10.5z"/><path class="band" d="M14 9.3 33 19.8v4.4L14 13.7z"/><path class="band" d="M22.6 24.2 24 25l1.4-.8v19l-1.4.8-1.4-.8z"/></svg>`;
const PING_EVERY_MS = 5000;

interface Fix { lat: number; lng: number; acc: number }

export default function MapView() {
  const { user, balances, setBalances, loading } = useAuth();
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const me = useRef<maplibregl.Marker | null>(null);
  const markers = useRef<Map<string, maplibregl.Marker>>(new Map());
  const centered = useRef(false);
  const spinning = useRef(true);
  const lastPing = useRef(0);
  const [fix, setFix] = useState<Fix | null>(null);
  const [geoErr, setGeoErr] = useState<string | null>(null);
  const [crates, setCrates] = useState<Crate[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [result, setResult] = useState<OpenResult | null>(null);
  const [connect, setConnect] = useState(false);
  const walletBrowser = useInWalletBrowser();
  const [tilt, setTilt] = useState(true);
  const city = useCity();
  const flewToCity = useRef(false);
  const chips = useRef<HTMLDivElement>(null);
  const [outside, setOutside] = useState<{ name: string; km: number } | null>(null);
  const fixRef = useRef<Fix | null>(null);
  fixRef.current = fix;

  const body = useCallback((f: Fix) => ({ lat: f.lat, lng: f.lng, accuracyM: f.acc, ts: Date.now(), deviceId: deviceId() }), []);

  // map init: starts as a slowly spinning globe with the launch cities lit up, then flies down to the player
  useEffect(() => {
    if (!el.current) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const m = new maplibregl.Map({
      container: el.current, style: STYLE_URL, center: [-30, 30], zoom: window.innerWidth < 640 ? 0.55 : 1.6, pitch: 0, maxPitch: 70,
      // Cap the render resolution so 3x phones stay smooth.
      pixelRatio: Math.min(window.devicePixelRatio || 1, 2), fadeDuration: 150, attributionControl: { compact: true },
    });
    m.on("style.load", () => {
      m.setProjection({ type: "globe" });
      m.setSky({ "sky-color": "#0b0b0d", "horizon-color": "#3a1d6e", "fog-color": "#0b0b0d", "sky-horizon-blend": 0.6, "horizon-fog-blend": 0.8, "fog-ground-blend": 0.9, "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 0.45, 5, 0.25, 8, 0] });
      addCityLayers(m);
      try { add3dBuildings(m); } catch { /* flat buildings are fine */ }
    });
    m.on("click", "cities-dot", (e) => {
      const f = e.features?.[0];
      const name = f?.properties?.name;
      if (typeof name === "string") pickCity(name);
    });
    m.on("mouseenter", "cities-dot", () => { m.getCanvas().style.cursor = "pointer"; });
    m.on("mouseleave", "cities-dot", () => { m.getCanvas().style.cursor = ""; });

    // Idle spin until someone touches the map or we know where the player is.
    let raf = 0, last = 0;
    const spin = (t: number) => {
      if (spinning.current && !m.isMoving() && m.getZoom() < 4) m.setCenter([m.getCenter().lng + ((t - (last || t)) / 1000) * 5, m.getCenter().lat]);
      last = t;
      raf = requestAnimationFrame(spin);
    };
    const stop = () => { spinning.current = false; };
    m.on("mousedown", stop); m.on("touchstart", stop); m.on("wheel", stop);
    if (!reduced) raf = requestAnimationFrame(spin);

    // Centre the globe (and later the player or city) in the open part of the screen: between the desktop panels,
    // below the header and above the city bar; on phones, above the intro card. Measured from the DOM so it follows layout changes.
    const box = el.current;
    let padRaf = 0;
    const pad = () => {
      if (padRaf) return;
      padRaf = requestAnimationFrame(() => {
        padRaf = 0;
        const W = window.innerWidth, H = window.innerHeight;
        const vis = (q: string) => { const n = document.querySelector<HTMLElement>(q); if (!n) return null; const r = n.getBoundingClientRect(); return r.width && !n.closest(".exploring") ? r : null; };
        const l = vis(".desk-left"), r = vis(".desk-side"), b = vis(".desk-bottom"), top = vis(".desk-top") ?? vis(".hud"), intro = vis(".intro-card") ?? vis(".mapwrap .cta") ?? vis(".mapwrap .drawer");
        // The globe ignores camera padding, so on phones end the map just under the top of the intro card instead;
        // the globe then sits centred in the space above it. Full height again once the card goes away.
        const cut = W < 900 && intro ? `${Math.max(0, Math.round(H - intro.top - 40))}px` : "";
        if (box.style.bottom !== cut) { box.style.bottom = cut; m.resize(); }
        const p = {
          left: l ? Math.round(l.right) : 0,
          right: r ? Math.round(W - r.left) : 0,
          top: top ? Math.round(Math.min(top.bottom, H * 0.2)) : 0,
          bottom: Math.round(Math.max(b ? H - b.top : 0, intro && W < 900 && !cut ? H - intro.top : 0)),
        };
        // Never squeeze the visible area below ~40% of the screen.
        const shrink = (a: number, c: number, total: number) => (a + c > total * 0.6 ? (total * 0.6) / (a + c) : 1);
        const kx = shrink(p.left, p.right, W), ky = shrink(p.top, p.bottom, H);
        const next = { left: Math.round(p.left * kx), right: Math.round(p.right * kx), top: Math.round(p.top * ky), bottom: Math.round(p.bottom * ky) };
        const cur = m.getPadding();
        if (cur.left === next.left && cur.right === next.right && cur.top === next.top && cur.bottom === next.bottom) return;
        // Changing padding would cancel one of our camera flights, so wait for it to land.
        if (flying.has(m)) { m.once("moveend", pad); return; }
        m.setPadding(next);
      });
    };
    pad();
    m.on("load", pad);
    const ro = new ResizeObserver(pad);
    ro.observe(box);
    // Layout changes around the map (panels, intro card, overlays); the map's own markers and controls don't count.
    const mo = new MutationObserver((recs) => { if (recs.some((r) => !box.contains(r.target))) pad(); });
    mo.observe(document.querySelector(".home") ?? document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
    window.addEventListener("resize", pad);
    map.current = m;
    return () => { cancelAnimationFrame(raf); cancelAnimationFrame(padRaf); ro.disconnect(); mo.disconnect(); window.removeEventListener("resize", pad); m.remove(); map.current = null; };
  }, []);

  // live location
  useEffect(() => {
    if (!navigator.geolocation) { setGeoErr("Location isn't available in this browser."); return; }
    const id = navigator.geolocation.watchPosition(
      (p) => { setGeoErr(null); setFix({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }); },
      (e) => setGeoErr(e.code === e.PERMISSION_DENIED ? "Turn on location to see crates near you." : "Can't get your location right now."),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  // player marker + first centering
  useEffect(() => {
    const m = map.current;
    if (!m || !fix) return;
    if (!me.current) {
      const d = document.createElement("div");
      d.className = "me";
      d.innerHTML = "<i></i><b></b>";
      me.current = new maplibregl.Marker({ element: d }).setLngLat([fix.lng, fix.lat]).addTo(m);
    } else me.current.setLngLat([fix.lng, fix.lat]);
    if (!centered.current) {
      centered.current = true;
      spinning.current = false;
      const cam = { center: [fix.lng, fix.lat] as [number, number], zoom: 17, pitch: PITCH_3D, bearing: BEARING_3D };
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) m.jumpTo(cam);
      else fly(m, { ...cam, duration: 4000, curve: 1.7, essential: true });
    }
  }, [fix]);

  // Desktop spectators: after a short globe intro, fly into their nearest launch city.
  useEffect(() => {
    const m = map.current;
    if (!m || flewToCity.current || centered.current || window.innerWidth < 900) return;
    const t = setTimeout(() => { if (flewToCity.current || centered.current) return; flewToCity.current = true; spinning.current = false; flyToCity(m, cityByName(city)); }, 2600);
    return () => clearTimeout(t);
  }, [city]);

  // A picked city (city bar, globe dot, phone chips) always flies there, even for a located player; recenter brings them back.
  useEffect(() => {
    const on = (e: Event) => {
      const m = map.current;
      if (!m) return;
      flewToCity.current = true;
      spinning.current = false;
      setSel(null);
      flyToCity(m, cityByName((e as CustomEvent<string>).detail));
    };
    window.addEventListener("cq:city", on);
    return () => window.removeEventListener("cq:city", on);
  }, []);

  useEffect(() => { chips.current?.querySelector(".on")?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" }); }, [city]);

  // Light up the selected city on the globe.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const paint = () => {
      if (!m.getLayer("cities-dot")) return;
      const isSel = ["==", ["get", "name"], city] as maplibregl.ExpressionSpecification;
      m.setPaintProperty("cities-dot", "circle-color", ["case", isSel, "#a066ff", "#ffffff"]);
      m.setPaintProperty("cities-dot", "circle-stroke-color", ["case", isSel, "#ffffff", "#a066ff"]);
      m.setPaintProperty("cities-dot", "circle-radius", ["interpolate", ["linear"], ["zoom"], 0, ["case", isSel, 5.5, 3.5], 6, ["case", isSel, 9, 6]]);
      m.setPaintProperty("cities-glow", "circle-opacity", ["case", isSel, 0.7, 0.3]);
    };
    if (m.isStyleLoaded() && m.getLayer("cities-dot")) paint(); else m.once("idle", paint);
  }, [city]);

  // throttled crate fetch (also acts as the location ping)
  useEffect(() => {
    if (!fix || !user) return;
    const now = Date.now();
    if (now - lastPing.current < PING_EVERY_MS) return;
    lastPing.current = now;
    void fetch("/api/crates", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body(fix)) })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { crates: Crate[]; outside?: boolean; nearest?: { name: string; km: number } } | null) => { if (j) { setCrates(j.crates); setOutside(j.outside && j.nearest ? j.nearest : null); } })
      .catch(() => undefined);
  }, [fix, user, body]);

  // crate markers
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const live = new Set(crates.map((c) => c.id));
    for (const [id, mk] of markers.current) if (!live.has(id)) { mk.remove(); markers.current.delete(id); }
    for (const c of crates) {
      let mk = markers.current.get(c.id);
      if (!mk) {
        const d = document.createElement("button");
        d.className = "crate" + (c.kind === "ticket" ? " ticket" : "");
        d.setAttribute("aria-label", c.kind === "ticket" ? "Ticket crate" : "Crate");
        d.style.setProperty("--pop-delay", `${(markers.current.size % 8) * 70}ms`);
        d.innerHTML = `<span class="crate-ring"></span><span class="crate-body">${CRATE_SVG}</span>`;
        d.onclick = (e) => { e.stopPropagation(); setSel(c.id); };
        mk = new maplibregl.Marker({ element: d, anchor: "bottom", pitchAlignment: "viewport", rotationAlignment: "viewport" }).setLngLat([c.lng, c.lat]).addTo(m);
        markers.current.set(c.id, mk);
      }
    }
  }, [crates]);

  const target = crates.find((c) => c.id === sel) ?? null;
  const dist = target && fix ? haversineM(target, fix) : null;
  // UI hint only; the server re-checks distance and decides.
  const near = dist !== null && dist <= OPEN_RADIUS_M;

  const open = async () => {
    if (!target || !fix || opening) return;
    setOpening(true);
    try {
      const r = await fetch("/api/crates/open", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ crateId: target.id, ...body(fix) }) });
      const j = (await r.json().catch(() => ({}))) as { result?: OpenResult; balances?: { shards: number; tickets: number } };
      if (j.result) {
        setResult(j.result);
        if (j.balances) setBalances(j.balances);
        if (j.result.kind !== "rejected" || ["already_opened", "expired", "not_found"].includes(j.result.code)) {
          setCrates((cs) => cs.filter((c) => c.id !== target.id));
          setSel(null);
        }
      } else setResult({ kind: "rejected", code: "invalid_input", message: "Something went wrong." });
    } finally { setOpening(false); }
  };

  const useTicket = async () => {
    if (!fix) return;
    const r = await fetch("/api/crates/ticket", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body(fix)) });
    const j = (await r.json()) as { ok: boolean; crate?: Crate; tickets?: number };
    if (j.ok && j.crate) {
      setCrates((cs) => [...cs, j.crate!]);
      setSel(j.crate.id);
      if (balances && j.tickets !== undefined) setBalances({ ...balances, tickets: j.tickets });
    }
  };

  const recenter = () => { if (fix) map.current?.easeTo({ center: [fix.lng, fix.lat], zoom: 17, pitch: tilt ? PITCH_3D : 0 }); };
  const toggleTilt = () => {
    const next = !tilt;
    setTilt(next);
    map.current?.easeTo({ pitch: next ? PITCH_3D : 0, bearing: next ? map.current.getBearing() : 0, duration: 600 });
  };

  return (
    <div className="mapwrap">
      <div ref={el} className="map" onClick={() => setSel(null)} />
      <div className="mapctl">
        <button className={tilt ? "on" : ""} onClick={toggleTilt} aria-label="Toggle 3D view">3D</button>
        <button onClick={recenter} aria-label="Center on me" disabled={!fix}>⌖</button>
      </div>
      {balances && balances.tickets > 0 && <button className="fab ticketfab" onClick={() => void useTicket()}>🎟 Use ticket</button>}

      {!user && !loading && (
        walletBrowser ? <div className="cta"><WalletBrowserNotice /></div> : (
          <div className="intro">
            <div className="intro-card">
              <Mark size={44} />
              <h1>Graded cards are dropping in <CitySwap /></h1>
              <div className="intro-cities" role="list" aria-label="Launch cities" ref={chips}>{SERVICE_CITIES.map((c) => <button key={c.name} role="listitem" className={c.name === city ? "on" : ""} aria-current={c.name === city ? "true" : undefined} onClick={() => pickCity(c.name)}>{c.name}</button>)}</div>
              <p>Walk to a crate on the map, open it on your phone, and a real graded card could be yours.</p>
              <button className="pill primary wide" onClick={() => setConnect(true)}>Connect wallet to play</button>
              <button className="intro-link" onClick={openFilm}>How it works</button>
              <div className="intro-foot"><CaChip full /><XButton /></div>
            </div>
          </div>
        )
      )}
      {user && geoErr && !(user.isAdmin && !fix) && <div className="cta"><p className="muted">{geoErr}</p></div>}
      {user && !fix && (
        <div className="cta">
          {walletBrowser ? <WalletBrowserNotice /> : !geoErr && <p className="muted">Finding you…</p>}
          {user.isAdmin && (
            <button className="btn" onClick={() => {
              // Admin-only testing aid for in-app wallet browsers that never answer the location prompt.
              // The server still applies its normal anti-cheat checks to whatever position is sent.
              const v = window.prompt("Test location as lat,lng", "40.0821,-74.2097");
              const [lat, lng] = (v ?? "").split(",").map((x) => Number(x.trim()));
              if (Number.isFinite(lat) && Number.isFinite(lng)) setFix({ lat, lng, acc: 10 });
            }}>Use test location (admin)</button>
          )}
        </div>
      )}
      {user && fix && outside && crates.length === 0 && (
        <div className="cta away">
          <p className="eyebrow">Not live here yet</p>
          <h2>No crates in your area <em>yet.</em></h2>
          <p className="muted">CardQuest is launching city by city. Crates are dropping in {SERVICE_CITIES.length} cities right now, and the closest to you is <b>{outside.name}</b>, about {outside.km.toLocaleString("en-US")} km away. More cities open as the vault grows.</p>
          <div className="city-chips">{SERVICE_CITIES.map((c) => <button key={c.name} className={c.name === outside.name ? "on" : ""} onClick={() => map.current && flyToCity(map.current, c)}>{c.name}</button>)}</div>
        </div>
      )}
      {user && fix && !outside && crates.length === 0 && !target && <div className="toast">Looking for crates nearby…</div>}

      {target && (
        <div className="drawer">
          <div className="dline">
            <div className={`crate-lg${target.kind === "ticket" ? " ticket" : ""}`}>{target.kind === "ticket" ? "🎟" : "🎁"}</div>
            <div className="grow">
              <strong>{target.kind === "ticket" ? "Ticket crate" : "Street crate"}</strong>
              <div className="muted small">{dist === null ? "…" : near ? "You're in range" : `${Math.round(dist)} m away · get within ${OPEN_RADIUS_M} m`}</div>
            </div>
            <button className="x" onClick={() => setSel(null)} aria-label="Close">✕</button>
          </div>
          <button className="btn wide" disabled={!near || opening} onClick={() => void open()}>{opening ? "Opening…" : near ? "Open crate" : "Walk closer"}</button>
        </div>
      )}
      {result && <ResultModal result={result} onClose={() => setResult(null)} />}
      {connect && <ConnectSheet onClose={() => setConnect(false)} />}
    </div>
  );
}
