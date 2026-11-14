import { del, get, keys, set } from 'idb-keyval';
import type { Data, LatLng, TrackPoint } from './types';

const DATA_KEY = 'urbexplay:data';
const PHOTO_PREFIX = 'urbexplay:foto:';
const TRACK_PREFIX = 'urbexplay:recorrido:';
const CAR_KEY = 'urbexplay:coche';
const RECORDING_KEY = 'urbexplay:grabando';

export const emptyData = (): Data => ({ custom: [], hidden: [], diary: {}, trips: [], stamps: {} });

export const uid = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export async function loadData(): Promise<Data> {
  const stored = await get<Partial<Data>>(DATA_KEY);
  return withStamps({ ...emptyData(), ...stored });
}

/** Cada registro sincronizable, serializado, por su clave de marca. */
export function records(data: Data): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of data.custom) out.set(`p:${p.id}`, JSON.stringify(p));
  for (const id of data.hidden) out.set(`h:${id}`, '1');
  for (const [id, d] of Object.entries(data.diary)) out.set(`d:${id}`, JSON.stringify(d));
  for (const t of data.trips) out.set(`t:${t.id}`, JSON.stringify(t));
  return out;
}

/** Da una marca antigua a los registros que no tienen (datos anteriores a la sincronización). */
function withStamps(data: Data): Data {
  const stamps = { ...data.stamps };
  for (const key of records(data).keys()) stamps[key] ??= 1;
  return { ...data, stamps };
}

/** Marca con la hora actual todo registro que difiera entre `prev` y `next`. */
export function stampChanges(prev: Data, next: Data): Data {
  if (prev === next) return next;
  const stamps = { ...next.stamps };
  const now = Date.now();
  // Los cambios no mutan: un registro con la misma referencia no ha cambiado y no hace
  // falta serializarlo. Así, escribir en una nota solo compara ese diario.
  const mark = (prefix: string, before: Map<string, unknown>, after: Map<string, unknown>) => {
    for (const [id, value] of after) {
      const old = before.get(id);
      if (old !== value && JSON.stringify(old) !== JSON.stringify(value)) stamps[`${prefix}:${id}`] = now;
    }
    for (const id of before.keys()) if (!after.has(id)) stamps[`${prefix}:${id}`] = now;
  };
  const byId = <T extends { id: string }>(list: T[]) => new Map<string, unknown>(list.map((item) => [item.id, item]));
  if (prev.custom !== next.custom) mark('p', byId(prev.custom), byId(next.custom));
  if (prev.hidden !== next.hidden) {
    mark('h', new Map(prev.hidden.map((id) => [id, 1])), new Map(next.hidden.map((id) => [id, 1])));
  }
  if (prev.diary !== next.diary) mark('d', new Map(Object.entries(prev.diary)), new Map(Object.entries(next.diary)));
  if (prev.trips !== next.trips) mark('t', byId(prev.trips), byId(next.trips));
  return { ...next, stamps };
}

export const saveData = (data: Data) => set(DATA_KEY, data);

/** Reduce la foto a un máximo de 1600 px y la guarda. Devuelve su id. */
export async function savePhoto(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo procesar la foto'))), 'image/jpeg', 0.82),
  );
  const id = uid();
  await set(PHOTO_PREFIX + id, blob);
  return id;
}

export const getPhoto = (id: string) => get<Blob>(PHOTO_PREFIX + id);
export const deletePhoto = (id: string) => del(PHOTO_PREFIX + id);

/** Guarda un recorrido grabado. Devuelve su id. */
export async function saveTrack(points: TrackPoint[]): Promise<string> {
  const id = uid();
  await set(TRACK_PREFIX + id, points);
  return id;
}
export const getTrack = (id: string) => get<TrackPoint[]>(TRACK_PREFIX + id);
export const deleteTrack = (id: string) => del(TRACK_PREFIX + id);

/** Dónde se ha dejado el coche. Solo en este dispositivo. */
export interface Car extends LatLng {
  at: number;
}
export const loadCar = () => get<Car>(CAR_KEY);
export const saveCar = (car: Car | null) => (car ? set(CAR_KEY, car) : del(CAR_KEY));

/** Recorrido que se está grabando; se va guardando para no perderlo si la app se recarga. */
export interface Recording {
  placeId: string;
  startedAt: number;
  points: TrackPoint[];
}
export const loadRecording = () => get<Recording>(RECORDING_KEY);
export const saveRecording = (rec: Recording | null) => (rec ? set(RECORDING_KEY, rec) : del(RECORDING_KEY));

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

interface Backup {
  app: 'urbexplay';
  version: 1;
  exportedAt: string;
  data: Data;
  photos: Record<string, string>;
  tracks?: Record<string, TrackPoint[]>;
}

export async function exportBackup(data: Data): Promise<Blob> {
  const photos: Record<string, string> = {};
  const tracks: Record<string, TrackPoint[]> = {};
  for (const key of await keys()) {
    if (typeof key !== 'string') continue;
    if (key.startsWith(PHOTO_PREFIX)) {
      const blob = await get<Blob>(key);
      if (blob) photos[key.slice(PHOTO_PREFIX.length)] = await blobToDataUrl(blob);
    } else if (key.startsWith(TRACK_PREFIX)) {
      const points = await get<TrackPoint[]>(key);
      if (points) tracks[key.slice(TRACK_PREFIX.length)] = points;
    }
  }
  const backup: Backup = {
    app: 'urbexplay',
    version: 1,
    exportedAt: new Date().toISOString(),
    data,
    photos,
    tracks,
  };
  return new Blob([JSON.stringify(backup)], { type: 'application/json' });
}

/** Sustituye todos los datos por los de la copia. Lanza si el fichero no es válido. */
export async function importBackup(file: File): Promise<Data> {
  const backup = JSON.parse(await file.text()) as Partial<Backup>;
  if (backup.app !== 'urbexplay' || !backup.data) {
    throw new Error('El fichero no es una copia de UrbexPlay.');
  }
  const data = withStamps({ ...emptyData(), ...backup.data });
  for (const key of await keys()) {
    if (typeof key === 'string' && (key.startsWith(PHOTO_PREFIX) || key.startsWith(TRACK_PREFIX))) await del(key);
  }
  for (const [id, points] of Object.entries(backup.tracks ?? {})) await set(TRACK_PREFIX + id, points);
  for (const [id, dataUrl] of Object.entries(backup.photos ?? {})) {
    const blob = await (await fetch(dataUrl)).blob();
    await set(PHOTO_PREFIX + id, blob);
  }
  await saveData(data);
  return data;
}
