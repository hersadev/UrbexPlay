import { get, set } from 'idb-keyval';
import { useEffect, useState } from 'react';
import type { LatLng } from './types';

/*
 * Distancia y tiempo por carretera con el servidor OSRM de FOSSGIS
 * (routing.openstreetmap.de), el mismo que usa openstreetmap.org. Es gratuito
 * y sin clave, así que se le pide lo mínimo: una consulta por recorrido, con
 * espera mientras se reordenan paradas, y las últimas respuestas se guardan
 * para verlas sin cobertura. El mismo servidor calcula las rutas a pie.
 */

export type Profile = 'coche' | 'pie';

export interface RoadLeg {
  km: number;
  minutes: number;
}

export interface RoadRoute {
  /** Un tramo entre cada par de puntos consecutivos. */
  legs: RoadLeg[];
  /** Trazado por carretera, como pares [lat, lng]. */
  line: [number, number][];
}

export type RoadState = { status: 'idle' | 'loading' | 'error'; route?: undefined } | { status: 'ok'; route: RoadRoute };

const CACHE_KEY = 'urbexplay:rutas';
const CACHE_SIZE = 12;
const WAIT_MS = 700;
const FOOT = 'pie:';

const memory = new Map<string, RoadRoute>();
const pending = new Map<string, Promise<RoadRoute>>();

const keyOf = (points: LatLng[]) => points.map((p) => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`).join(';');

/** Recorrido completo de una salida: del origen a cada parada y vuelta al origen. */
export function tripPoints(start: LatLng | undefined, stops: LatLng[]): LatLng[] {
  if (!stops.length) return [];
  return start ? [start, ...stops, start] : stops;
}

/** `key` es el recorrido; las rutas a pie llevan delante «pie:». */
async function fetchRoute(key: string): Promise<RoadRoute> {
  const foot = key.startsWith(FOOT);
  const url =
    `https://routing.openstreetmap.de/routed-${foot ? 'foot' : 'car'}/route/v1/driving/` +
    `${foot ? key.slice(FOOT.length) : key}?overview=full&geometries=geojson`;
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error('ruta');
  const json = (await response.json()) as {
    code: string;
    routes?: { legs: { distance: number; duration: number }[]; geometry: { coordinates: [number, number][] } }[];
  };
  const found = json.routes?.[0];
  if (json.code !== 'Ok' || !found) throw new Error('ruta');
  return {
    legs: found.legs.map((leg) => ({ km: leg.distance / 1000, minutes: leg.duration / 60 })),
    line: found.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
  };
}

async function load(key: string): Promise<RoadRoute> {
  const saved = (await get<[string, RoadRoute][]>(CACHE_KEY).catch(() => undefined)) ?? [];
  const hit = saved.find(([k]) => k === key);
  if (hit) return hit[1];
  const route = await fetchRoute(key);
  // Se relee por si otra consulta ha guardado algo entretanto.
  const latest = (await get<[string, RoadRoute][]>(CACHE_KEY).catch(() => undefined)) ?? [];
  set(CACHE_KEY, [[key, route], ...latest.filter(([k]) => k !== key)].slice(0, CACHE_SIZE)).catch(() => {});
  return route;
}

function roadRoute(key: string): Promise<RoadRoute> {
  let promise = pending.get(key);
  if (!promise) {
    promise = load(key)
      .then((route) => {
        memory.set(key, route);
        return route;
      })
      .finally(() => pending.delete(key));
    pending.set(key, promise);
  }
  return promise;
}

/**
 * Mejor orden para recorrer los puntos por carretera, según el servicio de
 * viaje de OSRM. Devuelve los índices de `points` en el orden de visita. El
 * primero se mantiene; con `roundtrip` se cuenta también la vuelta a él.
 */
export async function optimalOrder(points: LatLng[], roundtrip: boolean): Promise<number[]> {
  const url =
    `https://routing.openstreetmap.de/routed-car/trip/v1/driving/${keyOf(points)}` +
    `?source=first&overview=false&roundtrip=${roundtrip}${roundtrip ? '' : '&destination=any'}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error('orden');
  const json = (await response.json()) as { code: string; waypoints?: { waypoint_index: number }[] };
  if (json.code !== 'Ok' || json.waypoints?.length !== points.length) throw new Error('orden');
  const position = json.waypoints.map((w) => w.waypoint_index);
  return points.map((_, i) => i).sort((a, b) => position[a] - position[b]);
}

/** Ruta por carretera que pasa por los puntos en orden. Con menos de dos puntos no hace nada. */
export function useRoadRoute(points: LatLng[], profile: Profile = 'coche'): RoadState {
  const key = points.length > 1 ? (profile === 'pie' ? FOOT : '') + keyOf(points) : '';
  const [result, setResult] = useState<{ key: string; state: RoadState }>({ key: '', state: { status: 'idle' } });

  useEffect(() => {
    if (!key || memory.has(key)) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      roadRoute(key).then(
        (route) => !cancelled && setResult({ key, state: { status: 'ok', route } }),
        () => !cancelled && setResult({ key, state: { status: 'error' } }),
      );
    }, WAIT_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key]);

  if (!key) return { status: 'idle' };
  const known = memory.get(key);
  if (known) return { status: 'ok', route: known };
  return result.key === key ? result.state : { status: 'loading' };
}

export function formatDuration(minutes: number): string {
  const total = Math.max(1, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}
