import { del, get, keys, set } from 'idb-keyval';
import type { Data } from './types';

const DATA_KEY = 'urbexplay:data';
const PHOTO_PREFIX = 'urbexplay:foto:';

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
  const before = records(prev);
  const after = records(next);
  const stamps = { ...next.stamps };
  const now = Date.now();
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    if (before.get(key) !== after.get(key)) stamps[key] = now;
  }
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
}

export async function exportBackup(data: Data): Promise<Blob> {
  const photos: Record<string, string> = {};
  for (const key of await keys()) {
    if (typeof key === 'string' && key.startsWith(PHOTO_PREFIX)) {
      const blob = await get<Blob>(key);
      if (blob) photos[key.slice(PHOTO_PREFIX.length)] = await blobToDataUrl(blob);
    }
  }
  const backup: Backup = {
    app: 'urbexplay',
    version: 1,
    exportedAt: new Date().toISOString(),
    data,
    photos,
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
    if (typeof key === 'string' && key.startsWith(PHOTO_PREFIX)) await del(key);
  }
  for (const [id, dataUrl] of Object.entries(backup.photos ?? {})) {
    const blob = await (await fetch(dataUrl)).blob();
    await set(PHOTO_PREFIX + id, blob);
  }
  await saveData(data);
  return data;
}
