/**
 * Launch cities. Crates only spawn for players inside one of these circles; everywhere else is outside
 * the service area. Add a city by adding a row. Set LOTUS_CITY_GATE=off to disable the gate (testing).
 */
export interface ServiceCity { name: string; lat: number; lng: number; radiusKm: number }

export const SERVICE_CITIES: readonly ServiceCity[] = [
  { name: 'London', lat: 51.5074, lng: -0.1278, radiusKm: 35 },
  { name: 'Paris', lat: 48.8566, lng: 2.3522, radiusKm: 30 },
  { name: 'Berlin', lat: 52.52, lng: 13.405, radiusKm: 30 },
  { name: 'Tokyo', lat: 35.6762, lng: 139.6503, radiusKm: 45 },
  { name: 'Seoul', lat: 37.5665, lng: 126.978, radiusKm: 35 },
  { name: 'Singapore', lat: 1.3521, lng: 103.8198, radiusKm: 25 },
  { name: 'Sydney', lat: -33.8688, lng: 151.2093, radiusKm: 35 },
  { name: 'Los Angeles', lat: 34.0522, lng: -118.2437, radiusKm: 45 },
  { name: 'Mexico City', lat: 19.4326, lng: -99.1332, radiusKm: 35 },
  { name: 'Miami', lat: 25.7617, lng: -80.1918, radiusKm: 30 },
  { name: 'New York', lat: 40.7128, lng: -74.006, radiusKm: 40 },
  { name: 'Toronto', lat: 43.6532, lng: -79.3832, radiusKm: 35 },
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
