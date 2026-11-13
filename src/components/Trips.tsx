import { useMemo } from 'react';
import { distanceKm, formatKm, googleMapsRoute, nearestOrder, pathKm } from '../geo';
import { uid } from '../store';
import { OWNERSHIP_LABEL, TYPE_META, type Data, type Place, type Trip } from '../types';

interface Props {
  data: Data;
  update: (fn: (d: Data) => Data) => void;
  places: Place[];
  openId: string | null;
  setOpenId: (id: string | null) => void;
  onOpenPlace: (id: string) => void;
  onShowOnMap: () => void;
}

const formatDate = (iso: string) =>
  iso
    ? new Date(`${iso}T12:00:00`).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })
    : 'Sin fecha';

export default function Trips({ data, update, places, openId, setOpenId, onOpenPlace, onShowOnMap }: Props) {
  const byId = useMemo(() => new Map(places.map((p) => [p.id, p])), [places]);
  const trip = data.trips.find((t) => t.id === openId);

  const patch = (id: string, change: Partial<Trip>) =>
    update((d) => ({ ...d, trips: d.trips.map((t) => (t.id === id ? { ...t, ...change } : t)) }));

  const create = () => {
    const id = uid();
    update((d) => ({ ...d, trips: [...d.trips, { id, name: '', date: '', notes: '', placeIds: [] }] }));
    setOpenId(id);
  };

  if (!trip) {
    const sorted = [...data.trips].sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
    return (
      <div className="view">
        <header className="view-head">
          <h1>Salidas</h1>
          <button className="btn primary" onClick={create}>
            + Nueva salida
          </button>
        </header>
        {sorted.length === 0 && (
          <p className="empty">
            Aún no has planificado ninguna salida. Crea una y ve añadiéndole lugares desde aquí o desde la ficha de cada
            lugar.
          </p>
        )}
        <ul className="cards">
          {sorted.map((t) => {
            const stops = t.placeIds.map((id) => byId.get(id)).filter((p): p is Place => !!p);
            return (
              <li key={t.id}>
                <button className="card" onClick={() => setOpenId(t.id)}>
                  <span className="card-body">
                    <span className="card-title">{t.name || 'Salida sin nombre'}</span>
                    <span className="muted">
                      {formatDate(t.date)} · {stops.length} {stops.length === 1 ? 'parada' : 'paradas'}
                    </span>
                    <span className="card-summary">{stops.map((p) => p.name).join(' → ')}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  const stops = trip.placeIds.map((id) => byId.get(id)).filter((p): p is Place => !!p);
  const available = places.filter((p) => !trip.placeIds.includes(p.id));
  const total = pathKm(stops);
  const privateStops = stops.filter((p) => p.practical.ownership === 'privada');
  const hardStops = stops.filter((p) => p.practical.difficulty === 3);

  const move = (index: number, delta: number) => {
    const ids = stops.map((p) => p.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    patch(trip.id, { placeIds: ids });
  };

  const remove = () => {
    if (!confirm(`¿Eliminar la salida «${trip.name || 'sin nombre'}»? Los lugares no se borran.`)) return;
    update((d) => ({ ...d, trips: d.trips.filter((t) => t.id !== trip.id) }));
    setOpenId(null);
  };

  return (
    <div className="view">
      <button className="link back" onClick={() => setOpenId(null)}>
        ← Todas las salidas
      </button>

      <label className="field">
        Nombre de la salida
        <input
          className="input title-input"
          value={trip.name}
          placeholder="Ruta minera de La Unión"
          onChange={(e) => patch(trip.id, { name: e.target.value })}
        />
      </label>
      <label className="field">
        Fecha
        <input className="input" type="date" value={trip.date} onChange={(e) => patch(trip.id, { date: e.target.value })} />
      </label>

      <div className="row between">
        <h2>Paradas ({stops.length})</h2>
        {stops.length > 2 && (
          <button
            className="btn small"
            onClick={() => patch(trip.id, { placeIds: nearestOrder(stops).map((p) => p.id) })}
            title="Mantiene la primera parada y encadena siempre la más cercana"
          >
            Ordenar por cercanía
          </button>
        )}
      </div>

      <ol className="stops">
        {stops.map((p, i) => (
          <li key={p.id} className="stop">
            <span className="stop-n" style={{ '--c': TYPE_META[p.type].color } as React.CSSProperties}>
              {i + 1}
            </span>
            <span className="card-body">
              <button className="link stop-name" onClick={() => onOpenPlace(p.id)}>
                {p.name}
              </button>
              <span className="muted">
                {p.town}
                {i > 0 && ` · ${formatKm(distanceKm(stops[i - 1], p))} desde la anterior`}
              </span>
            </span>
            <span className="stop-actions">
              <button className="icon-btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Subir parada">
                ↑
              </button>
              <button
                className="icon-btn"
                onClick={() => move(i, 1)}
                disabled={i === stops.length - 1}
                aria-label="Bajar parada"
              >
                ↓
              </button>
              <button
                className="icon-btn"
                onClick={() => patch(trip.id, { placeIds: trip.placeIds.filter((id) => id !== p.id) })}
                aria-label="Quitar parada"
              >
                ×
              </button>
            </span>
          </li>
        ))}
      </ol>

      <select
        className="input"
        value=""
        onChange={(e) => e.target.value && patch(trip.id, { placeIds: [...trip.placeIds, e.target.value] })}
        aria-label="Añadir parada"
      >
        <option value="">+ Añadir parada…</option>
        {available.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} ({p.province})
          </option>
        ))}
      </select>

      {stops.length > 0 && (
        <>
          {stops.length > 1 && (
            <p className="summary-line">
              <strong>{formatKm(total)}</strong> entre paradas en línea recta. Por carretera será más: abre la ruta para
              ver distancia y tiempo reales.
            </p>
          )}
          <div className="row">
            <a className="btn primary" href={googleMapsRoute(stops)} target="_blank" rel="noreferrer">
              Abrir ruta en Google Maps ↗
            </a>
            <button className="btn mobile-only" onClick={onShowOnMap}>
              Ver en el mapa
            </button>
          </div>
          {stops.length > 10 && (
            <p className="muted small">Google Maps solo admite 10 paradas por enlace; se incluyen las 9 primeras y la última.</p>
          )}
        </>
      )}

      {(privateStops.length > 0 || hardStops.length > 0) && (
        <div className="warn">
          <strong>Antes de salir</strong>
          <ul>
            {privateStops.map((p) => (
              <li key={p.id}>
                {p.name}: propiedad {OWNERSHIP_LABEL[p.practical.ownership].toLowerCase()}. {p.practical.access}
              </li>
            ))}
            {hardStops.map((p) => (
              <li key={p.id}>
                {p.name}: dificultad alta. {p.practical.risks}
              </li>
            ))}
          </ul>
        </div>
      )}

      <label className="field">
        Notas de la salida
        <textarea
          className="input"
          rows={4}
          placeholder="Quién viene, hora de salida, material, dónde comer…"
          value={trip.notes}
          onChange={(e) => patch(trip.id, { notes: e.target.value })}
        />
      </label>

      <footer className="row">
        <button className="btn danger" onClick={remove}>
          Eliminar salida
        </button>
      </footer>
    </div>
  );
}
