"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useAuth } from "@/lib/auth/client";
import { haversineM, OPEN_RADIUS_M } from "@/lib/geo";
import { deviceId } from "@/lib/device";
import { SERVICE_CITIES } from "@/lib/cities";
import type { Balances, Crate, OpenResult } from "@/lib/types";
import { setExploring, useExploring, useFullMap } from "@/lib/viewStore";
import { ResultModal } from "./ResultModal";
import { SHARDS_PER_TICKET } from "@/lib/rules";
import { LINKS } from "@/lib/links";
import { useCoin } from "@/lib/useCoin";
import { cityByName, pickCity, useCity } from "@/lib/cityStore";
import { inWalletBrowser, isMobileUA } from "@/lib/auth/phantomDeeplink";
import { QrCard } from "./QrCard";
import { addGlobeArt } from "./globeStyle";
import { ConnectButton } from "./HomePanels";
import { useInWalletBrowser, WalletBrowserNotice } from "./WalletBrowserNotice";
import { CrateGlyph, IconArrowUpRight, IconClose, IconCoin, IconExpand, IconGlobe, IconLocate, Ticket } from "./Icons";

const STYLE_URL = process.env.NEXT_PUBLIC_MAP_STYLE_URL || "https://tiles.openfreemap.org/styles/dark";
const PITCH_3D = 55;
const BEARING_3D = -17;
/** How far out the resting globe sits: big enough to read as a planet, small enough to show its edge. */
const globeZoom = (box?: HTMLElement | null) => {
  // A globe is about 163 * 2^zoom px across; fill roughly 80% of the smaller side of its box.
  const side = box ? Math.min(box.clientWidth, box.clientHeight) : Math.min(window.innerWidth, window.innerHeight);
  return Math.max(0.8, Math.min(3, Math.log2((side * (box && box.clientWidth >= 900 ? 0.86 : 0.8)) / 163)));
};

/** Brand the base map: lighter land on near-black sea so the continents read from space, and no country names on the globe. */
function styleBase(m: maplibregl.Map) {
  const set = (id: string, prop: string, v: unknown) => { if (m.getLayer(id)) m.setPaintProperty(id, prop, v as never); };
  set("background", "background-color", "#2a2a2f");
  set("water", "fill-color", "#070708");
  set("landuse_park", "fill-color", "#222225");
  for (const id of ["boundary_country_z0-4", "boundary_country_z5-"]) set(id, "line-color", "#5a5a62");
  set("boundary_state", "line-color", "#2e2e33");
  for (const id of ["place_country_major", "place_country_minor", "place_country_other", "place_state", "water_name"]) {
    set(id, "text-opacity", ["interpolate", ["linear"], ["zoom"], 0, 0, 4.5, 0, 5.5, 1]);
  }
}
/** Swap the flat building fill for extruded buildings (OpenFreeMap/OpenMapTiles schema). */
function add3dBuildings(m: maplibregl.Map) {
  if (m.getLayer("building-3d")) return;
  const flat = m.getLayer("building") as { source?: string; minzoom?: number } | undefined;
  const source = flat?.source ?? "openmaptiles";
  if (!m.getSource(source)) return;
  if (flat) m.setLayoutProperty("building", "visibility", "none");
  // Lift roads and street names slightly so the neutral dark base stays readable under the extrusions.
  const set = (id: string, prop: string, v: string) => { if (m.getLayer(id)) m.setPaintProperty(id, prop, v); };
  set("highway_minor", "line-color", "#2c2c30");
  set("highway_major_inner", "line-color", "#3a3a40");
  set("highway_major_subtle", "line-color", "#3a3a40");
  set("highway_path", "line-color", "#28282c");
  set("highway_name_other", "text-color", "#8e8e93");
  set("highway_name_motorway", "text-color", "#8e8e93");
  m.addLayer({
    id: "building-3d", type: "fill-extrusion", source, "source-layer": "building", minzoom: 14,
    paint: {
      "fill-extrusion-color": ["interpolate", ["linear"], ["coalesce", ["get", "render_height"], 0], 0, "#141416", 60, "#1b1b1f", 200, "#25252a"],
      "fill-extrusion-height": ["coalesce", ["get", "render_height"], 6],
      "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
      "fill-extrusion-opacity": 0.92,
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
  m.addLayer({ id: "cities-glow", type: "circle", source: "cities", maxzoom: 10, paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 0, 12, 6, 30], "circle-color": "#ff7c01", "circle-opacity": 0.35, "circle-blur": 1 } });
  m.addLayer({ id: "cities-dot", type: "circle", source: "cities", maxzoom: 10, paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 0, 3.5, 6, 6], "circle-color": "#fff", "circle-stroke-color": "#ff7c01", "circle-stroke-width": 2.5 } });
  if (!m.getStyle().glyphs) return;
  m.addLayer({
    id: "cities-label", type: "symbol", source: "cities", minzoom: 1.2, maxzoom: 10,
    layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Bold"], "text-size": 12, "text-offset": [0, 1.25], "text-anchor": "top", "text-letter-spacing": 0.03 },
    paint: { "text-color": "#f5f5f7", "text-halo-color": "#000", "text-halo-width": 1.4 },
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
const PING_EVERY_MS = 15000;
const RING = 2 * Math.PI * 25;

interface Fix { lat: number; lng: number; acc: number }

export default function MapView() {
  const { buyUrl } = useCoin();
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
  // Crates only open from a phone: desktop never asks for location and shows a QR hand-off instead.
  const [desktop, setDesktop] = useState<boolean | null>(null);
  useEffect(() => setDesktop(!isMobileUA(navigator.userAgent, navigator.maxTouchPoints)), []);
  const [crates, setCrates] = useState<Crate[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [result, setResult] = useState<OpenResult | null>(null);
  const walletBrowser = useInWalletBrowser();
  const [tilt, setTilt] = useState(true);
  const [zoomedIn, setZoomedIn] = useState(false);
  const city = useCity();
  const full = useFullMap();
  const exploring = useExploring();
    const [outside, setOutside] = useState<{ name: string; km: number } | null>(null);
  const fixRef = useRef<Fix | null>(null);
  fixRef.current = fix;

  const body = useCallback((f: Fix) => ({ lat: f.lat, lng: f.lng, accuracyM: f.acc, ts: Date.now(), deviceId: deviceId() }), []);

  // map init: starts as a slowly spinning globe with the launch cities lit up, then flies down to the player
  useEffect(() => {
    if (!el.current) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Wallet in-app browsers (Phantom on iOS) render the globe projection stretched vertically, labels and markers included,
    // so they get the flat map instead.
    const flat = inWalletBrowser(window as never, navigator.userAgent, navigator.maxTouchPoints ?? 0);
    let stopArt = () => {};
    const m = new maplibregl.Map({
      container: el.current, style: STYLE_URL, center: [-30, 28], zoom: globeZoom(el.current), pitch: 0, maxPitch: 70,
      // Cap the render resolution so 3x phones stay smooth.
      pixelRatio: Math.min(window.devicePixelRatio || 1, 2), fadeDuration: 150, attributionControl: false,
    });
    m.on("style.load", () => {
      if (!flat) m.setProjection({ type: "globe" });
      if (!flat) m.setSky({ "sky-color": "#121212", "horizon-color": "#ff7c01", "fog-color": "#121212", "sky-horizon-blend": 0.35, "horizon-fog-blend": 0.8, "fog-ground-blend": 0.9, "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 0.5, 5, 0.25, 8, 0] });
      styleBase(m);
      addCityLayers(m);
      stopArt = addGlobeArt(m, reduced);
      // Labels laid flat on the ground smear into tall blurry strips at the 55° street-level tilt (and on the globe),
      // so keep point labels upright facing the screen; road names still follow their roads.
      for (const l of m.getStyle().layers ?? []) {
        if (l.type !== "symbol" || (l.layout as { "symbol-placement"?: string } | undefined)?.["symbol-placement"] === "line") continue;
        m.setLayoutProperty(l.id, "text-pitch-alignment", "viewport");
        m.setLayoutProperty(l.id, "text-rotation-alignment", "viewport");
      }
      try { add3dBuildings(m); } catch { /* flat buildings are fine */ }
    });
    m.on("click", "cities-dot", (e) => {
      const f = e.features?.[0];
      const name = f?.properties?.name;
      if (typeof name === "string") pickCity(name);
    });
    m.on("mouseenter", "cities-dot", () => { m.getCanvas().style.cursor = "pointer"; });
    m.on("mouseleave", "cities-dot", () => { m.getCanvas().style.cursor = ""; });
    m.on("zoomend", () => setZoomedIn(m.getZoom() > 5));

    // Idle spin until someone touches the map or we know where the player is.
    let raf = 0, last = 0;
    const spin = (t: number) => {
      if (spinning.current && visible && !document.hidden && !m.isMoving() && m.getZoom() < 4) m.setCenter([m.getCenter().lng + ((t - (last || t)) / 1000) * 4, m.getCenter().lat]);
      last = t;
      raf = requestAnimationFrame(spin);
    };
    // Don't burn the visitor's GPU on a globe nobody can see.
    let visible = true;
    const io = new IntersectionObserver(([e]) => { visible = !!e?.isIntersecting; }, { threshold: 0.05 });
    io.observe(el.current);
    const stop = () => { spinning.current = false; };
    m.on("mousedown", stop); m.on("touchstart", stop); m.on("wheel", stop);
    if (!reduced) raf = requestAnimationFrame(spin);

    // The globe ignores camera padding, so on phones the map box itself ends just under the top of the pitch and the
    // globe sits centred above it. Street-level views get padding for the header and any card over the map.
    // Measured from the DOM so it follows layout changes.
    const box = el.current;
    let padRaf = 0;
    const pad = () => {
      if (padRaf) return;
      padRaf = requestAnimationFrame(() => {
        padRaf = 0;
        const rect = (q: string) => { const n = document.querySelector<HTMLElement>(q); if (!n) return null; const r = n.getBoundingClientRect(); return r.width ? r : null; };
        const b = box.getBoundingClientRect();
        const top = rect(".topbar");
        const card = rect(".mapwrap .drawer") ?? rect(".mapwrap .map-card");
        const p = {
          left: 0, right: 0,
          top: top ? Math.max(0, Math.round(top.bottom - b.top)) : 0,
          bottom: card ? Math.max(0, Math.round(b.bottom - card.top)) : 0,
        };
        // Never squeeze the visible area below ~40% of the map.
        const k = p.top + p.bottom > b.height * 0.6 ? (b.height * 0.6) / (p.top + p.bottom) : 1;
        const next = { left: 0, right: 0, top: Math.round(p.top * k), bottom: Math.round(p.bottom * k) };
        const cur = m.getPadding();
        if (cur.left === next.left && cur.right === next.right && cur.top === next.top && cur.bottom === next.bottom) return;
        // Changing padding would cancel one of our camera flights, so wait for it to land.
        if (flying.has(m)) { m.once("moveend", pad); return; }
        m.setPadding(next);
      });
    };
    pad();
    m.on("load", pad);
    const ro = new ResizeObserver(() => { m.resize(); pad(); });
    ro.observe(box);
    // Layout changes around the map (pitch, cards, overlays); the map's own markers and controls don't count.
    const mo = new MutationObserver((recs) => { if (recs.some((r) => !box.contains(r.target))) pad(); });
    mo.observe(document.querySelector(".home") ?? document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
    window.addEventListener("resize", pad);
    // In-app wallet browsers (Phantom) grow and shrink their toolbars without always firing a resize on the map box,
    // which leaves the GL buffer a different size from the canvas and stretches the whole map. Re-measure on every
    // viewport change, and once more after it settles.
    const vv = window.visualViewport;
    let settle = 0;
    const remeasure = () => {
      m.resize(); pad();
      window.clearTimeout(settle);
      settle = window.setTimeout(() => { m.resize(); pad(); }, 350);
    };
    vv?.addEventListener("resize", remeasure);
    window.addEventListener("orientationchange", remeasure);
    window.addEventListener("pageshow", remeasure);
    map.current = m;
    return () => {
      stopArt();
      cancelAnimationFrame(raf); cancelAnimationFrame(padRaf); io.disconnect(); window.clearTimeout(settle); ro.disconnect(); mo.disconnect();
      window.removeEventListener("resize", pad); vv?.removeEventListener("resize", remeasure);
      window.removeEventListener("orientationchange", remeasure); window.removeEventListener("pageshow", remeasure);
      m.remove(); map.current = null;
    };
  }, []);

  // The home page never scrolls, so the map always takes drags, pinches and the wheel: zoom into the globe right behind the pitch.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    for (const h of [m.scrollZoom, m.dragPan, m.touchZoomRotate, m.touchPitch]) h.enable();
  }, []);

  // live location
  useEffect(() => {
    if (desktop !== false) return; // unknown yet, or a desktop: never ask for location
    if (!navigator.geolocation) { setGeoErr("Location isn't available in this browser."); return; }
    const id = navigator.geolocation.watchPosition(
      (p) => { setGeoErr(null); setFix({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }); },
      (e) => setGeoErr(e.code === e.PERMISSION_DENIED ? "Turn on location to see crates near you." : "Can't get your location right now."),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [desktop]);

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

  // A picked city (headline picker, globe dot, "not live here" chips) always flies there, even for a located player; recenter brings them back.
  useEffect(() => {
    const on = (e: Event) => {
      const m = map.current;
      if (!m) return;
      spinning.current = false;
      setSel(null);
      flyToCity(m, cityByName((e as CustomEvent<string>).detail));
    };
    window.addEventListener("cq:city", on);
    return () => window.removeEventListener("cq:city", on);
  }, []);

  // Light up the selected city on the globe.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const paint = () => {
      if (!m.getLayer("cities-dot")) return;
      const isSel = ["==", ["get", "name"], city] as maplibregl.ExpressionSpecification;
      m.setPaintProperty("cities-dot", "circle-color", ["case", isSel, "#ff7c01", "#ffffff"]);
      m.setPaintProperty("cities-dot", "circle-stroke-color", ["case", isSel, "#ffffff", "#ff7c01"]);
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

  // Mark the selected crate on the map.
  useEffect(() => { for (const [id, mk] of markers.current) mk.getElement().classList.toggle("on", id === sel); }, [sel, crates]);

  const target = crates.find((c) => c.id === sel) ?? null;
  const dist = target && fix ? haversineM(target, fix) : null;
  // UI hint only; the server re-checks distance and decides.
  const near = dist !== null && dist <= OPEN_RADIUS_M;
  const canOpen = !!target?.welcome || balances?.opensLeft !== 0; // the welcome crate costs no open
  // UI hint only; the server re-reads the chain and decides. Shown up front so nobody walks to a
  // crate they can't open yet.
  const hold = balances?.coinHold?.gate === "on" ? balances.coinHold : null;
  const needsCoin = !!hold && !hold.qualified;
  const reach = dist === null ? 0 : near ? 1 : Math.max(0.06, Math.min(1, OPEN_RADIUS_M / dist));

  const open = async () => {
    if (!target || !fix || opening) return;
    setOpening(true);
    try {
      const r = await fetch("/api/crates/open", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ crateId: target.id, ...body(fix) }) });
      const j = (await r.json().catch(() => ({}))) as { result?: OpenResult; balances?: Balances };
      if (j.result) {
        setResult(j.result);
        if (j.balances) setBalances(j.balances);
        // "taken" means somebody else opened it: drop it from the map. "daily_limit" leaves it there.
        if (j.result.kind !== "rejected" || ["taken", "already_opened", "expired", "not_found"].includes(j.result.code)) {
          setCrates((cs) => cs.filter((c) => c.id !== target.id));
          setSel(null);
        }
      } else setResult({ kind: "rejected", code: "invalid_input", message: "Something went wrong." });
    } finally { setOpening(false); }
  };

  const recenter = () => { if (fix) map.current?.easeTo({ center: [fix.lng, fix.lat], zoom: 17, pitch: tilt ? PITCH_3D : 0 }); };
  const toggleTilt = () => {
    const next = !tilt;
    setTilt(next);
    map.current?.easeTo({ pitch: next ? PITCH_3D : 0, bearing: next ? map.current.getBearing() : 0, duration: 600 });
  };
  const toGlobe = () => {
    const m = map.current;
    if (!m) return;
    setSel(null);
    fly(m, { center: [m.getCenter().lng, 25], zoom: globeZoom(el.current), pitch: 0, bearing: 0, duration: 2600, curve: 1.4, essential: true });
    m.once("moveend", () => { spinning.current = true; });
  };

  return (
    <div className="mapwrap">
      <div ref={el} className="map" onClick={() => setSel(null)} />

      <div className="map-ctl">
        {zoomedIn && (!full || exploring) && <button className="map-pill" onClick={toGlobe}><IconGlobe size={16} />Globe</button>}
        {(full || fix) && (
          <div className="map-stack">
            <button className={tilt ? "on" : ""} onClick={toggleTilt} aria-label="Toggle 3D view" aria-pressed={tilt}>3D</button>
            <button onClick={recenter} aria-label="Center on me" disabled={!fix}><IconLocate size={18} /></button>
          </div>
        )}
      </div>
      {(full || zoomedIn) && (
        <div className="map-legend" aria-label="Map legend">
          <p className="legend-city"><span className="legend-dot city" />{city}</p>
          <p><span className="legend-dot crate" />Crate available</p>
          <p><span className="legend-dot ticket" />Ticket crate</p>
          <p><span className="legend-dot you" />You</p>
        </div>
      )}
      {exploring && !user && !loading && (
        <div className="map-card"><p className="map-card-line">Connect a wallet to see crates near you and open them.</p><ConnectButton className="btn wide" /></div>
      )}
      {exploring && <button className="map-close" onClick={() => setExploring(false)} aria-label="Close the map"><IconClose size={16} />Close map</button>}
      {/* Tickets are spent by opening, not by a button: the next open after the free one uses one. */}
      {balances && balances.tickets > 0 && <div className="ticket-fab" role="status"><Ticket size={18} />{balances.tickets} extra {balances.tickets === 1 ? "open" : "opens"}</div>}

      {user && desktop === true && !fix && <div className="map-card"><QrCard className="qr-card" /></div>}
      {user && desktop === false && geoErr && !(user.isAdmin && !fix) && <div className="map-card"><p className="map-card-line">{geoErr}</p></div>}
      {user && desktop === false && !fix && (
        <div className="map-card">
          {walletBrowser ? <WalletBrowserNotice /> : !geoErr && <p className="map-card-line"><span className="spinner" />Finding you…</p>}
          {user.isAdmin && (
            <button className="btn btn-gray wide" onClick={() => {
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
        <div className="map-card away">
          <p className="map-card-kicker">Not live here yet</p>
          <h2>No crates in your area yet.</h2>
          <p>CardQuest is launching city by city. Crates are dropping in {SERVICE_CITIES.length} cities right now, and the closest to you is <b>{outside.name}</b>, about {outside.km.toLocaleString("en-US")} km away. More cities open as the vault grows.</p>
          <div className="chips">{SERVICE_CITIES.map((c) => <button key={c.name} className={c.name === outside.name ? "chip on" : "chip"} onClick={() => map.current && flyToCity(map.current, c)}>{c.name}</button>)}</div>
        </div>
      )}
      {user && fix && !outside && crates.length === 0 && !target && <div className="map-toast"><span className="spinner" />Looking for crates nearby…</div>}

      {target && (
        <div className={near ? "drawer near" : "drawer"}>
          <div className="drawer-row">
            <div className="reach" aria-hidden="true">
              <svg viewBox="0 0 56 56"><circle cx="28" cy="28" r="25" className="reach-track" /><circle cx="28" cy="28" r="25" className="reach-fill" style={{ strokeDasharray: RING, strokeDashoffset: RING * (1 - reach) }} /></svg>
              <CrateGlyph size={30} gold={target.kind === "ticket"} />
            </div>
            <div className="grow">
              <strong>{target.welcome ? "Welcome crate" : target.kind === "ticket" ? "Ticket crate" : "Street crate"}</strong>
              <p className={near && canOpen && !needsCoin ? "drawer-sub ok" : "drawer-sub"}>{dist === null ? "Finding you…" : !near ? `${Math.round(dist)} m away · get within ${OPEN_RADIUS_M} m` : needsCoin || canOpen ? "You're in range" : `You've used all ${balances?.freeOpensPerDay ?? 0} of today's opens. ${balances?.shardsPerTicket ?? 0} shards make a ticket.`}</p>
            </div>
            <button className="icon-btn" onClick={() => setSel(null)} aria-label="Close"><IconClose size={16} /></button>
          </div>
          {hold && needsCoin && (
            <p className="drawer-hold"><IconCoin size={18} />{hold.lockedOut
              ? `Your balance dropped below $${hold.requiredUsd}. ${hold.windowEndsAt ? `Opening resumes ${new Date(hold.windowEndsAt).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}.` : "Opening resumes when this window ends."}`
              : `Hold $${hold.requiredUsd} of ${LINKS.ticker} to open crates.`}</p>
          )}
          {near && hold && needsCoin && !hold.lockedOut ? (
            // Nothing to tap for an open here, so the button becomes the way to fix it.
            <a className="btn btn-lg wide" href={buyUrl} target="_blank" rel="noopener noreferrer">Get ${hold.requiredUsd} of {LINKS.ticker}<IconArrowUpRight size={16} /></a>
          ) : (
            <button className={near && canOpen && !needsCoin ? "btn btn-lg wide" : "btn btn-lg btn-gray wide"} disabled={!near || opening || !canOpen || needsCoin} onClick={() => void open()}>
              {opening ? "Opening…"
                : !near ? "Walk closer"
                : needsCoin ? "Opening paused"
                : !canOpen ? "Come back tomorrow"
                : balances?.nextOpenCostsTicket && !target.welcome ? <><Ticket size={18} />Open with a ticket</>
                : "Open crate"}
            </button>
          )}
        </div>
      )}
      {result && <ResultModal result={result} onClose={() => setResult(null)} shardsPerTicket={balances?.shardsPerTicket ?? SHARDS_PER_TICKET} />}
    </div>
  );
}
