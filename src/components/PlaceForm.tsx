import { useEffect, useRef, useState } from 'react';
import { formatCoords } from '../geo';
import { parseLocation } from '../import';
import { isDate } from '../safety';
import { localDate } from '../track';
import { reverseGeocode, searchOsm, searchWikipedia, type SearchResult } from '../search';
import { sourcesToText, textToSources } from '../sources';
import { uid } from '../store';
import {
  DIFFICULTY_LABEL,
  OWNERSHIP_LABEL,
  TYPE_META,
  TYPES,
  type LatLng,
  type Ownership,
  type Place,
  type PlaceType,
} from '../types';

interface Props {
  place?: Place;
  /** Punto elegido tocando el mapa. */
  picked: LatLng | null;
  userPos: LatLng | null;
  onPick: () => void;
  onSave: (place: Place) => void;
  onCancel: () => void;
}

export default function PlaceForm({ place, picked, userPos, onPick, onSave, onCancel }: Props) {
  const editingExisting = place;
  const [name, setName] = useState(place?.name ?? '');
  const [type, setType] = useState<PlaceType>(place?.type ?? 'edificio');
  const [coords, setCoords] = useState(place ? formatCoords(place) : '');
  const [town, setTown] = useState(place?.town ?? '');
  const [province, setProvince] = useState(place?.province ?? 'Murcia');
  const [summary, setSummary] = useState(place?.summary ?? '');
  const [history, setHistory] = useState(place?.history ?? '');
  const [legend, setLegend] = useState(place?.legend ?? '');
  const [sources, setSources] = useState(sourcesToText(place?.sources ?? []));
  const [practical, setPractical] = useState(
    place?.practical ?? {
      state: '',
      access: '',
      ownership: 'desconocida' as Ownership,
      difficulty: 1 as 1 | 2 | 3,
      risks: '',
      parking: '',
      gear: '',
    },
  );
  const [parkingAt, setParkingAt] = useState(place?.parkingAt ? formatCoords(place.parkingAt) : '');
  const [entryAt, setEntryAt] = useState(place?.entryAt ? formatCoords(place.entryAt) : '');
  const [checked, setChecked] = useState(place?.checked ?? '');
  /** Campo que recibirá el punto que se elija en el mapa. */
  const pickFor = useRef<'lugar' | 'aparcamiento' | 'entrada'>('lugar');
  const [coordsTouched, setCoordsTouched] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchNote, setSearchNote] = useState('');

  const search = async () => {
    if (!query.trim() || searching) return;
    setSearching(true);
    setSearchNote('');
    setResults([]);
    // Cada fuente pinta sus resultados en cuanto llega, sin esperar a la otra.
    const run = (find: (q: string) => Promise<SearchResult[]>) =>
      find(query.trim()).then(
        (found) => {
          setResults((prev) => [...(prev ?? []), ...found]);
          return found.length;
        },
        () => -1,
      );
    const [wiki, osm] = await Promise.all([run(searchWikipedia), run(searchOsm)]);
    setSearching(false);
    if (wiki < 0 && osm < 0) setSearchNote('No se ha podido buscar. Comprueba la conexión.');
    else if (wiki <= 0 && osm <= 0) setSearchNote('Sin resultados. Prueba con otro nombre o añade el municipio.');
    else if (wiki < 0) setSearchNote('Wikipedia no ha respondido; se muestran los resultados de OpenStreetMap.');
    else if (osm < 0) setSearchNote('OpenStreetMap no ha respondido; se muestran los resultados de Wikipedia.');
  };

  /** Rellena con el resultado elegido, sin pisar lo que ya esté escrito salvo las coordenadas. */
  const applyResult = async (r: SearchResult) => {
    setResults(null);
    if (!name.trim()) setName(r.title);
    if (r.point) {
      setCoords(formatCoords(r.point));
      setCoordsTouched(true);
    }
    if (r.summary && !summary.trim()) setSummary(r.summary);
    if (r.url && !sources.includes(r.url)) {
      setSources((prev) => [prev.trim(), `Wikipedia: ${r.title} | ${r.url}`].filter(Boolean).join('\n'));
    }
    setSearchNote(
      r.point
        ? `Rellenado desde ${r.source}. Revisa los datos antes de guardar.`
        : `Este artículo no trae coordenadas: se han añadido el resumen y la fuente. Sitúa el punto en el mapa.`,
    );
    const place = r.town || r.province || !r.point ? { town: r.town ?? '', province: r.province ?? '' } : await reverseGeocode(r.point);
    if (place.town) setTown((prev) => prev.trim() || place.town);
    // «Murcia» es solo el valor por defecto de un lugar nuevo: aquí manda el resultado.
    if (place.province) setProvince((prev) => (prev.trim() && (prev !== 'Murcia' || !!editingExisting) ? prev : place.province));
  };

  /** Convierte un enlace de Google Maps o coordenadas en otro formato a «lat, lng». */
  const normalizeCoords = (value: string) => {
    try {
      const located = parseLocation(value);
      if (!located) return;
      setCoords(formatCoords(located.point));
      setCoordsTouched(true);
      if (located.name && !name.trim()) setName(located.name);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '');
    }
  };

  useEffect(() => {
    if (!picked) return;
    if (pickFor.current === 'aparcamiento') setParkingAt(formatCoords(picked));
    else if (pickFor.current === 'entrada') setEntryAt(formatCoords(picked));
    else {
      setCoords(formatCoords(picked));
      setCoordsTouched(true);
    }
  }, [picked]);

  /** Campo de un punto opcional de la ficha (aparcamiento o entrada). */
  const pointField = (
    label: string,
    value: string,
    setValue: (text: string) => void,
    target: 'aparcamiento' | 'entrada',
  ) => (
    <>
      <label className="field">
        {label}
        <input
          className="input"
          value={value}
          placeholder="Opcional: coordenadas o enlace de Google Maps"
          onChange={(e) => setValue(e.target.value)}
          onBlur={(e) => {
            try {
              const located = parseLocation(e.target.value);
              if (located) setValue(formatCoords(located.point));
            } catch {
              /* se avisa al guardar */
            }
          }}
        />
      </label>
      <div className="row">
        <button
          type="button"
          className="btn"
          onClick={() => {
            pickFor.current = target;
            onPick();
          }}
        >
          Elegir en el mapa
        </button>
        {userPos && (
          <button type="button" className="btn" onClick={() => setValue(formatCoords(userPos))}>
            Usar mi posición
          </button>
        )}
      </div>
    </>
  );

  const setP = <K extends keyof typeof practical>(key: K, value: (typeof practical)[K]) =>
    setPractical((prev) => ({ ...prev, [key]: value }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    let point = null;
    let parking: LatLng | undefined;
    let entry: LatLng | undefined;
    const optional = (text: string, what: string) => {
      if (!text.trim()) return undefined;
      const found = parseLocation(text)?.point;
      if (!found) throw new Error(`No se entienden las coordenadas ${what}.`);
      return { lat: found.lat, lng: found.lng };
    };
    try {
      point = parseLocation(coords)?.point ?? null;
      parking = optional(parkingAt, 'del aparcamiento');
      entry = optional(entryAt, 'de la entrada');
    } catch (err) {
      return setError(err instanceof Error ? err.message : '');
    }
    if (!name.trim()) return setError('Ponle un nombre al lugar.');
    if (!point) return setError('Indica las coordenadas, pega un enlace de Google Maps o elige el punto en el mapa.');
    onSave({
      id: place?.id ?? uid(),
      name: name.trim(),
      type,
      lat: point.lat,
      lng: point.lng,
      // Si no se han tocado las coordenadas, conserva el aviso de «aproximadas».
      approx: coordsTouched ? false : place?.approx,
      town: town.trim(),
      province: province.trim(),
      summary: summary.trim(),
      history: history.trim(),
      legend: legend.trim(),
      sources: textToSources(sources),
      practical,
      ...(parking && { parkingAt: parking }),
      ...(entry && { entryAt: entry }),
      ...(isDate(checked) && { checked }),
    });
  };

  return (
    <form className="view form" onSubmit={submit}>
      <header className="view-head">
        <h1>{place ? 'Editar lugar' : 'Nuevo lugar'}</h1>
        <button type="button" className="link" onClick={onCancel}>
          Cancelar
        </button>
      </header>

      <div className="search-box">
        <label className="field">
          Buscar el lugar para rellenar la ficha
          <span className="row nowrap">
            <input
              className="input grow"
              type="search"
              value={query}
              placeholder="Sanatorio Sierra Espuña"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  search();
                }
              }}
            />
            <button type="button" className="btn" onClick={search} disabled={searching || !query.trim()}>
              {searching ? 'Buscando…' : 'Buscar'}
            </button>
          </span>
        </label>
        {results && results.length > 0 && (
          <ul className="results">
            {/* Wikipedia primero: trae resumen y fuente además del punto. */}
            {[...results]
              .sort((a, b) => Number(b.source === 'Wikipedia') - Number(a.source === 'Wikipedia'))
              .map((r) => (
              <li key={r.key}>
                <button type="button" className="result" onClick={() => applyResult(r)}>
                  <span className="card-title">{r.title}</span>
                  <span className="muted small">{r.detail}</span>
                  <span className="tags">
                    <span className="tag">{r.source}</span>
                    {!r.point && <span className="tag own-desconocida">Sin coordenadas</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {searchNote && (
          <p className="muted small" role="status">
            {searchNote}
          </p>
        )}
        <p className="muted small">Busca en Wikipedia y OpenStreetMap; lo que escribas se envía a esos servicios.</p>
      </div>

      <label className="field">
        Nombre
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
      </label>

      <label className="field">
        Tipo
        <select className="input" value={type} onChange={(e) => setType(e.target.value as PlaceType)}>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_META[t].label}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        Coordenadas o enlace de Google Maps
        <input
          className="input"
          value={coords}
          placeholder="37.86833, -1.51216"
          inputMode="text"
          onChange={(e) => {
            setCoords(e.target.value);
            setCoordsTouched(true);
          }}
          onBlur={(e) => normalizeCoords(e.target.value)}
          onPaste={(e) => {
            const pasted = e.clipboardData.getData('text');
            if (/https?:|°/.test(pasted)) {
              e.preventDefault();
              setCoords(pasted);
              normalizeCoords(pasted);
            }
          }}
        />
      </label>
      <div className="row">
        <button
          type="button"
          className="btn"
          onClick={() => {
            pickFor.current = 'lugar';
            onPick();
          }}
        >
          Elegir en el mapa
        </button>
        {userPos && (
          <button
            type="button"
            className="btn"
            onClick={() => {
              setCoords(formatCoords(userPos));
              setCoordsTouched(true);
            }}
          >
            Usar mi posición
          </button>
        )}
      </div>

      <div className="grid2">
        <label className="field">
          Municipio
          <input className="input" value={town} onChange={(e) => setTown(e.target.value)} />
        </label>
        <label className="field">
          Provincia
          <input className="input" value={province} onChange={(e) => setProvince(e.target.value)} />
        </label>
      </div>

      <label className="field">
        Resumen en una línea
        <input className="input" value={summary} onChange={(e) => setSummary(e.target.value)} />
      </label>

      <label className="field">
        Historia (lo documentado)
        <textarea className="input" rows={5} value={history} onChange={(e) => setHistory(e.target.value)} />
      </label>

      <label className="field">
        Lo que se cuenta (leyendas, testimonios)
        <textarea className="input" rows={4} value={legend} onChange={(e) => setLegend(e.target.value)} />
      </label>

      <label className="field">
        Fuentes, una por línea
        <textarea
          className="input"
          rows={3}
          value={sources}
          placeholder={'Título | https://…\nLibro, artículo o «me lo contó un vecino de…»'}
          onChange={(e) => setSources(e.target.value)}
        />
      </label>

      <h2>Ficha práctica</h2>
      <label className="field">
        Estado del lugar
        <input className="input" value={practical.state} onChange={(e) => setP('state', e.target.value)} />
      </label>
      <label className="field">
        Acceso
        <textarea className="input" rows={2} value={practical.access} onChange={(e) => setP('access', e.target.value)} />
      </label>
      <div className="grid2">
        <label className="field">
          Propiedad
          <select
            className="input"
            value={practical.ownership}
            onChange={(e) => setP('ownership', e.target.value as Ownership)}
          >
            {(Object.keys(OWNERSHIP_LABEL) as Ownership[]).map((o) => (
              <option key={o} value={o}>
                {OWNERSHIP_LABEL[o]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Dificultad
          <select
            className="input"
            value={practical.difficulty}
            onChange={(e) => setP('difficulty', Number(e.target.value) as 1 | 2 | 3)}
          >
            {([1, 2, 3] as const).map((n) => (
              <option key={n} value={n}>
                {DIFFICULTY_LABEL[n]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
        Riesgos
        <textarea className="input" rows={2} value={practical.risks} onChange={(e) => setP('risks', e.target.value)} />
      </label>
      <label className="field">
        Dónde aparcar
        <input className="input" value={practical.parking} onChange={(e) => setP('parking', e.target.value)} />
      </label>
      {pointField('Punto del aparcamiento (hasta aquí se guía en coche)', parkingAt, setParkingAt, 'aparcamiento')}
      {pointField('Punto de la entrada (hasta aquí se guía a pie)', entryAt, setEntryAt, 'entrada')}
      <label className="field">
        Equipo recomendado
        <input className="input" value={practical.gear} onChange={(e) => setP('gear', e.target.value)} />
      </label>
      <label className="field">
        Comprobada sobre el terreno el
        <span className="row nowrap">
          <input
            className="input grow"
            type="date"
            value={checked}
            max={localDate()}
            onChange={(e) => setChecked(e.target.value)}
          />
          <button type="button" className="btn small" onClick={() => setChecked(localDate())}>
            Hoy
          </button>
          {checked && (
            <button type="button" className="btn small" onClick={() => setChecked('')}>
              Quitar
            </button>
          )}
        </span>
        <span className="muted small">
          Ponla solo si has estado allí y la ficha práctica coincide con lo que viste. Vacía, la ficha se enseña como
          sin verificar.
        </span>
      </label>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <footer className="row sticky">
        <button type="submit" className="btn primary">
          Guardar
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancelar
        </button>
      </footer>
    </form>
  );
}
