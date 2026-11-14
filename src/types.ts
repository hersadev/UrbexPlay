export type PlaceType =
  | 'pueblo'
  | 'edificio'
  | 'industrial'
  | 'militar'
  | 'patrimonio'
  | 'naturaleza'
  | 'leyenda';

export type Ownership = 'publica' | 'privada' | 'desconocida';

export interface Source {
  title: string;
  url: string;
}

export interface Practical {
  /** Estado de conservación y situación actual. */
  state: string;
  /** Cómo se llega y si se puede entrar. */
  access: string;
  ownership: Ownership;
  /** 1 = paseo, 2 = requiere cuidado, 3 = exigente o peligroso. */
  difficulty: 1 | 2 | 3;
  risks: string;
  parking: string;
  gear: string;
}

export interface Place {
  id: string;
  name: string;
  type: PlaceType;
  lat: number;
  lng: number;
  /** Las coordenadas son orientativas (no vienen de una fuente contrastada). */
  approx?: boolean;
  town: string;
  province: string;
  summary: string;
  history: string;
  legend: string;
  sources: Source[];
  practical: Practical;
  /** Creado o modificado por el usuario. */
  custom?: boolean;
}

export type Status = 'ninguno' | 'pendiente' | 'visitado';

export interface Visit {
  id: string;
  date: string;
  notes: string;
  photos: string[];
}

export interface Diary {
  status: Status;
  notes: string;
  visits: Visit[];
}

/** Punto desde el que se sale (y al que se vuelve) en una salida. */
export interface TripStart extends LatLng {
  label: string;
}

export interface Trip {
  id: string;
  name: string;
  date: string;
  notes: string;
  placeIds: string[];
  start?: TripStart;
  /** Claves de los objetos de la lista de equipo ya preparados. */
  packed?: string[];
}

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Data {
  /** Lugares propios y versiones editadas de los del catálogo (mismo id). */
  custom: Place[];
  /** Ids de lugares del catálogo que el usuario ha ocultado. */
  hidden: string[];
  diary: Record<string, Diary>;
  trips: Trip[];
  /**
   * Momento (ms) del último cambio de cada registro, para sincronizar.
   * Claves: `p:` lugar propio, `h:` oculto, `d:` diario, `t:` salida.
   * Un registro borrado conserva su marca.
   */
  stamps: Record<string, number>;
}

export interface Position extends LatLng {
  /** Margen de error del GPS, en metros. */
  accuracy?: number;
}

export const TYPE_META: Record<PlaceType, { label: string; color: string; glyph: string }> = {
  pueblo: { label: 'Pueblo abandonado', color: '#c2703d', glyph: '⌂' },
  edificio: { label: 'Edificio abandonado', color: '#8e6bbf', glyph: '▦' },
  industrial: { label: 'Minas e industria', color: '#b8862b', glyph: '⚒︎' },
  militar: { label: 'Militar', color: '#5d8a55', glyph: '✪' },
  patrimonio: { label: 'Ruina histórica', color: '#b0564f', glyph: '♜︎' },
  naturaleza: { label: 'Naturaleza', color: '#3f8f8a', glyph: '▲' },
  leyenda: { label: 'Lugar con leyenda', color: '#5876c2', glyph: '☾' },
};

export const TYPES = Object.keys(TYPE_META) as PlaceType[];

export const OWNERSHIP_LABEL: Record<Ownership, string> = {
  publica: 'Pública',
  privada: 'Privada',
  desconocida: 'Sin confirmar',
};

export const DIFFICULTY_LABEL = { 1: 'Baja', 2: 'Media', 3: 'Alta' } as const;

export const emptyDiary = (): Diary => ({ status: 'ninguno', notes: '', visits: [] });
