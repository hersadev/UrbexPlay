import { get, set } from 'idb-keyval';
import type { LatLng } from './types';

/*
 * Mapas para usar sin cobertura.
 *
 * Solo se descargan las capas del Instituto Geográfico Nacional (CC BY 4.0).
 * El callejero de OpenStreetMap no se descarga: su política de uso prohíbe
 * bajar zonas enteras por adelantado.
 *
 * Las teselas se guardan en una caché propia, que no caduca, y las capas del
 * mapa la consultan antes de ir a la red.
 */

const ign = (service: string, layer: string) =>
  `https://www.ign.es/wmts/${service}?layer=${layer}&style=default&tilematrixset=GoogleMapsCompatible` +
  '&Service=WMTS&Request=GetTile&Version=1.0.0&Format=image/jpeg&TileMatrix={z}&TileCol={x}&TileRow={y}';

export const IGN_TOPO = ign('mapa-raster', 'MTN');
export const IGN_ORTO = ign('pnoa-ma', 'OI.OrthoimageCoverage');

const CACHE = 'urbexplay-mapas';
const META_KEY = 'urbexplay:mapas';
/** Tamaño medio de una tesela JPEG del IGN, para estimar la descarga. */
const AVG_TILE_KB = 25;
export const MAX_TILES = 5000;

/** Radio, en km, que se guarda con detalle alrededor de cada parada. */
export const DETAIL_KM = 2;
const DETAIL_ZOOMS = [13, 14, 15, 16];
const OVERVIEW_ZOOMS = [8, 9, 10, 11, 12];

export const offlineSupported = () => 'caches' in window;

const tileX = (lng: number, z: number) => Math.floor(((lng + 180) / 360) * 2 ** z);
const tileY = (lat: number, z: number) => {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2) * 2 ** z);
};

interface Box {
  south: number;
  north: number;
  west: number;
  east: number;
}

const around = (p: LatLng, km: number): Box => {
  const dLat = km / 111.32;
  const dLng = km / (111.32 * Math.cos((p.lat * Math.PI) / 180));
  return { south: p.lat - dLat, north: p.lat + dLat, west: p.lng - dLng, east: p.lng + dLng };
};

function addBox(out: Set<string>, box: Box, z: number, limit = Infinity) {
  const x0 = tileX(box.west, z);
  const x1 = tileX(box.east, z);
  const y0 = tileY(box.north, z);
  const y1 = tileY(box.south, z);
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > limit) return;
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.add(`${z}/${x}/${y}`);
}

/**
 * Teselas de una salida: detalle alrededor de cada parada y una vista general
 * de toda la zona para no perderse al alejar el zoom.
 */
export function tilesForStops(stops: LatLng[]): string[] {
  if (!stops.length) return [];
  const coords = new Set<string>();
  for (const stop of stops) {
    for (const z of DETAIL_ZOOMS) addBox(coords, around(stop, DETAIL_KM), z);
  }
  const all: Box = {
    south: Math.min(...stops.map((s) => around(s, 5).south)),
    north: Math.max(...stops.map((s) => around(s, 5).north)),
    west: Math.min(...stops.map((s) => around(s, 5).west)),
    east: Math.max(...stops.map((s) => around(s, 5).east)),
  };
  // Salidas muy extensas: los zooms generales que supondrían demasiadas teselas se omiten.
  for (const z of OVERVIEW_ZOOMS) addBox(coords, all, z, 80);

  const urls: string[] = [];
  for (const template of [IGN_TOPO, IGN_ORTO]) {
    for (const c of coords) {
      const [z, x, y] = c.split('/');
      urls.push(template.replace('{z}', z).replace('{x}', x).replace('{y}', y));
    }
  }
  return urls;
}

export const estimateMb = (tiles: number) => Math.max(1, Math.round((tiles * AVG_TILE_KB) / 1024));

export interface DownloadResult {
  saved: number;
  failed: number;
}

/** Descarga las teselas que falten. Se puede cancelar con `signal`. */
export async function downloadTiles(
  urls: string[],
  onProgress: (done: number, total: number) => void,
  signal: AbortSignal,
): Promise<DownloadResult> {
  const cache = await caches.open(CACHE);
  let next = 0;
  let done = 0;
  let failed = 0;

  const worker = async () => {
    while (next < urls.length && !signal.aborted) {
      const url = urls[next++];
      try {
        if (!(await cache.match(url))) {
          const response = await fetch(url, { signal });
          if (!response.ok) throw new Error(String(response.status));
          await cache.put(url, response);
        }
      } catch {
        if (signal.aborted) return;
        failed++;
      }
      onProgress(++done, urls.length);
    }
  };
  // Pocas peticiones a la vez: es un servicio público, no hay que saturarlo.
  await Promise.all(Array.from({ length: 4 }, worker));
  return { saved: done - failed, failed };
}

/** Devuelve la tesela guardada como URL local, o `null` si no está. */
export async function cachedTile(url: string): Promise<string | null> {
  if (!offlineSupported()) return null;
  try {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(url);
    return hit ? URL.createObjectURL(await hit.blob()) : null;
  } catch {
    return null;
  }
}

export interface SavedMap {
  at: number;
  /** Paradas que cubría, para avisar si la salida ha cambiado. */
  stops: string;
  tiles: number;
  failed: number;
}

export const loadSavedMaps = async () => (await get<Record<string, SavedMap>>(META_KEY)) ?? {};
export const saveSavedMaps = (maps: Record<string, SavedMap>) => set(META_KEY, maps);

export async function savedTileCount(): Promise<number> {
  if (!offlineSupported()) return 0;
  return (await (await caches.open(CACHE)).keys()).length;
}

export async function clearSavedMaps() {
  if (offlineSupported()) await caches.delete(CACHE);
  await saveSavedMaps({});
}
