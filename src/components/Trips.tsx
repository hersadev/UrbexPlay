import { useMemo } from 'react';
import { gearList } from '../gear';
import { distanceKm, drivePoint, formatKm, googleMapsRoute, nearestOrder, pathKm } from '../geo';
import { loadSavedMaps, saveSavedMaps } from '../offline';
import { formatDuration, tripPoints, useRoadRoute } from '../road';
import { uid } from '../store';
import { formatTime, sunTimes } from '../sun';
import TripMap from './TripMap';
import TripStart from './TripStart';
import { OWNERSHIP_LABEL, TYPE_META, type Data, type LatLng, type Place, type Trip } from '../types';

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
  const stops = useMemo(
    () => (trip ? trip.placeIds.map((id) => byId.get(id)).filter((p): p is Place => !!p) : []),
    [trip, byId],
  );
  // En coche se va hasta el aparcamiento de cada parada, si la ficha lo indica.
  const points = useMemo(() => tripPoints(trip?.start, stops.map(drivePoint)), [trip?.start, stops]);
  const road = useRoadRoute(points);
  const gear = useMemo(() => gearList(stops), [stops]);

  const patch = (id: string, change: Partial<Trip>) =>
    update((d) => ({ ...d, trips: d.trips.map((t) => (t.id === id ? { ...t, ...change } : t)) }));

  const create = () => {
    const id = uid();
    // Lo habitual es salir siempre del mismo sitio: la nueva hereda el último origen usado.
    const start = [...data.trips].reverse().find((t) => t.start)?.start;
    update((d) => ({
      ...d,
      trips: [...d.trips, { id, name: '', date: '', notes: '', placeIds: [], ...(start && { start }) }],
    }));
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

  const available = places.filter((p) => !trip.placeIds.includes(p.id));
  const start = trip.start;
  const legs = road.status === 'ok' ? road.route.legs : null;
  /** Tramo que llega a la parada `i`; con origen, el primero sale de él. */
  const legTo = (i: number) => legs?.[start ? i : i - 1];
  const before = (i: number): LatLng | undefined => (i > 0 ? stops[i - 1] : start);
  const back = start ? legs?.[stops.length] : undefined;
  const roadKm = legs?.reduce((sum, leg) => sum + leg.km, 0) ?? 0;
  const roadMinutes = legs?.reduce((sum, leg) => sum + leg.minutes, 0) ?? 0;

  const startOptions = data.trips
    .map((t) => t.start)
    .filter((s, i, all): s is NonNullable<typeof s> => {
      if (!s || (start && s.lat === start.lat && s.lng === start.lng)) return false;
      return all.findIndex((o) => o && o.lat === s.lat && o.lng === s.lng) === i;
    })
    .slice(-3);

  const packed = new Set(trip.packed ?? []);
  const packedCount = gear.filter((item) => packed.has(item.key)).length;
  const togglePacked = (key: string) => {
    // Se guardan solo los objetos de la lista actual: los de paradas quitadas se olvidan.
    const next = gear.map((item) => item.key).filter((k) => (k === key ? !packed.has(k) : packed.has(k)));
    patch(trip.id, { packed: next });
  };
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
    loadSavedMaps().then(({ [trip.id]: _gone, ...rest }) => saveSavedMaps(rest));
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

      <TripStart start={start} suggestions={startOptions} onChange={(next) => patch(trip.id, { start: next })} />

      <div className="row between">
        <h2>Paradas ({stops.length})</h2>
        {stops.length > 2 && (
          <button
            className="btn small"
            onClick={() =>
              patch(trip.id, {
                placeIds: (start ? nearestOrder<LatLng>([start, ...stops]).slice(1) : nearestOrder(stops)).map(
                  (p) => (p as Place).id,
                ),
              })
            }
            title={
              start
                ? 'Desde el punto de salida, encadena siempre la parada más cercana'
                : 'Mantiene la primera parada y encadena siempre la más cercana'
            }
          >
            Ordenar por cercanía
          </button>
        )}
      </div>

      <ol className="stops">
        {stops.map((p, i) => {
          const from = before(i);
          const leg = legTo(i);
          const sun = sunTimes(trip.date, p);
          return (
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
                  {from &&
                    ` · ${
                      leg
                        ? `${formatKm(leg.km)} · ${formatDuration(leg.minutes)}`
                        : `${formatKm(distanceKm(from, p))} en línea recta`
                    } desde ${i > 0 ? 'la anterior' : 'el punto de salida'}`}
                </span>
                {sun && (
                  <span className="muted stop-sun">
                    ☀ {formatTime(sun.sunrise)}–{formatTime(sun.sunset)} · dorada hasta {formatTime(sun.goldenMorningEnd)}{' '}
                    y desde {formatTime(sun.goldenEveningStart)}
                  </span>
                )}
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
          );
        })}
      </ol>
      {stops.length > 0 && (
        <p className="muted small">
          {trip.date
            ? '☀ Amanecer y atardecer de ese día en cada parada, con horizonte llano. Hora dorada: el sol a menos de 6° de altura.'
            : 'Pon fecha a la salida para ver el amanecer, el atardecer y la hora dorada de cada parada.'}
        </p>
      )}

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
          {points.length > 1 && (
            <p className="summary-line" role="status">
              {legs ? (
                <>
                  <strong>
                    {formatKm(roadKm)} · {formatDuration(roadMinutes)}
                  </strong>{' '}
                  al volante
                  {start
                    ? `, ida y vuelta desde ${start.label || 'el punto de salida'}.`
                    : ' entre paradas. Indica el punto de salida para contar también la ida y la vuelta.'}
                  {back && ` La vuelta desde la última parada: ${formatKm(back.km)} · ${formatDuration(back.minutes)}.`}
                </>
              ) : road.status === 'error' ? (
                <>
                  <strong>{formatKm(pathKm(points))}</strong> en línea recta. No se ha podido calcular la ruta por
                  carretera: hace falta conexión.
                </>
              ) : (
                'Calculando la ruta por carretera…'
              )}
            </p>
          )}
          <div className="row">
            <a className="btn primary" href={googleMapsRoute(stops.map(drivePoint), start)} target="_blank" rel="noreferrer">
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

      {stops.length > 0 && (
        <section>
          <h2>Equipo{gear.length > 0 && ` (${packedCount} de ${gear.length})`}</h2>
          {gear.length > 0 ? (
            <ul className="gear">
              {gear.map((item) => (
                <li key={item.key}>
                  <label className="check gear-item">
                    <input type="checkbox" checked={packed.has(item.key)} onChange={() => togglePacked(item.key)} />
                    <span className="card-body">
                      <span className="gear-label">{item.label}</span>
                      <span className="muted small">{item.wanted.join(' · ')}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">
              Ninguna parada indica equipo. Rellena «Equipo recomendado» en la ficha de cada lugar y la lista se
              generará sola.
            </p>
          )}
        </section>
      )}

      <TripMap tripId={trip.id} stops={stops} />

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
