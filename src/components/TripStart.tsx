import { useState } from 'react';
import { reverseGeocode, searchOsm, type SearchResult } from '../search';
import type { TripStart as Start } from '../types';

interface Props {
  start: Start | undefined;
  /** Puntos de salida de otras salidas, para repetirlos con un toque. */
  suggestions: Start[];
  onChange: (start: Start | undefined) => void;
}

/** Desde dónde se sale: una dirección buscada, la ubicación actual o un origen ya usado. */
export default function TripStart({ start, suggestions, onChange }: Props) {
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [busy, setBusy] = useState<'search' | 'locate' | null>(null);
  const [note, setNote] = useState('');

  const choose = (next: Start) => {
    onChange(next);
    setEditing(false);
    setResults(null);
    setQuery('');
    setNote('');
  };

  const search = async () => {
    if (!query.trim() || busy) return;
    setBusy('search');
    setNote('');
    try {
      const found = (await searchOsm(query.trim())).filter((r) => r.point);
      setResults(found);
      if (!found.length) setNote('No se ha encontrado nada con ese nombre.');
    } catch {
      setNote('No se ha podido buscar. Comprueba la conexión.');
    } finally {
      setBusy(null);
    }
  };

  const locate = () => {
    if (!navigator.geolocation) return setNote('Este dispositivo no permite obtener la ubicación.');
    setBusy('locate');
    setNote('');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const point = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        const { town } = await reverseGeocode(point);
        setBusy(null);
        choose({ ...point, label: town || 'Mi ubicación' });
      },
      (error) => {
        setBusy(null);
        setNote(
          error.code === error.PERMISSION_DENIED
            ? 'No hay permiso para usar tu ubicación. Actívalo en los ajustes del navegador.'
            : 'No se ha podido obtener tu ubicación.',
        );
      },
      { enableHighAccuracy: false, maximumAge: 60000, timeout: 20000 },
    );
  };

  if (start && !editing) {
    return (
      <div className="row between">
        <span>
          Sales de <strong>{start.label || 'un punto del mapa'}</strong>
        </span>
        <span className="row">
          <button className="btn small" onClick={() => setEditing(true)}>
            Cambiar
          </button>
          <button className="btn small" onClick={() => onChange(undefined)}>
            Quitar
          </button>
        </span>
      </div>
    );
  }

  return (
    <div className="search-box">
      <label className="field">
        Punto de salida
        <span className="row nowrap">
          <input
            className="input grow"
            type="search"
            value={query}
            placeholder="Tu calle, pueblo o ciudad"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                search();
              }
            }}
          />
          <button type="button" className="btn" onClick={search} disabled={!!busy || !query.trim()}>
            {busy === 'search' ? 'Buscando…' : 'Buscar'}
          </button>
        </span>
      </label>
      <div className="row">
        <button className="btn small" onClick={locate} disabled={!!busy}>
          {busy === 'locate' ? 'Localizando…' : '⌖ Usar mi ubicación'}
        </button>
        {suggestions.map((s) => (
          <button key={`${s.lat},${s.lng}`} className="btn small" onClick={() => choose(s)}>
            {s.label || 'Origen anterior'}
          </button>
        ))}
        {start && (
          <button className="link" onClick={() => setEditing(false)}>
            Cancelar
          </button>
        )}
      </div>
      {results && results.length > 0 && (
        <ul className="results">
          {results.map((r) => (
            <li key={r.key}>
              <button type="button" className="result" onClick={() => choose({ ...r.point!, label: r.title })}>
                <span className="card-title">{r.title}</span>
                <span className="muted small">{r.detail}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {note && (
        <p className="muted small" role="status">
          {note}
        </p>
      )}
      {!start && (
        <p className="muted small">
          Con el punto de salida, el total cuenta la ida desde allí y la vuelta. Se guarda con la salida.
        </p>
      )}
    </div>
  );
}
