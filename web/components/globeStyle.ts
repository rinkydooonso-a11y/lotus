import type maplibregl from "maplibre-gl";
import { SERVICE_CITIES } from "@/lib/cities";

/**
 * The "holo" globe: continents drawn as a field of cyan dots over a near-black planet, a faint
 * lat/long grid, orange flight-path arcs between the launch cities and a pulsing beacon on each.
 * Everything here fades out by zoom ~5, so street level keeps the normal dark map.
 * Purely visual: no game, location or crate logic lives here.
 */

const CYAN = "#34cde3";
const VOLT = "#ff7c01";
/** Zoom where the globe art has fully faded and the regular street map takes over. */
const FADE_START = 3.6;
const FADE_END = 4.8;
const fadeOut = (v: number): maplibregl.ExpressionSpecification => ["interpolate", ["linear"], ["zoom"], FADE_START, v, FADE_END, 0];

type LngLat = [number, number];

/** A small cyan dot on a transparent tile; repeated over the land it reads like an LED panel. */
function dotImage(): { width: number; height: number; data: Uint8ClampedArray } {
  const s = 12; // 6 css px at pixelRatio 2
  const data = new Uint8ClampedArray(s * s * 4);
  const [r, g, b] = [0x34, 0xcd, 0xe3];
  const c = (s - 1) / 2, rad = 2.3;
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const d = Math.hypot(x - c, y - c);
    const a = Math.max(0, Math.min(1, rad + 0.5 - d)); // anti-aliased edge
    const i = (y * s + x) * 4;
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = Math.round(a * 230);
  }
  return { width: s, height: s, data };
}

/** Great-circle path between two points, so arcs bow across the globe like flight routes. */
function arc(a: LngLat, b: LngLat, steps = 64): LngLat[] {
  const rad = Math.PI / 180;
  const toV = ([lng, lat]: LngLat) => [Math.cos(lat * rad) * Math.cos(lng * rad), Math.cos(lat * rad) * Math.sin(lng * rad), Math.sin(lat * rad)];
  const va = toV(a), vb = toV(b);
  const dot = Math.min(1, Math.max(-1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2]));
  const w = Math.acos(dot);
  if (w < 1e-6) return [a, b];
  const out: LngLat[] = [];
  let prevLng: number | null = null;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const k1 = Math.sin((1 - t) * w) / Math.sin(w), k2 = Math.sin(t * w) / Math.sin(w);
    const v = [k1 * va[0] + k2 * vb[0], k1 * va[1] + k2 * vb[1], k1 * va[2] + k2 * vb[2]];
    let lng = Math.atan2(v[1], v[0]) / rad;
    const lat = Math.atan2(v[2], Math.hypot(v[0], v[1])) / rad;
    // keep longitudes continuous across the antimeridian so the line doesn't jump the long way round
    if (prevLng !== null) while (lng - prevLng > 180) lng -= 360;
    if (prevLng !== null) while (prevLng - lng > 180) lng += 360;
    prevLng = lng;
    out.push([lng, lat]);
  }
  return out;
}

/**
 * The route network: every city links to its nearest neighbour, cities within 3,000 km form a region,
 * and regions are joined by their shortest links (a spanning tree), so every continent connects
 * with as few long arcs as possible.
 */
function routes(): LngLat[][] {
  const pts = SERVICE_CITIES.map((c) => [c.lng, c.lat] as LngLat);
  const n = pts.length;
  const rad = Math.PI / 180;
  const km = (a: LngLat, b: LngLat) => {
    const h = Math.sin(((b[1] - a[1]) * rad) / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(((b[0] - a[0]) * rad) / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(h));
  };
  const pairs: { i: number; j: number; d: number }[] = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) pairs.push({ i, j, d: km(pts[i], pts[j]) });
  pairs.sort((x, y) => x.d - y.d);
  const seen = new Set<string>();
  const lines: LngLat[][] = [];
  const link = (i: number, j: number) => {
    const key = i < j ? `${i}-${j}` : `${j}-${i}`;
    if (seen.has(key)) return;
    seen.add(key);
    lines.push(arc(pts[i], pts[j]));
  };
  // nearest neighbour for each city
  for (let i = 0; i < n; i++) {
    const near = pairs.find((p) => p.i === i || p.j === i);
    if (near) link(near.i, near.j);
  }
  // Kruskal over all pairs: short links merge regions first, then the shortest bridge between each pair of regions
  const root = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => (root[x] === x ? x : (root[x] = find(root[x])));
  for (const p of pairs) {
    const a = find(p.i), b = find(p.j);
    if (a === b) continue;
    root[a] = b;
    if (p.d > 3000) link(p.i, p.j); // short in-region links are already covered by nearest neighbours
  }
  return lines;
}

/** Lat/long grid every 15 degrees, densified so it hugs the sphere. */
function graticule(): LngLat[][] {
  const lines: LngLat[][] = [];
  for (let lng = -180; lng < 180; lng += 15) {
    const l: LngLat[] = [];
    for (let lat = -80; lat <= 80; lat += 2) l.push([lng, lat]);
    lines.push(l);
  }
  for (let lat = -75; lat <= 75; lat += 15) {
    const l: LngLat[] = [];
    for (let lng = -180; lng <= 180; lng += 2) l.push([lng, lat]);
    lines.push(l);
  }
  return lines;
}

const multiLine = (lines: LngLat[][]) => ({ type: "Feature" as const, properties: {}, geometry: { type: "MultiLineString" as const, coordinates: lines } });

/** An expanding orange ring, redrawn each frame (MapLibre's animated-image interface). */
function pulseImage(m: maplibregl.Map, still: boolean): maplibregl.StyleImageInterface {
  const size = 96;
  const ctxHolder: { ctx: CanvasRenderingContext2D | null } = { ctx: null };
  const img: maplibregl.StyleImageInterface = {
    width: size, height: size, data: new Uint8ClampedArray(size * size * 4),
    onAdd() {
      const c = document.createElement("canvas");
      c.width = size; c.height = size;
      ctxHolder.ctx = c.getContext("2d", { willReadFrequently: true });
    },
    render() {
      const ctx = ctxHolder.ctx;
      if (!ctx) return false;
      const t = still ? 0.45 : (performance.now() % 2200) / 2200;
      ctx.clearRect(0, 0, size, size);
      // two staggered rings so there's always one on its way out
      for (const off of [0, 0.5]) {
        const p = (t + off) % 1;
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, 6 + p * (size / 2 - 8), 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255,124,1,${(1 - p) * 0.85})`;
        ctx.lineWidth = 3;
        ctx.stroke();
      }
      img.data = ctx.getImageData(0, 0, size, size).data;
      if (!still && m.getZoom() < FADE_END + 5) m.triggerRepaint();
      return true;
    },
  };
  return img;
}

/**
 * Restyle the low-zoom globe and add its art layers. Call once the style has loaded, after the base
 * styling and city layers exist. Returns a cleanup that stops the arc animation.
 */
export function addGlobeArt(m: maplibregl.Map, reduced: boolean): () => void {
  const has = (id: string) => !!m.getLayer(id);
  const paint = (id: string, prop: string, v: unknown) => { if (has(id)) m.setPaintProperty(id, prop, v as never); };

  // Planet body: near-black with a hint of blue; at street level it returns to the normal grey land colour.
  paint("background", "background-color", ["interpolate", ["linear"], ["zoom"], FADE_START, "#0d1114", FADE_END, "#2a2a2f"]);
  paint("water", "fill-color", ["interpolate", ["linear"], ["zoom"], FADE_START, "#040506", FADE_END, "#070708"]);
  // The base map's own place names (e.g. "NAIROBI") would clutter the globe; bring them back at street level.
  for (const id of ["place_city", "place_city_large", "place_town", "place_village", "place_other", "place_suburb"]) paint(id, "text-opacity", ["interpolate", ["linear"], ["zoom"], FADE_START, 0, FADE_END, 1]);
  // Hide borders, ice and parks on the globe so only the dot field shapes the continents.
  for (const id of ["boundary_country_z0-4", "boundary_country_z5-", "boundary_state"]) paint(id, "line-opacity", ["interpolate", ["linear"], ["zoom"], FADE_START, 0, FADE_END, 1]);
  for (const id of ["landcover_ice_shelf", "landcover_glacier", "landuse_park"]) paint(id, "fill-opacity", ["interpolate", ["linear"], ["zoom"], FADE_START, 0, FADE_END, 1]);

  // Land as dots: a patterned layer right above the plain background (so water still covers it).
  if (!m.hasImage("holo-dot")) m.addImage("holo-dot", dotImage(), { pixelRatio: 2 });
  const firstAbove = (m.getStyle().layers ?? [])[1]?.id;
  if (!has("land-dots")) m.addLayer({ id: "land-dots", type: "background", maxzoom: FADE_END, paint: { "background-pattern": "holo-dot", "background-opacity": fadeOut(0.9) } }, firstAbove);

  // Grid and routes sit under the city markers.
  const before = has("cities-glow") ? "cities-glow" : undefined;
  if (!m.getSource("holo-grid")) m.addSource("holo-grid", { type: "geojson", data: multiLine(graticule()) });
  if (!has("holo-grid")) m.addLayer({ id: "holo-grid", type: "line", source: "holo-grid", maxzoom: FADE_END, paint: { "line-color": CYAN, "line-width": 0.6, "line-opacity": fadeOut(0.14) } }, before);

  if (!m.getSource("holo-routes")) m.addSource("holo-routes", { type: "geojson", data: multiLine(routes()) });
  if (!has("holo-routes-glow")) m.addLayer({ id: "holo-routes-glow", type: "line", source: "holo-routes", maxzoom: FADE_END, layout: { "line-cap": "round" }, paint: { "line-color": VOLT, "line-width": 5, "line-blur": 4, "line-opacity": fadeOut(0.22) } }, before);
  if (!has("holo-routes")) m.addLayer({ id: "holo-routes", type: "line", source: "holo-routes", maxzoom: FADE_END, layout: { "line-cap": "round" }, paint: { "line-color": VOLT, "line-width": 1.3, "line-opacity": fadeOut(0.85), "line-dasharray": [0, 4, 3] } }, before);

  // Pulsing beacon under each city dot (the dot and its glow stay as they were, so selection still works).
  if (!m.hasImage("holo-pulse")) m.addImage("holo-pulse", pulseImage(m, reduced), { pixelRatio: 2 });
  if (!has("holo-pulse")) m.addLayer({ id: "holo-pulse", type: "symbol", source: "cities", maxzoom: 10, layout: { "icon-image": "holo-pulse", "icon-allow-overlap": true, "icon-ignore-placement": true, "icon-pitch-alignment": "map" } }, has("cities-dot") ? "cities-dot" : undefined);
  paint("cities-glow", "circle-radius", ["interpolate", ["linear"], ["zoom"], 0, 9, 6, 22]);

  // City names as small HUD tags.
  if (has("cities-label")) {
    m.setLayoutProperty("cities-label", "text-transform", "uppercase");
    m.setLayoutProperty("cities-label", "text-size", 10.5);
    m.setLayoutProperty("cities-label", "text-letter-spacing", 0.14);
    paint("cities-label", "text-color", "#e6fbff");
  }

  // March the dashes along the routes, a few steps a second; only while the globe is showing.
  if (reduced) return () => undefined;
  // MapLibre's "animate a line" sequence: a 3-long dash with a 4-long gap, shifted half a unit each step.
  const steps: number[][] = [[0, 4, 3], [0.5, 4, 2.5], [1, 4, 2], [1.5, 4, 1.5], [2, 4, 1], [2.5, 4, 0.5], [3, 4, 0], [0, 0.5, 3, 3.5], [0, 1, 3, 3], [0, 1.5, 3, 2.5], [0, 2, 3, 2], [0, 2.5, 3, 1.5], [0, 3, 3, 1], [0, 3.5, 3, 0.5]];
  let i = 0, raf = 0, last = 0;
  const tick = (t: number) => {
    raf = requestAnimationFrame(tick);
    if (t - last < 70 || document.hidden || m.getZoom() >= FADE_END || !has("holo-routes")) return;
    last = t;
    i = (i + 1) % steps.length;
    m.setPaintProperty("holo-routes", "line-dasharray", steps[i]);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}
