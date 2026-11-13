import type { LatLng } from './types';

/** Distancia en línea recta, en km. */
export function distanceKm(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];

/** Rumbo de `a` hacia `b` como punto cardinal (N, NE, E…). */
export function cardinal(a: LatLng, b: LatLng): string {
  const rad = Math.PI / 180;
  const dLng = (b.lng - a.lng) * rad;
  const y = Math.sin(dLng) * Math.cos(b.lat * rad);
  const x =
    Math.cos(a.lat * rad) * Math.sin(b.lat * rad) - Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos(dLng);
  const degrees = (Math.atan2(y, x) / rad + 360) % 360;
  return CARDINALS[Math.round(degrees / 45) % 8];
}

export function formatKm(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km < 10 ? km.toFixed(1).replace('.', ',') : Math.round(km)} km`;
}

export function pathKm(points: LatLng[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distanceKm(points[i - 1], points[i]);
  return total;
}

const pair = (p: LatLng) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;

export const formatCoords = (p: LatLng) => `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;

/** Ruta en Google Maps desde la posición actual pasando por los puntos en orden. */
export function googleMapsRoute(points: LatLng[]): string {
  if (points.length === 0) return 'https://www.google.com/maps';
  const params = new URLSearchParams({ api: '1', travelmode: 'driving' });
  params.set('destination', pair(points[points.length - 1]));
  // Google admite como máximo 9 paradas intermedias en este tipo de enlace.
  const stops = points.slice(0, -1).slice(0, 9);
  if (stops.length) params.set('waypoints', stops.map(pair).join('|'));
  return `https://www.google.com/maps/dir/?${params}`;
}

/** Reordena por vecino más cercano, manteniendo fija la primera parada. */
export function nearestOrder<T extends LatLng>(points: T[]): T[] {
  if (points.length < 3) return points;
  const rest = points.slice(1);
  const out = [points[0]];
  while (rest.length) {
    const last = out[out.length - 1];
    let best = 0;
    for (let i = 1; i < rest.length; i++) {
      if (distanceKm(last, rest[i]) < distanceKm(last, rest[best])) best = i;
    }
    out.push(rest.splice(best, 1)[0]);
  }
  return out;
}
