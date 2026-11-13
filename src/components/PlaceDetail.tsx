import { useEffect, useState } from 'react';
import { distanceKm, formatCoords, formatKm, googleMapsRoute } from '../geo';
import { deletePhoto, getPhoto, savePhoto, uid } from '../store';
import {
  DIFFICULTY_LABEL,
  OWNERSHIP_LABEL,
  TYPE_META,
  emptyDiary,
  type Data,
  type Diary,
  type LatLng,
  type Place,
  type Status,
} from '../types';

interface Props {
  place: Place;
  data: Data;
  update: (fn: (d: Data) => Data) => void;
  userPos: LatLng | null;
  isCatalog: boolean;
  onBack: () => void;
  onShowOnMap: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onRestore: () => void;
}

function Photo({ id, onDelete }: { id: string; onDelete: () => void }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let objectUrl: string | undefined;
    let cancelled = false;
    getPhoto(id).then((blob) => {
      if (blob && !cancelled) {
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      }
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id]);
  if (!url) return null;
  return (
    <span className="photo">
      <a href={url} target="_blank" rel="noreferrer">
        <img src={url} alt="Foto de la visita" />
      </a>
      <button className="photo-del" onClick={onDelete} aria-label="Borrar foto">
        ×
      </button>
    </span>
  );
}

const today = () => new Date().toISOString().slice(0, 10);

export default function PlaceDetail({
  place,
  data,
  update,
  userPos,
  isCatalog,
  onBack,
  onShowOnMap,
  onEdit,
  onRemove,
  onRestore,
}: Props) {
  const meta = TYPE_META[place.type];
  const diary = data.diary[place.id] ?? emptyDiary();
  const p = place.practical;
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const setDiary = (fn: (d: Diary) => Diary) =>
    update((d) => ({ ...d, diary: { ...d.diary, [place.id]: fn(d.diary[place.id] ?? emptyDiary()) } }));

  const setStatus = (status: Status) =>
    setDiary((d) => ({ ...d, status: d.status === status ? 'ninguno' : status }));

  const addVisit = () =>
    setDiary((d) => ({
      ...d,
      status: 'visitado',
      visits: [{ id: uid(), date: today(), notes: '', photos: [] }, ...d.visits],
    }));

  const patchVisit = (id: string, patch: Partial<Diary['visits'][number]>) =>
    setDiary((d) => ({ ...d, visits: d.visits.map((v) => (v.id === id ? { ...v, ...patch } : v)) }));

  const removeVisit = (id: string) => {
    if (!confirm('¿Borrar esta visita y sus fotos?')) return;
    diary.visits.find((v) => v.id === id)?.photos.forEach(deletePhoto);
    setDiary((d) => ({ ...d, visits: d.visits.filter((v) => v.id !== id) }));
  };

  const addPhotos = async (visitId: string, files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      const ids: string[] = [];
      for (const file of Array.from(files)) ids.push(await savePhoto(file));
      setDiary((d) => ({
        ...d,
        visits: d.visits.map((v) => (v.id === visitId ? { ...v, photos: [...v.photos, ...ids] } : v)),
      }));
    } catch {
      alert('No se ha podido guardar alguna de las fotos.');
    } finally {
      setBusy(false);
    }
  };

  const removePhoto = (visitId: string, photoId: string) => {
    deletePhoto(photoId);
    setDiary((d) => ({
      ...d,
      visits: d.visits.map((v) => (v.id === visitId ? { ...v, photos: v.photos.filter((x) => x !== photoId) } : v)),
    }));
  };

  const addToTrip = (tripId: string) => {
    if (!tripId) return;
    update((d) => {
      if (tripId === 'nueva') {
        return {
          ...d,
          trips: [...d.trips, { id: uid(), name: `Salida a ${place.name}`, date: '', notes: '', placeIds: [place.id] }],
        };
      }
      return {
        ...d,
        trips: d.trips.map((t) =>
          t.id === tripId && !t.placeIds.includes(place.id) ? { ...t, placeIds: [...t.placeIds, place.id] } : t,
        ),
      };
    });
  };

  const inTrips = data.trips.filter((t) => t.placeIds.includes(place.id));
  const edited = isCatalog && place.custom;

  const remove = () => {
    const message = isCatalog
      ? `¿Ocultar «${place.name}»? Podrás recuperarlo desde Ajustes. Se borrarán tus notas de este lugar.`
      : `¿Eliminar «${place.name}» y tus notas de este lugar? No se puede deshacer.`;
    if (confirm(message)) {
      diary.visits.forEach((v) => v.photos.forEach(deletePhoto));
      onRemove();
    }
  };

  return (
    <article className="view detail">
      <button className="link back" onClick={onBack}>
        ← Todos los lugares
      </button>

      <header>
        <span className="kind" style={{ '--c': meta.color } as React.CSSProperties}>
          <span aria-hidden="true">{meta.glyph}</span> {meta.label}
        </span>
        <h1>{place.name}</h1>
        <p className="muted">
          {place.town} · {place.province}
          {userPos && ` · a ${formatKm(distanceKm(userPos, place))} en línea recta`}
        </p>
      </header>

      <p className="lead">{place.summary}</p>

      <div className="row">
        <button className="btn toggle" aria-pressed={diary.status === 'pendiente'} onClick={() => setStatus('pendiente')}>
          ☆ Pendiente
        </button>
        <button className="btn toggle" aria-pressed={diary.status === 'visitado'} onClick={() => setStatus('visitado')}>
          ✓ Visitado
        </button>
      </div>

      <div className="row">
        <button className="btn" onClick={onShowOnMap}>
          Ver en el mapa
        </button>
        <a className="btn" href={googleMapsRoute([place])} target="_blank" rel="noreferrer">
          Cómo llegar ↗
        </a>
        <select className="input grow" value="" onChange={(e) => addToTrip(e.target.value)} aria-label="Añadir a una salida">
          <option value="">Añadir a una salida…</option>
          {data.trips.map((t) => (
            <option key={t.id} value={t.id} disabled={t.placeIds.includes(place.id)}>
              {t.name || 'Salida sin nombre'}
            </option>
          ))}
          <option value="nueva">+ Nueva salida</option>
        </select>
      </div>
      {inTrips.length > 0 && (
        <p className="muted small">En: {inTrips.map((t) => t.name || 'Salida sin nombre').join(', ')}</p>
      )}

      {place.history.trim() && (
        <section>
          <h2>Historia</h2>
          <p className="prose">{place.history}</p>
        </section>
      )}

      {place.legend.trim() && (
        <section className="legend">
          <h2>Lo que se cuenta</h2>
          <p className="prose">{place.legend}</p>
          <p className="muted small">Leyenda o tradición oral: no es un hecho contrastado.</p>
        </section>
      )}

      <section>
        <h2>Fuentes</h2>
        {place.sources.length ? (
          <ul className="sources">
            {place.sources.map((s) => (
              <li key={s.url + s.title}>
                {s.url ? (
                  <a href={s.url} target="_blank" rel="noreferrer">
                    {s.title || s.url} ↗
                  </a>
                ) : (
                  s.title
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Sin fuentes. Trata esta información como no contrastada.</p>
        )}
      </section>

      <section>
        <h2>Ficha práctica</h2>
        <dl className="facts">
          {p.state && (
            <>
              <dt>Estado</dt>
              <dd>{p.state}</dd>
            </>
          )}
          {p.access && (
            <>
              <dt>Acceso</dt>
              <dd>{p.access}</dd>
            </>
          )}
          <dt>Propiedad</dt>
          <dd>
            <span className={`tag own-${p.ownership}`}>{OWNERSHIP_LABEL[p.ownership]}</span>
          </dd>
          <dt>Dificultad</dt>
          <dd>
            <span className={`tag diff-${p.difficulty}`}>{DIFFICULTY_LABEL[p.difficulty]}</span>
          </dd>
          {p.risks && (
            <>
              <dt>Riesgos</dt>
              <dd>{p.risks}</dd>
            </>
          )}
          {p.parking && (
            <>
              <dt>Aparcar</dt>
              <dd>{p.parking}</dd>
            </>
          )}
          {p.gear && (
            <>
              <dt>Equipo</dt>
              <dd>{p.gear}</dd>
            </>
          )}
          <dt>Coordenadas</dt>
          <dd>
            <button
              className="link"
              onClick={() =>
                navigator.clipboard?.writeText(formatCoords(place)).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                })
              }
              title="Copiar"
            >
              {formatCoords(place)}
            </button>{' '}
            {copied && <span className="muted small">copiadas</span>}
            {place.approx && <span className="tag own-desconocida">Aproximadas</span>}
          </dd>
        </dl>
        {!place.custom && (
          <p className="muted small">
            Datos orientativos del catálogo: el estado, los accesos y la titularidad cambian. Confírmalos antes de ir y
            corrige la ficha con lo que veas.
          </p>
        )}
      </section>

      <section>
        <h2>Mi diario</h2>
        <label className="field">
          Notas
          <textarea
            className="input"
            rows={3}
            placeholder="Contactos, ideas para la visita, mejor hora de luz…"
            value={diary.notes}
            onChange={(e) => setDiary((d) => ({ ...d, notes: e.target.value }))}
          />
        </label>

        <div className="row between">
          <h3>Visitas ({diary.visits.length})</h3>
          <button className="btn" onClick={addVisit}>
            + Registrar visita
          </button>
        </div>

        {diary.visits.map((v) => (
          <div className="visit" key={v.id}>
            <div className="row between">
              <input
                className="input"
                type="date"
                value={v.date}
                onChange={(e) => patchVisit(v.id, { date: e.target.value })}
                aria-label="Fecha de la visita"
              />
              <button className="link danger" onClick={() => removeVisit(v.id)}>
                Borrar visita
              </button>
            </div>
            <textarea
              className="input"
              rows={3}
              placeholder="Qué encontraste, cómo estaba el acceso, qué repetirías…"
              value={v.notes}
              onChange={(e) => patchVisit(v.id, { notes: e.target.value })}
              aria-label="Notas de la visita"
            />
            <div className="photos">
              {v.photos.map((id) => (
                <Photo key={id} id={id} onDelete={() => removePhoto(v.id, id)} />
              ))}
              <label className="photo add">
                {busy ? '…' : '+ Fotos'}
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  disabled={busy}
                  onChange={(e) => {
                    addPhotos(v.id, e.target.files);
                    e.target.value = '';
                  }}
                />
              </label>
            </div>
          </div>
        ))}
      </section>

      <footer className="row">
        <button className="btn" onClick={onEdit}>
          Editar ficha
        </button>
        {edited && (
          <button
            className="btn"
            onClick={() => confirm('¿Descartar tus cambios y volver a la ficha original del catálogo?') && onRestore()}
          >
            Restaurar original
          </button>
        )}
        <button className="btn danger" onClick={remove}>
          {isCatalog ? 'Ocultar lugar' : 'Eliminar lugar'}
        </button>
      </footer>
    </article>
  );
}
