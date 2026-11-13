import type { LatLng } from './types';

/*
 * Lectura de ubicaciones pegadas (enlaces de Google Maps, coordenadas en varios
 * formatos) y de ficheros KML, GPX y GeoJSON.
 */

export interface Located {
  point: LatLng;
  /** Nombre del sitio, cuando el enlace lo lleva. */
  name?: string;
}

export interface ImportItem extends LatLng {
  name: string;
  description: string;
}

const valid = (lat: number, lng: number) =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

const NUM = '(-?\\d{1,3}\\.\\d+)';
const URL_PATTERNS = [
  // Coordenada exacta del sitio dentro del enlace; tiene prioridad sobre el centro del mapa.
  new RegExp(`!3d${NUM}!4d${NUM}`),
  new RegExp(`[?&](?:q|query|ll|sll|destination|daddr|center)=(?:loc:)?${NUM}(?:,|%2C)\\s*${NUM}`, 'i'),
  new RegExp(`@${NUM},${NUM}`),
];

const SHORT_LINK = /https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs)/i;

export const SHORT_LINK_HELP =
  'Los enlaces cortos de Google Maps no llevan las coordenadas. Ábrelo en el navegador y copia la dirección larga, ' +
  'o mantén pulsado el punto en Google Maps y copia las coordenadas.';

/**
 * Busca una ubicación en un texto pegado. Devuelve `null` si no hay ninguna y
 * lanza un error con explicación si es un enlace corto, que no se puede leer.
 */
export function parseLocation(text: string): Located | null {
  const input = text.trim();
  if (!input) return null;

  if (/^https?:\/\//i.test(input) || input.includes('google.')) {
    for (const pattern of URL_PATTERNS) {
      const m = input.match(pattern);
      if (m && valid(Number(m[1]), Number(m[2]))) {
        const place = input.match(/\/place\/([^/@?]+)/);
        let name: string | undefined;
        try {
          name = place ? decodeURIComponent(place[1].replace(/\+/g, ' ')).trim() : undefined;
        } catch {
          name = undefined;
        }
        // A veces el «nombre» del enlace son las propias coordenadas.
        if (name && /^[-\d.,\s°'"NSEWO]+$/i.test(name)) name = undefined;
        return { point: { lat: Number(m[1]), lng: Number(m[2]) }, name };
      }
    }
    if (SHORT_LINK.test(input)) throw new Error(SHORT_LINK_HELP);
  }

  // Grados, minutos y segundos: 37°52'06.0"N 1°30'43.8"W (la O de «oeste» también vale).
  const dms = input.match(
    /(\d{1,3})\s*°\s*(\d{1,2})\s*['′]\s*([\d.,]+)\s*["″]?\s*([NS])[\s,;]+(\d{1,3})\s*°\s*(\d{1,2})\s*['′]\s*([\d.,]+)\s*["″]?\s*([EWO])/i,
  );
  if (dms) {
    const deg = (d: string, m: string, s: string) => Number(d) + Number(m) / 60 + Number(s.replace(',', '.')) / 3600;
    const lat = deg(dms[1], dms[2], dms[3]) * (/s/i.test(dms[4]) ? -1 : 1);
    const lng = deg(dms[5], dms[6], dms[7]) * (/e/i.test(dms[8]) ? 1 : -1);
    if (valid(lat, lng)) return { point: { lat, lng } };
  }

  // Decimales con coma: 37,86833, -1,51216
  const comma = input.match(/(-?\d{1,2},\d{3,})\s*[;,]?\s+(-?\d{1,3},\d{3,})/);
  if (comma) {
    const lat = Number(comma[1].replace(',', '.'));
    const lng = Number(comma[2].replace(',', '.'));
    if (valid(lat, lng)) return { point: { lat, lng } };
  }

  // Decimales con punto: 37.86833, -1.51216
  const dot = input.match(/(-?\d{1,2}(?:\.\d+)?)\s*[,;]\s*(-?\d{1,3}(?:\.\d+)?)(?![\d.])/);
  if (dot && valid(Number(dot[1]), Number(dot[2]))) return { point: { lat: Number(dot[1]), lng: Number(dot[2]) } };

  return null;
}

/** Una ubicación por línea, con el nombre delante o detrás si se quiere. */
export function parseLines(text: string): { items: ImportItem[]; unread: string[] } {
  const items: ImportItem[] = [];
  const unread: string[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    let located: Located | null = null;
    try {
      located = parseLocation(line);
    } catch {
      located = null;
    }
    if (!located) {
      unread.push(line);
      continue;
    }
    // Lo que queda de la línea al quitar el enlace o las coordenadas es el nombre.
    const rest = line
      .replace(/https?:\/\/\S+/g, '')
      .replace(/-?\d{1,3}[.,]\d+\s*[,;]?\s*-?\d{1,3}[.,]\d+/g, '')
      .replace(/\d{1,3}\s*°[^NSEWO]*[NSEWO]/gi, '')
      .replace(/^[\s:;,|\-–·]+|[\s:;,|\-–·]+$/g, '');
    items.push({ ...located.point, name: rest || located.name || '', description: '' });
  }
  return { items, unread };
}

/** Texto sin etiquetas; los saltos de línea del HTML se quedan como espacios. */
const plain = (html: string) =>
  (new DOMParser().parseFromString(html.replace(/<(br|\/p|\/div|\/li)\b[^>]*>/gi, ' '), 'text/html').body.textContent ?? '')
    .replace(/\s+/g, ' ')
    .trim();

const childText = (node: Element, tag: string) => {
  for (const child of Array.from(node.children)) {
    if (child.localName === tag) return (child.textContent ?? '').trim();
  }
  return '';
};

/** Lee los puntos de un fichero KML, GPX o GeoJSON. Las líneas y los polígonos se ignoran. */
export function parseFile(content: string, filename: string): ImportItem[] {
  const name = filename.toLowerCase();
  if (name.endsWith('.kmz')) {
    throw new Error('Los ficheros KMZ están comprimidos. En Google My Maps, exporta marcando «Exportar como KML en lugar de KMZ».');
  }

  if (name.endsWith('.json') || name.endsWith('.geojson') || content.trimStart().startsWith('{')) {
    let json: { features?: unknown[] };
    try {
      json = JSON.parse(content);
    } catch {
      throw new Error('El fichero no es un GeoJSON válido.');
    }
    const items: ImportItem[] = [];
    for (const feature of (json.features ?? []) as Array<{
      geometry?: { type?: string; coordinates?: number[] };
      properties?: Record<string, unknown> & { location?: { name?: string; address?: string } };
    }>) {
      const [lng, lat] = feature.geometry?.coordinates ?? [];
      if (feature.geometry?.type !== 'Point' || !valid(lat, lng) || (lat === 0 && lng === 0)) continue;
      const p = feature.properties ?? {};
      items.push({
        lat,
        lng,
        name: String(p.name ?? p.Name ?? p.Title ?? p.title ?? p.location?.name ?? '').trim(),
        description: plain(String(p.description ?? p.Comment ?? p.location?.address ?? '')),
      });
    }
    return items;
  }

  const xml = new DOMParser().parseFromString(content, 'application/xml');
  if (xml.getElementsByTagName('parsererror').length) throw new Error('No se ha podido leer el fichero: no es un KML o GPX válido.');
  const items: ImportItem[] = [];

  for (const mark of Array.from(xml.getElementsByTagNameNS('*', 'Placemark'))) {
    const pointNode = mark.getElementsByTagNameNS('*', 'Point')[0];
    const coords = pointNode?.getElementsByTagNameNS('*', 'coordinates')[0]?.textContent?.trim();
    if (!coords) continue;
    const [lng, lat] = coords.split(',').map(Number);
    if (!valid(lat, lng)) continue;
    items.push({ lat, lng, name: childText(mark, 'name'), description: plain(childText(mark, 'description')) });
  }

  for (const wpt of Array.from(xml.getElementsByTagNameNS('*', 'wpt'))) {
    const lat = Number(wpt.getAttribute('lat'));
    const lng = Number(wpt.getAttribute('lon'));
    if (!wpt.getAttribute('lat') || !valid(lat, lng)) continue;
    items.push({
      lat,
      lng,
      name: childText(wpt, 'name'),
      description: plain(childText(wpt, 'desc') || childText(wpt, 'cmt')),
    });
  }
  return items;
}
