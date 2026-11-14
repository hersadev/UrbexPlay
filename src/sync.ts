import { get, set } from 'idb-keyval';
import { CATALOG } from './catalog';
import { sourcesToText, textToSources } from './sources';
import {
  TYPES,
  type Data,
  type Diary,
  type LatLng,
  type Ownership,
  type Place,
  type PlaceType,
  type Status,
  type Trip,
  type TripStart,
} from './types';

/*
 * Sincronización con una hoja de Google a través del script de
 * google-apps-script/Code.gs. En cada petición la app envía todos sus
 * registros con su marca de tiempo y recibe el contenido completo de la hoja;
 * en ambos lados gana, registro a registro, la marca más reciente.
 */

export interface SyncConfig {
  url: string;
  key: string;
}

export interface SyncStatus {
  state: 'off' | 'syncing' | 'ok' | 'error';
  at?: number;
  message?: string;
  /** Filas de la hoja que no se han podido leer (sin nombre o sin coordenadas válidas). */
  skipped?: number;
}

type Row = Record<string, string>;
type Sheet = 'Lugares' | 'Diario' | 'Salidas' | 'Ocultos';
type Tables = Record<Sheet, Row[]>;

const CONFIG_KEY = 'urbexplay:sync';

export const loadSyncConfig = () => get<SyncConfig>(CONFIG_KEY);
export const saveSyncConfig = (config: SyncConfig | null) => set(CONFIG_KEY, config ?? undefined);

export const isScriptUrl = (url: string) => /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url.trim());

const PREFIX: Record<string, Sheet> = { p: 'Lugares', d: 'Diario', t: 'Salidas', h: 'Ocultos' };
const isTrue = (value: string | undefined) => /^(true|verdadero|s[ií]|x|1)$/i.test((value ?? '').trim());
const toNumber = (value: string | undefined) => Number((value ?? '').trim().replace(',', '.'));

// ── De la app a la hoja ──

const pointToText = (p: LatLng | undefined) => (p ? `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}` : '');

const placeRow = (p: Place): Row => ({
  nombre: p.name,
  tipo: p.type,
  lat: String(p.lat),
  lng: String(p.lng),
  aproximadas: p.approx ? 'TRUE' : '',
  municipio: p.town,
  provincia: p.province,
  resumen: p.summary,
  historia: p.history,
  leyenda: p.legend,
  fuentes: sourcesToText(p.sources),
  estado: p.practical.state,
  acceso: p.practical.access,
  propiedad: p.practical.ownership,
  dificultad: String(p.practical.difficulty),
  riesgos: p.practical.risks,
  aparcar: p.practical.parking,
  equipo: p.practical.gear,
  aparcamiento_coords: pointToText(p.parkingAt),
  entrada_coords: pointToText(p.entryAt),
});

function toTables(data: Data): Tables {
  const tables: Tables = { Lugares: [], Diario: [], Salidas: [], Ocultos: [] };
  const custom = new Map(data.custom.map((p) => [p.id, p]));
  const trips = new Map(data.trips.map((t) => [t.id, t]));
  const hidden = new Set(data.hidden);
  const nameOf = (id: string) => custom.get(id)?.name ?? CATALOG.find((p) => p.id === id)?.name ?? '';

  for (const [key, stamp] of Object.entries(data.stamps)) {
    const kind = key[0];
    const id = key.slice(2);
    const sheet = PREFIX[kind];
    if (!sheet || !id) continue;

    let fields: Row | null = null;
    if (kind === 'p' && custom.has(id)) fields = placeRow(custom.get(id)!);
    if (kind === 'h' && hidden.has(id)) fields = { lugar: nameOf(id) };
    if (kind === 'd' && data.diary[id]) {
      const d = data.diary[id];
      fields = { lugar: nameOf(id), estado: d.status, notas: d.notes, visitas: JSON.stringify(d.visits) };
    }
    if (kind === 't' && trips.has(id)) {
      const t = trips.get(id)!;
      fields = {
        nombre: t.name,
        fecha: t.date,
        notas: t.notes,
        paradas: t.placeIds.join(', '),
        origen: t.start ? `${t.start.lat.toFixed(5)}, ${t.start.lng.toFixed(5)} ${t.start.label}`.trim() : '',
        equipo: (t.packed ?? []).join(', '),
      };
    }
    tables[sheet].push({ id, ...(fields ?? {}), actualizado: String(stamp), borrado: fields ? '' : 'TRUE' });
  }
  return tables;
}

// ── De la hoja a la app ──

/** «37.99200, -1.13000» → punto. Vacío o ilegible: sin punto. */
function textToPoint(text: string): LatLng | undefined {
  const match = /^\s*(-?\d+(?:[.]\d+)?)\s*[,;\s]\s*(-?\d+(?:[.]\d+)?)\s*$/.exec(text);
  if (!match) return undefined;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  return Math.abs(lat) > 90 || Math.abs(lng) > 180 ? undefined : { lat, lng };
}

/**
 * Una hoja con un script anterior no tiene las columnas de aparcamiento y
 * entrada: en ese caso se conserva lo que hubiera en este dispositivo (`previous`).
 */
function rowToPlace(row: Row, previous?: Place): Place | null {
  const lat = toNumber(row.lat);
  const lng = toNumber(row.lng);
  const name = (row.nombre ?? '').trim();
  if (!name || !row.lat?.trim() || !row.lng?.trim()) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const type = (row.tipo ?? '').trim().toLowerCase() as PlaceType;
  const ownership = (row.propiedad ?? '').trim().toLowerCase() as Ownership;
  const difficulty = Math.round(toNumber(row.dificultad));
  const parkingAt = row.aparcamiento_coords === undefined ? previous?.parkingAt : textToPoint(row.aparcamiento_coords);
  const entryAt = row.entrada_coords === undefined ? previous?.entryAt : textToPoint(row.entrada_coords);
  return {
    id: row.id.trim(),
    name,
    type: TYPES.includes(type) ? type : 'edificio',
    lat,
    lng,
    approx: isTrue(row.aproximadas) || undefined,
    town: row.municipio ?? '',
    province: row.provincia ?? '',
    summary: row.resumen ?? '',
    history: row.historia ?? '',
    legend: row.leyenda ?? '',
    sources: textToSources(row.fuentes ?? ''),
    practical: {
      state: row.estado ?? '',
      access: row.acceso ?? '',
      ownership: ['publica', 'privada', 'desconocida'].includes(ownership) ? ownership : 'desconocida',
      difficulty: difficulty === 2 || difficulty === 3 ? difficulty : 1,
      risks: row.riesgos ?? '',
      parking: row.aparcar ?? '',
      gear: row.equipo ?? '',
    },
    ...(parkingAt && { parkingAt }),
    ...(entryAt && { entryAt }),
    custom: true,
  };
}

function rowToDiary(row: Row): Diary {
  let visits: Diary['visits'] = [];
  try {
    const parsed = JSON.parse(row.visitas || '[]');
    if (Array.isArray(parsed)) visits = parsed;
  } catch {
    /* celda editada a mano y rota: se conserva el resto del diario */
  }
  const status = (row.estado ?? '').trim().toLowerCase() as Status;
  return {
    status: status === 'pendiente' || status === 'visitado' ? status : 'ninguno',
    notes: row.notas ?? '',
    visits,
  };
}

/** «37.99200, -1.13000 Murcia» → punto de salida. */
function textToStart(text: string): TripStart | undefined {
  const match = /^\s*(-?\d+(?:[.]\d+)?)\s*,\s*(-?\d+(?:[.]\d+)?)\s*(.*)$/.exec(text);
  if (!match) return undefined;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return undefined;
  return { lat, lng, label: match[3].trim() };
}

/**
 * Una hoja con el script antiguo no tiene las columnas «origen» ni «equipo»:
 * en ese caso se conserva lo que hubiera en este dispositivo (`previous`).
 */
function rowToTrip(row: Row, previous: Trip | undefined): Trip {
  const start = row.origen === undefined ? previous?.start : textToStart(row.origen);
  const packed =
    row.equipo === undefined
      ? previous?.packed
      : row.equipo
          .split(',')
          .map((key) => key.trim())
          .filter(Boolean);
  return {
    id: row.id.trim(),
    name: row.nombre ?? '',
    date: /^\d{4}-\d{2}-\d{2}$/.test((row.fecha ?? '').trim()) ? row.fecha.trim() : '',
    notes: row.notas ?? '',
    placeIds: (row.paradas ?? '').split(/[,\s]+/).filter(Boolean),
    ...(start && { start }),
    ...(packed?.length && { packed }),
  };
}

/** Aplica lo recibido de la hoja donde su marca es más reciente que la local. */
export function mergeRemote(data: Data, remote: Partial<Tables>): { data: Data; skipped: number } {
  const custom = new Map(data.custom.map((p) => [p.id, p]));
  const hidden = new Set(data.hidden);
  const diary = { ...data.diary };
  const trips = new Map(data.trips.map((t) => [t.id, t]));
  const stamps = { ...data.stamps };
  let changed = false;
  let skipped = 0;

  const each = (sheet: Sheet, prefix: string, apply: (id: string, row: Row, deleted: boolean) => boolean) => {
    for (const row of remote[sheet] ?? []) {
      const id = (row.id ?? '').trim();
      if (!id) continue;
      const key = `${prefix}:${id}`;
      const stamp = Number(row.actualizado) || 0;
      if (key in stamps && stamp <= stamps[key]) continue;
      if (!apply(id, row, isTrue(row.borrado))) {
        skipped++;
        continue;
      }
      stamps[key] = stamp;
      changed = true;
    }
  };

  each('Lugares', 'p', (id, row, deleted) => {
    if (deleted) return custom.delete(id), true;
    const place = rowToPlace(row, custom.get(id));
    if (!place) return false;
    custom.set(id, place);
    return true;
  });
  each('Ocultos', 'h', (id, _row, deleted) => {
    if (deleted) hidden.delete(id);
    else hidden.add(id);
    return true;
  });
  each('Diario', 'd', (id, row, deleted) => {
    if (deleted) delete diary[id];
    else diary[id] = rowToDiary(row);
    return true;
  });
  each('Salidas', 't', (id, row, deleted) => {
    if (deleted) trips.delete(id);
    else trips.set(id, rowToTrip(row, trips.get(id)));
    return true;
  });

  if (!changed) return { data, skipped };
  return {
    data: { custom: [...custom.values()], hidden: [...hidden], diary, trips: [...trips.values()], stamps },
    skipped,
  };
}

/** Envía los registros locales y devuelve el contenido de la hoja ya mezclado. */
export async function pushPull(config: SyncConfig, data: Data): Promise<Partial<Tables>> {
  let response: Response;
  try {
    // Cuerpo de texto sin cabeceras propias: así el navegador no hace la
    // consulta previa (CORS preflight), que Apps Script no sabe responder.
    response = await fetch(config.url.trim(), {
      method: 'POST',
      body: JSON.stringify({ clave: config.key, cambios: toTables(data) }),
    });
  } catch {
    throw new Error('No se ha podido conectar con la hoja. Comprueba la conexión y la URL.');
  }
  let body: { ok?: boolean; error?: string; datos?: Partial<Tables> };
  try {
    body = await response.json();
  } catch {
    throw new Error(
      'La URL no responde como el script de UrbexPlay. Revisa que la implementación dé acceso a «Cualquier usuario».',
    );
  }
  if (!body.ok || !body.datos) throw new Error(body.error || 'La hoja ha rechazado la sincronización.');
  return body.datos;
}
