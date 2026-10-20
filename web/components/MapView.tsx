"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useAuth } from "@/lib/auth/client";
import { haversineM, OPEN_RADIUS_M } from "@/lib/geo";
import { deviceId } from "@/lib/device";
import type { Crate, OpenResult } from "@/lib/types";
import { ResultModal } from "./ResultModal";
import { ConnectSheet } from "./ConnectSheet";
import { useInWalletBrowser, WalletBrowserNotice } from "./WalletBrowserNotice";

const STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: { osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, maxzoom: 19, attribution: "© OpenStreetMap contributors" } },
  layers: [{ id: "osm", type: "raster", source: "osm", paint: { "raster-saturation": -0.5, "raster-brightness-max": 0.85 } }],
};
const PING_EVERY_MS = 15000;

interface Fix { lat: number; lng: number; acc: number }

export default function MapView() {
  const { user, balances, setBalances, loading } = useAuth();
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const me = useRef<maplibregl.Marker | null>(null);
  const markers = useRef<Map<string, maplibregl.Marker>>(new Map());
  const centered = useRef(false);
  const lastPing = useRef(0);
  const [fix, setFix] = useState<Fix | null>(null);
  const [geoErr, setGeoErr] = useState<string | null>(null);
  const [crates, setCrates] = useState<Crate[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [result, setResult] = useState<OpenResult | null>(null);
  const [connect, setConnect] = useState(false);
  const walletBrowser = useInWalletBrowser();
  const fixRef = useRef<Fix | null>(null);
  fixRef.current = fix;

  const body = useCallback((f: Fix) => ({ lat: f.lat, lng: f.lng, accuracyM: f.acc, ts: Date.now(), deviceId: deviceId() }), []);

  // map init
  useEffect(() => {
    if (!el.current) return;
    const m = new maplibregl.Map({ container: el.current, style: STYLE, center: [-6.26, 53.35], zoom: 15, attributionControl: { compact: true } });
    map.current = m;
    return () => { m.remove(); map.current = null; };
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
      me.current = new maplibregl.Marker({ element: d }).setLngLat([fix.lng, fix.lat]).addTo(m);
    } else me.current.setLngLat([fix.lng, fix.lat]);
    if (!centered.current) { centered.current = true; m.jumpTo({ center: [fix.lng, fix.lat], zoom: 17 }); }
  }, [fix]);

  // throttled crate fetch (also acts as the location ping)
  useEffect(() => {
    if (!fix || !user) return;
    const now = Date.now();
    if (now - lastPing.current < PING_EVERY_MS) return;
    lastPing.current = now;
    void fetch("/api/crates", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body(fix)) })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { crates: Crate[] } | null) => { if (j) setCrates(j.crates); })
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
        d.setAttribute("aria-label", "Crate");
        d.textContent = c.kind === "ticket" ? "🎟" : "🎁";
        d.onclick = (e) => { e.stopPropagation(); setSel(c.id); };
        mk = new maplibregl.Marker({ element: d }).setLngLat([c.lng, c.lat]).addTo(m);
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

  const recenter = () => { if (fix) map.current?.easeTo({ center: [fix.lng, fix.lat], zoom: 17 }); };

  return (
    <div className="mapwrap">
      <div ref={el} className="map" onClick={() => setSel(null)} />
      <button className="fab" onClick={recenter} aria-label="Center on me">⌖</button>
      {balances && balances.tickets > 0 && <button className="fab ticketfab" onClick={() => void useTicket()}>🎟 Use ticket</button>}

      {!user && !loading && (
        <div className="cta">
          <h2>Hunt real cards.</h2>
          <p className="muted">Walk to crates near you. Open them for a shot at graded trading cards.</p>
          {walletBrowser ? <WalletBrowserNotice /> : <button className="btn" onClick={() => setConnect(true)}>Connect wallet to play</button>}
        </div>
      )}
      {user && geoErr && !(user.isAdmin && !fix) && <div className="cta"><p>{geoErr}</p></div>}
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
      {user && fix && crates.length === 0 && !target && <div className="toast">Looking for crates nearby…</div>}

      {target && (
        <div className="drawer">
          <div className="dline">
            <div className="crate-lg">{target.kind === "ticket" ? "🎟" : "🎁"}</div>
            <div>
              <strong>{target.kind === "ticket" ? "Ticket crate" : "Crate"}</strong>
              <div className="muted small">{dist === null ? "…" : near ? "You're in range" : `${Math.round(dist)} m away · get within ${OPEN_RADIUS_M} m`}</div>
            </div>
          </div>
          <button className="btn wide" disabled={!near || opening} onClick={() => void open()}>{opening ? "Opening…" : near ? "Open crate" : "Walk closer"}</button>
        </div>
      )}
      {result && <ResultModal result={result} onClose={() => setResult(null)} />}
      {connect && <ConnectSheet onClose={() => setConnect(false)} />}
    </div>
  );
}
