import type { LatLng } from './types';

/*
 * Búsqueda de lugares por nombre en Wikipedia (en español) y en el buscador de
 * OpenStreetMap (Nominatim). Solo se consulta cuando el usuario pulsa «Buscar»:
 * Nominatim no admite búsquedas mientras se escribe.
 */

export interface SearchResult {
  key: string;
  title: string;
  detail: string;
  source: 'Wikipedia' | 'OpenStreetMap';
  point?: LatLng;
  url?: string;
  summary?: string;
  town?: string;
  province?: string;
}

interface Address {
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
  hamlet?: string;
  province?: string;
  state_district?: string;
  county?: string;
  state?: string;
}

/** Comunidades de una sola provincia: Nominatim da el nombre de la comunidad. */
const PROVINCE_NAMES: Record<string, string> = {
  'Región de Murcia': 'Murcia',
  'Comunidad de Madrid': 'Madrid',
  'Principado de Asturias': 'Asturias',
  'Comunidad Foral de Navarra': 'Navarra',
  'Islas Baleares': 'Baleares',
  'Illes Balears': 'Baleares',
};

function fromAddress(address: Address | undefined) {
  if (!address) return { town: '', province: '' };
  const raw = address.province ?? address.state_district ?? address.county ?? address.state ?? '';
  // Nombres bilingües como «Alacant / Alicante»: se queda con el castellano.
  const single = raw.includes(' / ') ? raw.split(' / ').pop()! : raw;
  return {
    town: address.city ?? address.town ?? address.village ?? address.municipality ?? address.hamlet ?? '',
    province: PROVINCE_NAMES[single] ?? single,
  };
}

const firstSentence = (text: string) => {
  const clean = text.replace(/\s+/g, ' ').trim();
  const end = clean.search(/\.(\s|$)/);
  const sentence = end > 40 ? clean.slice(0, end + 1) : clean;
  return sentence.length > 220 ? `${sentence.slice(0, 217).trimEnd()}…` : sentence;
};

/** Ninguna búsqueda espera más de esto: una fuente lenta no debe bloquear a la otra. */
const limit = () => AbortSignal.timeout(12000);

export async function searchWikipedia(query: string): Promise<SearchResult[]> {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    origin: '*',
    generator: 'search',
    gsrsearch: query,
    gsrlimit: '6',
    prop: 'coordinates|extracts|info',
    inprop: 'url',
    exintro: '1',
    explaintext: '1',
    exsentences: '2',
    exlimit: '6',
    colimit: '6',
  });
  const response = await fetch(`https://es.wikipedia.org/w/api.php?${params}`, { signal: limit() });
  if (!response.ok) throw new Error('wikipedia');
  const json = (await response.json()) as {
    query?: {
      pages?: Record<
        string,
        { index: number; title: string; extract?: string; fullurl?: string; coordinates?: { lat: number; lon: number }[] }
      >;
    };
  };
  return Object.values(json.query?.pages ?? {})
    .sort((a, b) => a.index - b.index)
    .map((page) => {
      const c = page.coordinates?.[0];
      const summary = firstSentence(page.extract ?? '');
      return {
        key: `w:${page.title}`,
        title: page.title,
        detail: summary,
        source: 'Wikipedia' as const,
        point: c ? { lat: c.lat, lng: c.lon } : undefined,
        url: page.fullurl,
        summary,
      };
    });
}

async function nominatim(query: string, onlySpain: boolean) {
  const params = new URLSearchParams({
    format: 'jsonv2',
    addressdetails: '1',
    limit: '5',
    'accept-language': 'es',
    q: query,
  });
  if (onlySpain) params.set('countrycodes', 'es');
  const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, { signal: limit() });
  if (!response.ok) throw new Error('nominatim');
  return (await response.json()) as Array<{
    place_id: number;
    lat: string;
    lon: string;
    name?: string;
    display_name: string;
    address?: Address;
  }>;
}

export async function searchOsm(query: string): Promise<SearchResult[]> {
  let found = await nominatim(query, true);
  if (!found.length) found = await nominatim(query, false);
  return found.map((item) => ({
    key: `o:${item.place_id}`,
    title: item.name || item.display_name.split(',')[0],
    detail: item.display_name,
    source: 'OpenStreetMap' as const,
    point: { lat: Number(item.lat), lng: Number(item.lon) },
    ...fromAddress(item.address),
  }));
}

/** Municipio y provincia de un punto. Devuelve cadenas vacías si no se puede saber. */
export async function reverseGeocode(point: LatLng): Promise<{ town: string; province: string }> {
  try {
    const params = new URLSearchParams({
      format: 'jsonv2',
      addressdetails: '1',
      zoom: '12',
      'accept-language': 'es',
      lat: String(point.lat),
      lon: String(point.lng),
    });
    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${params}`, { signal: limit() });
    if (!response.ok) return { town: '', province: '' };
    return fromAddress(((await response.json()) as { address?: Address }).address);
  } catch {
    return { town: '', province: '' };
  }
}
