import { get, set } from 'idb-keyval';
import { CATALOG } from './catalog';
import { isDate } from './safety';
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
  type Visit,
} from './types';

/*
 * Sincronización con una hoja de Google a través del script de
 * google-apps-script/Code.gs. En cada petición la app envía todos sus
 * registros con su marca de tiempo y recibe el contenido completo de la hoja;
 * en ambos lados gana, registro a registro, la marca más reciente.
 *
 * El diario es la excepción: si un mismo lugar se ha tocado en dos
 * dispositivos desde la última sincronización, sus dos versiones se mezclan
 * visita a visita (ver `mergeDiary`) en lugar de quedarse con una. Para saber
 * qué ha cambiado cada lado se guarda cómo estaba la hoja la última vez
 * (`SyncBase`).
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
const BASE_KEY = 'urbexplay:sync-base';

/** Diario de cada lugar tal como quedó en la hoja en la última sincronización (`null`: borrado). */
export type SyncBase = Record<string, { stamp: number; diary: Diary | null }>;

export const loadSyncBase = async (): Promise<SyncBase> => (await get<SyncBase>(BASE_KEY)) ?? {};
export const saveSyncBase = (base: SyncBase) => set(BASE_KEY, base);

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
  comprobado: p.checked ?? '',
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
        hora_salida: t.leaveAt ?? '',
        hora_vuelta: t.backAt ?? '',
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
 * Una hoja con un script anterior no tiene las columnas de aparcamiento, de
 * entrada ni la de «comprobado»: en ese caso se conserva lo que hubiera en
 * este dispositivo (`previous`).
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
  const checked =
    row.comprobado === undefined ? previous?.checked : isDate(row.comprobado.trim()) ? row.comprobado.trim() : undefined;
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
    ...(checked && { checked }),
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
 * Una hoja con el script antiguo no tiene las columnas «origen», «equipo» ni
 * las de las horas: en ese caso se conserva lo que hubiera en este dispositivo
 * (`previous`).
 */
const textToTime = (text: string) => (/^\s*\d{1,2}:\d{2}\s*$/.test(text) ? text.trim().padStart(5, '0') : undefined);

function rowToTrip(row: Row, previous: Trip | undefined): Trip {
  const start = row.origen === undefined ? previous?.start : textToStart(row.origen);
  const packed =
    row.equipo === undefined
      ? previous?.packed
      : row.equipo
          .split(',')
          .map((key) => key.trim())
          .filter(Boolean);
  const leaveAt = row.hora_salida === undefined ? previous?.leaveAt : textToTime(row.hora_salida);
  const backAt = row.hora_vuelta === undefined ? previous?.backAt : textToTime(row.hora_vuelta);
  return {
    id: row.id.trim(),
    name: row.nombre ?? '',
    date: /^\d{4}-\d{2}-\d{2}$/.test((row.fecha ?? '').trim()) ? row.fecha.trim() : '',
    notes: row.notas ?? '',
    placeIds: (row.paradas ?? '').split(/[,\s]+/).filter(Boolean),
    ...(start && { start }),
    ...(packed?.length && { packed }),
    ...(leaveAt && { leaveAt }),
    ...(backAt && { backAt }),
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Lista de ids tras los cambios de los dos lados: lo que uno quitó, quitado; lo que uno añadió, añadido. */
function mergeIds(base: string[], mine: string[], theirs: string[]): string[] {
  const inBase = new Set(base);
  const inMine = new Set(mine);
  const inTheirs = new Set(theirs);
  return [...mine, ...theirs.filter((id) => !inMine.has(id))].filter(
    (id) => !inBase.has(id) || (inMine.has(id) && inTheirs.has(id)),
  );
}

/**
 * Mezcla dos versiones de un diario que han cambiado por separado desde `base`
 * (la última que compartieron). En cada dato manda quien lo cambió; si lo
 * cambiaron los dos, manda `prefer` (la versión más reciente), salvo en las
 * notas, que se conservan las dos, y en las fotos, que se suman.
 */
export function mergeDiary(
  base: Diary | null | undefined,
  mine: Diary,
  theirs: Diary,
  prefer: 'mine' | 'theirs',
): Diary {
  const from: Diary = base ?? { status: 'ninguno', notes: '', visits: [] };
  const [first, second] = prefer === 'mine' ? [mine, theirs] : [theirs, mine];
  const pick = <T>(b: T, m: T, t: T): T => (same(m, b) ? t : same(t, b) ? m : prefer === 'mine' ? m : t);

  let notes = pick(from.notes, mine.notes, theirs.notes);
  if (mine.notes !== from.notes && theirs.notes !== from.notes && mine.notes !== theirs.notes) {
    // Las dos se han reescrito: se guardan ambas antes que perder una.
    notes = first.notes.includes(second.notes.trim())
      ? first.notes
      : second.notes.includes(first.notes.trim())
        ? second.notes
        : `${first.notes.trimEnd()}\n\n${second.notes.trimStart()}`;
  }

  const baseVisits = new Map(from.visits.map((v) => [v.id, v]));
  const myVisits = new Map(mine.visits.map((v) => [v.id, v]));
  const theirVisits = new Map(theirs.visits.map((v) => [v.id, v]));
  const visits: Visit[] = [];
  for (const id of mergeIds([...baseVisits.keys()], [...myVisits.keys()], [...theirVisits.keys()])) {
    const b = baseVisits.get(id);
    const m = myVisits.get(id);
    const t = theirVisits.get(id);
    if (!m || !t) {
      visits.push((m ?? t)!);
    } else if (same(m, t) || same(t, b)) {
      visits.push(m);
    } else if (same(m, b)) {
      visits.push(t);
    } else {
      const [p, o] = prefer === 'mine' ? [m, t] : [t, m];
      const track = p.track ?? o.track;
      visits.push({
        id,
        date: pick(b?.date ?? '', m.date, t.date),
        notes: pick(b?.notes ?? '', m.notes, t.notes),
        photos: mergeIds(b?.photos ?? [], p.photos, o.photos),
        ...(track && { track }),
      });
    }
  }
  // Las más recientes primero, como al registrarlas.
  visits.sort((a, b) => b.date.localeCompare(a.date));

  return { status: pick(from.status, mine.status, theirs.status), notes, visits };
}

/**
 * Aplica lo recibido de la hoja donde su marca es más reciente que la local.
 * Con `base`, un diario cambiado en los dos lados desde la última
 * sincronización se mezcla y recibe la marca `now`, para que la mezcla viaje a
 * la hoja y de ahí al otro dispositivo.
 */
export function mergeRemote(
  data: Data,
  remote: Partial<Tables>,
  base: SyncBase = {},
  now = Date.now(),
): { data: Data; skipped: number } {
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
  for (const row of remote.Diario ?? []) {
    const id = (row.id ?? '').trim();
    if (!id) continue;
    const key = `d:${id}`;
    const stamp = Number(row.actualizado) || 0;
    const local = key in stamps ? stamps[key] : null;
    if (local === stamp) continue;
    const deleted = isTrue(row.borrado);
    // Sin recuerdo de este diario (nunca ha coincidido con la hoja) se parte de uno vacío.
    const known = base[id] ?? { stamp: 0, diary: null };
    // Los dos lados han tocado este diario desde la última vez que coincidieron.
    const both = local !== null && local > known.stamp && stamp > known.stamp;
    if (both && !deleted && diary[id]) {
      diary[id] = mergeDiary(known.diary, diary[id], rowToDiary(row), local > stamp ? 'mine' : 'theirs');
      stamps[key] = Math.max(now, local + 1, stamp + 1);
      changed = true;
    } else if (local === null || stamp > local) {
      if (deleted) delete diary[id];
      else diary[id] = rowToDiary(row);
      stamps[key] = stamp;
      changed = true;
    }
  }
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

/** Estado del diario en la hoja, para compararlo en la siguiente sincronización. */
export function baseFrom(remote: Partial<Tables>): SyncBase {
  const base: SyncBase = {};
  for (const row of remote.Diario ?? []) {
    const id = (row.id ?? '').trim();
    if (id) base[id] = { stamp: Number(row.actualizado) || 0, diary: isTrue(row.borrado) ? null : rowToDiary(row) };
  }
  return base;
}

/** Hay diarios cambiados aquí que la hoja aún no conoce: conviene leerla antes de escribir. */
export function hasUnsyncedDiary(data: Data, base: SyncBase): boolean {
  return Object.entries(data.stamps).some(([key, stamp]) => key.startsWith('d:') && stamp > (base[key.slice(2)]?.stamp ?? 0));
}

/**
 * Envía los registros locales y devuelve el contenido de la hoja ya mezclado.
 * Con `data` en `null` solo lee la hoja, sin escribir nada en ella.
 */
export async function pushPull(config: SyncConfig, data: Data | null): Promise<Partial<Tables>> {
  let response: Response;
  try {
    // Cuerpo de texto sin cabeceras propias: así el navegador no hace la
    // consulta previa (CORS preflight), que Apps Script no sabe responder.
    response = await fetch(config.url.trim(), {
      method: 'POST',
      body: JSON.stringify({ clave: config.key, cambios: data ? toTables(data) : {} }),
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

/**
 * Una sincronización completa. Devuelve `apply`, que mezcla lo recibido sobre
 * cualquier estado (el de ahora o uno editado mientras duraba la petición), y
 * el estado de la hoja que hay que recordar para la próxima vez.
 */
export async function exchange(
  config: SyncConfig,
  data: Data,
  base: SyncBase,
  now = Date.now(),
): Promise<{ apply: (current: Data) => { data: Data; skipped: number }; base: SyncBase }> {
  // Con diarios cambiados aquí, primero se lee la hoja: si otro dispositivo también los ha
  // tocado, se mezclan antes de escribir, en vez de pisar su versión.
  const before = hasUnsyncedDiary(data, base) ? await pushPull(config, null) : null;
  const mine = before ? mergeRemote(data, before, base, now).data : data;
  const remote = await pushPull(config, mine);
  return {
    apply: (current) => mergeRemote(before ? mergeRemote(current, before, base, now).data : current, remote, base, now),
    base: baseFrom(remote),
  };
}
