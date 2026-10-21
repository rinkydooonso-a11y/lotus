/**
 * Launch cities. Crates only spawn for players inside one of these circles; everywhere else is outside
 * the service area. Add a city by adding a row. Set LOTUS_CITY_GATE=off to disable the gate (testing).
 */
export interface ServiceCity {
  name: string;
  lat: number;
  lng: number;
  radiusKm: number;
  /**
   * Where crates are placed, when that should be tighter than the whole service circle. Defaults to
   * the centre and min(radiusKm, 4). Crates only ever go in a core, never in the outskirts, so the
   * map is dense where people are and a launch city doesn't need 40 km of coverage to feel alive.
   */
  core?: CityCore;
}

/** A lat/lng box, used to keep crate spots out of obvious water. Hand-drawn, so deliberately generous. */
export interface LatLngBox { minLat: number; maxLat: number; minLng: number; maxLng: number }

export interface CityCore {
  lat: number;
  lng: number;
  radiusKm: number;
  /** Boxes inside the core that hold no crate spots: harbours, bays, wide rivers, the lake shore. */
  avoid?: readonly LatLngBox[];
}

export const SERVICE_CITIES: readonly ServiceCity[] = [
  { name: 'London', lat: 51.5074, lng: -0.1278, radiusKm: 35 },
  { name: 'Paris', lat: 48.8566, lng: 2.3522, radiusKm: 30 },
  { name: 'Berlin', lat: 52.52, lng: 13.405, radiusKm: 30 },
  { name: 'Tokyo', lat: 35.6762, lng: 139.6503, radiusKm: 45 },
  // Radius 3.2 km stays north of the Han River, which is about 4 km south of City Hall.
  { name: 'Seoul', lat: 37.5665, lng: 126.978, radiusKm: 35, core: { lat: 37.5665, lng: 126.978, radiusKm: 3.2 } },
  // The service centre sits by the MacRitchie reservoir; crates go in Novena, Toa Payoh and Orchard.
  { name: 'Singapore', lat: 1.3521, lng: 103.8198, radiusKm: 25, core: { lat: 1.33, lng: 103.847, radiusKm: 3 } },
  // The harbour surrounds the CBD, so the core is the inner south and west, off Darling Harbour and Blackwattle Bay.
  {
    name: 'Sydney', lat: -33.8688, lng: 151.2093, radiusKm: 35,
    core: {
      lat: -33.883, lng: 151.2, radiusKm: 2.2,
      avoid: [
        { minLat: -33.878, maxLat: -33.86, minLng: 151.196, maxLng: 151.206 },
        { minLat: -33.884, maxLat: -33.874, minLng: 151.185, maxLng: 151.198 },
      ],
    },
  },
  { name: 'Los Angeles', lat: 34.0522, lng: -118.2437, radiusKm: 45 },
  { name: 'Mexico City', lat: 19.4326, lng: -99.1332, radiusKm: 35 },
  // Brickell and Little Havana, west of Biscayne Bay.
  {
    name: 'Miami', lat: 25.7617, lng: -80.1918, radiusKm: 30,
    core: { lat: 25.765, lng: -80.21, radiusKm: 3, avoid: [{ minLat: 25.7, maxLat: 25.85, minLng: -80.186, maxLng: -80.1 }] },
  },
  // Midtown to Flatiron, between the Hudson and the East River.
  {
    name: 'New York', lat: 40.7128, lng: -74.006, radiusKm: 40,
    core: {
      lat: 40.745, lng: -73.984, radiusKm: 2,
      avoid: [
        { minLat: 40.7, maxLat: 40.8, minLng: -74.1, maxLng: -74.0 },
        { minLat: 40.7, maxLat: 40.8, minLng: -73.968, maxLng: -73.9 },
      ],
    },
  },
  // Downtown, north of the lake shore.
  {
    name: 'Toronto', lat: 43.6532, lng: -79.3832, radiusKm: 35,
    core: { lat: 43.6532, lng: -79.3832, radiusKm: 4, avoid: [{ minLat: 43.5, maxLat: 43.641, minLng: -79.5, maxLng: -79.2 }] },
  },
];

function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLng = (bLng - aLng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The launch city containing this position, or null when it is outside every service area. */
export function cityFor(lat: number, lng: number): ServiceCity | null {
  return SERVICE_CITIES.find((c) => distanceKm(lat, lng, c.lat, c.lng) <= c.radiusKm) ?? null;
}

export function cityGateEnabled(): boolean {
  return process.env.LOTUS_CITY_GATE !== 'off';
}
