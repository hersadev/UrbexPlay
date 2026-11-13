import { useEffect, useMemo, useState } from 'react';
import { isCatalogId } from '../catalog';
import { distanceKm, formatKm } from '../geo';
import { TYPE_META, TYPES, type Diary, type LatLng, type Place, type PlaceType, type Status } from '../types';

interface Props {
  places: Place[];
  diary: Record<string, Diary>;
  userPos: LatLng | null;
  onLocate: () => void;
  onOpen: (id: string) => void;
  onAdd: () => void;
  onImport: () => void;
  /** Informa de los lugares que pasan el filtro, para pintar solo esos en el mapa. */
  onVisible: (places: Place[]) => void;
}

const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

const RADII = [0, 25, 50, 100, 200];

export default function PlaceList({ places, diary, userPos, onLocate, onOpen, onAdd, onImport, onVisible }: Props) {
  const [query, setQuery] = useState('');
  const [types, setTypes] = useState<Set<PlaceType>>(new Set());
  const [province, setProvince] = useState('');
  const [status, setStatus] = useState<Status | ''>('');
  const [radius, setRadius] = useState(0);
  const [onlyLegend, setOnlyLegend] = useState(false);

  const provinces = useMemo(
    () => [...new Set(places.map((p) => p.province))].sort((a, b) => a.localeCompare(b, 'es')),
    [places],
  );

  const shown = useMemo(() => {
    const q = normalize(query.trim());
    const rows = places
      .map((place) => ({ place, km: userPos ? distanceKm(userPos, place) : null }))
      .filter(({ place, km }) => {
        if (types.size && !types.has(place.type)) return false;
        if (province && place.province !== province) return false;
        if (status && (diary[place.id]?.status ?? 'ninguno') !== status) return false;
        if (onlyLegend && !place.legend.trim()) return false;
        if (radius && km !== null && km > radius) return false;
        if (q && !normalize(`${place.name} ${place.town} ${place.province} ${place.summary}`).includes(q)) return false;
        return true;
      });
    if (userPos) rows.sort((a, b) => a.km! - b.km!);
    return rows;
  }, [places, diary, userPos, query, types, province, status, radius, onlyLegend]);

  useEffect(() => onVisible(shown.map((r) => r.place)), [shown, onVisible]);

  const toggleType = (t: PlaceType) =>
    setTypes((prev) => {
      const next = new Set(prev);
      if (!next.delete(t)) next.add(t);
      return next;
    });

  const filtering = !!(query || types.size || province || status || radius || onlyLegend);

  return (
    <div className="view">
      <header className="view-head">
        <h1>Lugares</h1>
        <span className="row">
          <button className="btn" onClick={onImport}>
            Importar
          </button>
          <button className="btn primary" onClick={onAdd}>
            + Añadir
          </button>
        </span>
      </header>

      <input
        className="input"
        type="search"
        placeholder="Buscar por nombre, pueblo o provincia"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Buscar lugares"
      />

      <div className="chips" role="group" aria-label="Tipo de lugar">
        {TYPES.map((t) => (
          <button
            key={t}
            className="chip"
            aria-pressed={types.has(t)}
            style={{ '--c': TYPE_META[t].color } as React.CSSProperties}
            onClick={() => toggleType(t)}
          >
            <span aria-hidden="true">{TYPE_META[t].glyph}</span> {TYPE_META[t].label}
          </button>
        ))}
      </div>

      <div className="filters">
        <select className="input" value={province} onChange={(e) => setProvince(e.target.value)} aria-label="Provincia">
          <option value="">Todas las provincias</option>
          {provinces.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <select
          className="input"
          value={status}
          onChange={(e) => setStatus(e.target.value as Status | '')}
          aria-label="Estado en mi diario"
        >
          <option value="">Cualquier estado</option>
          <option value="pendiente">Pendientes</option>
          <option value="visitado">Visitados</option>
          <option value="ninguno">Sin marcar</option>
        </select>
        {userPos ? (
          <select
            className="input"
            value={radius}
            onChange={(e) => setRadius(Number(e.target.value))}
            aria-label="Distancia desde mi posición"
          >
            {RADII.map((r) => (
              <option key={r} value={r}>
                {r ? `A menos de ${r} km` : 'A cualquier distancia'}
              </option>
            ))}
          </select>
        ) : (
          <button className="btn" onClick={onLocate}>
            ⌖ Cerca de mí
          </button>
        )}
        <label className="check">
          <input type="checkbox" checked={onlyLegend} onChange={(e) => setOnlyLegend(e.target.checked)} />
          Con leyenda
        </label>
      </div>

      <p className="muted count">
        {shown.length} de {places.length} lugares
        {userPos && ' · ordenados por cercanía (línea recta)'}
        {filtering && (
          <button
            className="link"
            onClick={() => {
              setQuery('');
              setTypes(new Set());
              setProvince('');
              setStatus('');
              setRadius(0);
              setOnlyLegend(false);
            }}
          >
            Quitar filtros
          </button>
        )}
      </p>

      <ul className="cards">
        {shown.map(({ place, km }) => {
          const meta = TYPE_META[place.type];
          const st = diary[place.id]?.status ?? 'ninguno';
          return (
            <li key={place.id}>
              <button className="card" onClick={() => onOpen(place.id)}>
                <span className="pin static" style={{ '--c': meta.color } as React.CSSProperties} aria-hidden="true">
                  {meta.glyph}
                </span>
                <span className="card-body">
                  <span className="card-title">{place.name}</span>
                  <span className="muted">
                    {place.town} · {place.province}
                    {km !== null && ` · ${formatKm(km)}`}
                  </span>
                  <span className="card-summary">{place.summary}</span>
                  <span className="tags">
                    {st !== 'ninguno' && <span className={`tag ${st}`}>{st === 'visitado' ? 'Visitado' : 'Pendiente'}</span>}
                    {place.legend.trim() && <span className="tag">Leyenda</span>}
                    {place.custom && !isCatalogId(place.id) && <span className="tag">Mío</span>}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {shown.length === 0 && <p className="empty">Ningún lugar coincide con estos filtros.</p>}
    </div>
  );
}
