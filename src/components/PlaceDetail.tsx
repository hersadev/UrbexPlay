import { useEffect, useRef, useState } from 'react';
import { distanceKm, drivePoint, formatCoords, formatKm, googleMapsRoute } from '../geo';
import { formatDuration } from '../road';
import { deletePhoto, deleteTrack, getPhoto, getTrack, savePhoto, uid } from '../store';
import { downloadGpx, localDate, trackKm, trackMinutes } from '../track';
import {
  DIFFICULTY_LABEL,
  OWNERSHIP_LABEL,
  TYPE_META,
  emptyDiary,
  type Data,
  type Diary,
  type LatLng,
  type Notify,
  type Place,
  type Status,
  type TrackPoint,
} from '../types';

interface Props {
  place: Place;
  data: Data;
  update: (fn: (d: Data) => Data) => void;
  userPos: LatLng | null;
  isCatalog: boolean;
  /** Ficha del catálogo que nadie ha cambiado. */
  original: boolean;
  /** Texto del enlace de vuelta, según de dónde se haya llegado. */
  backLabel: string;
  /** Enlace a esta ficha; solo en las del catálogo, que existen en cualquier dispositivo. */
  shareUrl?: string;
  /** Se está grabando un recorrido: en este lugar o en otro. */
  recording: 'aqui' | 'otro' | null;
  onRecord: () => void;
  onStopRecord: () => void;
  onShowTrack: (points: TrackPoint[], label: string) => void;
  notify: Notify;
  /** El visor de fotos está abierto (lo decide la URL, para que «atrás» lo cierre). */
  viewer: boolean;
  onOpenViewer: () => void;
  onCloseViewer: () => void;
  onBack: () => void;
  onShowOnMap: () => void;
  onGuide: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onRestore: () => void;
}

/** URL local de una foto guardada; se libera al dejar de usarla. */
function usePhotoUrl(id: string) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    setUrl(undefined);
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
  return url;
}

function Photo({ id, onOpen, onDelete }: { id: string; onOpen: () => void; onDelete: () => void }) {
  const url = usePhotoUrl(id);
  if (!url) return null;
  return (
    <span className="photo">
      <button className="photo-open" onClick={onOpen} aria-label="Ver la foto a pantalla completa">
        <img src={url} alt="Foto de la visita" />
      </button>
      <button className="photo-del" onClick={onDelete} aria-label="Borrar foto">
        ×
      </button>
    </span>
  );
}

/** Visor a pantalla completa de las fotos de una visita. */
function Viewer({
  ids,
  index,
  onIndex,
  onClose,
}: {
  ids: string[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
}) {
  const url = usePhotoUrl(ids[index]);
  const touchX = useRef<number | null>(null);
  const step = (delta: number) => {
    const next = index + delta;
    if (next >= 0 && next < ids.length) onIndex(next);
  };
  const live = useRef({ step, onClose });
  live.current = { step, onClose };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') live.current.onClose();
      if (e.key === 'ArrowLeft') live.current.step(-1);
      if (e.key === 'ArrowRight') live.current.step(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div
      className="viewer"
      role="dialog"
      aria-modal="true"
      aria-label="Foto de la visita"
      onClick={onClose}
      onTouchStart={(e) => (touchX.current = e.touches.length === 1 ? e.touches[0].clientX : null)}
      onTouchEnd={(e) => {
        if (touchX.current === null) return;
        const dx = e.changedTouches[0].clientX - touchX.current;
        touchX.current = null;
        if (Math.abs(dx) > 60) step(dx < 0 ? 1 : -1);
      }}
    >
      {url && <img src={url} alt={`Foto ${index + 1} de ${ids.length}`} onClick={(e) => e.stopPropagation()} />}
      <button className="viewer-btn viewer-close" onClick={onClose} aria-label="Cerrar">
        ×
      </button>
      {ids.length > 1 && (
        <>
          <button
            className="viewer-btn viewer-prev"
            onClick={(e) => {
              e.stopPropagation();
              step(-1);
            }}
            disabled={index === 0}
            aria-label="Foto anterior"
          >
            ‹
          </button>
          <button
            className="viewer-btn viewer-next"
            onClick={(e) => {
              e.stopPropagation();
              step(1);
            }}
            disabled={index === ids.length - 1}
            aria-label="Foto siguiente"
          >
            ›
          </button>
          <span className="viewer-count">
            {index + 1} / {ids.length}
          </span>
        </>
      )}
    </div>
  );
}

function Track({
  id,
  name,
  onShow,
  onDelete,
}: {
  id: string;
  name: string;
  onShow: (points: TrackPoint[]) => void;
  onDelete: () => void;
}) {
  const [points, setPoints] = useState<TrackPoint[] | null>();
  useEffect(() => {
    let cancelled = false;
    getTrack(id).then((found) => !cancelled && setPoints(found ?? null));
    return () => {
      cancelled = true;
    };
  }, [id]);
  if (points === undefined) return null;
  if (!points) return <p className="muted small">El recorrido de esta visita se grabó en otro dispositivo.</p>;
  return (
    <div className="track">
      <span>
        Recorrido: <strong>{formatKm(trackKm(points))}</strong> · {formatDuration(trackMinutes(points))}
      </span>
      <span className="row">
        <button className="btn small" onClick={() => onShow(points)}>
          Ver en el mapa
        </button>
        <button className="btn small" onClick={() => downloadGpx(name, points)}>
          Exportar GPX
        </button>
        <button className="link danger" onClick={onDelete}>
          Borrar
        </button>
      </span>
    </div>
  );
}

const today = () => localDate();

export default function PlaceDetail({
  place,
  data,
  update,
  userPos,
  isCatalog,
  original,
  backLabel,
  shareUrl,
  recording,
  onRecord,
  onStopRecord,
  onShowTrack,
  notify,
  viewer,
  onOpenViewer,
  onCloseViewer,
  onBack,
  onShowOnMap,
  onGuide,
  onEdit,
  onRemove,
  onRestore,
}: Props) {
  const meta = TYPE_META[place.type];
  const diary = data.diary[place.id] ?? emptyDiary();
  const p = place.practical;
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  /** Fotos que enseña el visor y cuál de ellas. */
  const [shown, setShown] = useState<{ ids: string[]; index: number } | null>(null);
  const openViewer = (ids: string[], index: number) => {
    setShown({ ids, index });
    onOpenViewer();
  };
  // La URL dice «visor abierto» pero no hay foto elegida (recarga): se vuelve a la ficha.
  useEffect(() => {
    if (viewer && !shown) onCloseViewer();
    if (!viewer && shown) setShown(null);
    // Solo al cambiar la URL.
  }, [viewer]);

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
    const index = diary.visits.findIndex((v) => v.id === id);
    const visit = diary.visits[index];
    if (!visit) return;
    setDiary((d) => ({ ...d, visits: d.visits.filter((v) => v.id !== id) }));
    // Las fotos y el recorrido no se borran hasta que pasa el plazo para deshacer.
    notify('Visita borrada.', {
      undo: () =>
        setDiary((d) => {
          if (d.visits.some((v) => v.id === id)) return d;
          const visits = [...d.visits];
          visits.splice(Math.min(index, visits.length), 0, visit);
          return { ...d, visits };
        }),
      commit: () => {
        visit.photos.forEach(deletePhoto);
        if (visit.track) deleteTrack(visit.track);
      },
    });
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
      notify('No se ha podido guardar alguna de las fotos.');
    } finally {
      setBusy(false);
    }
  };

  const removeTrack = (visitId: string, trackId: string) => {
    notify('Recorrido borrado.', {
      undo: () =>
        setDiary((d) => ({
          ...d,
          visits: d.visits.map((v) => (v.id === visitId && !v.track ? { ...v, track: trackId } : v)),
        })),
      commit: () => deleteTrack(trackId),
    });
    setDiary((d) => ({
      ...d,
      visits: d.visits.map((v) => {
        if (v.id !== visitId) return v;
        const { track: _gone, ...rest } = v;
        return rest;
      }),
    }));
  };

  const removePhoto = (visitId: string, photoId: string) => {
    const index = diary.visits.find((v) => v.id === visitId)?.photos.indexOf(photoId) ?? 0;
    notify('Foto borrada.', {
      undo: () =>
        setDiary((d) => ({
          ...d,
          visits: d.visits.map((v) => {
            if (v.id !== visitId || v.photos.includes(photoId)) return v;
            const photos = [...v.photos];
            photos.splice(Math.min(index, photos.length), 0, photoId);
            return { ...v, photos };
          }),
        })),
      commit: () => deletePhoto(photoId),
    });
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

  const [shared, setShared] = useState(false);
  const share = async () => {
    if (!shareUrl) return;
    try {
      if (navigator.share) return await navigator.share({ title: place.name, url: shareUrl });
      await navigator.clipboard.writeText(shareUrl);
      setShared(true);
      setTimeout(() => setShared(false), 1500);
    } catch {
      /* se ha cancelado el menú de compartir */
    }
  };

  const inTrips = data.trips.filter((t) => t.placeIds.includes(place.id));
  const edited = isCatalog && !original;

  const remove = () => {
    // Sin pregunta previa: el aviso que sale después permite deshacerlo.
    onRemove();
  };

  return (
    <article className="view detail">
      <button className="link back" onClick={onBack}>
        {backLabel}
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
        <button className="btn" onClick={onGuide} title="Sigue tu posición y te lleva hasta el lugar: en coche al aparcamiento y a pie hasta la entrada">
          ⌖ Guiarme
        </button>
        <a className="btn" href={googleMapsRoute([drivePoint(place)])} target="_blank" rel="noreferrer">
          Cómo llegar ↗
        </a>
        {shareUrl && (
          <button className="btn" onClick={share}>
            {shared ? 'Enlace copiado' : 'Compartir'}
          </button>
        )}
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
          {place.parkingAt && (
            <>
              <dt>Punto para aparcar</dt>
              <dd>{formatCoords(place.parkingAt)}</dd>
            </>
          )}
          {place.entryAt && (
            <>
              <dt>Entrada</dt>
              <dd>{formatCoords(place.entryAt)}</dd>
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
        {original && (
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
          <span className="row">
            {recording === 'aqui' ? (
              <button className="btn danger" onClick={onStopRecord}>
                ■ Terminar grabación
              </button>
            ) : (
              <button
                className="btn"
                onClick={onRecord}
                disabled={recording === 'otro'}
                title="Graba por dónde te mueves y lo guarda en una visita, para verlo en el mapa o exportarlo en GPX"
              >
                ● Grabar recorrido
              </button>
            )}
            <button className="btn" onClick={addVisit}>
              + Registrar visita
            </button>
          </span>
        </div>
        {recording === 'aqui' && (
          <p className="muted small">
            Grabando. Mantén la app abierta y a la vista: con la pantalla apagada o en otra app el GPS se detiene.
          </p>
        )}

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
            {v.track && (
              <Track
                id={v.track}
                name={`${place.name} ${v.date}`.trim()}
                onShow={(points) => onShowTrack(points, `${place.name}${v.date ? ` · ${v.date}` : ''}`)}
                onDelete={() => removeTrack(v.id, v.track!)}
              />
            )}
            <div className="photos">
              {v.photos.map((id, i) => (
                <Photo key={id} id={id} onOpen={() => openViewer(v.photos, i)} onDelete={() => removePhoto(v.id, id)} />
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

      {viewer && shown && (
        <Viewer
          ids={shown.ids}
          index={shown.index}
          onIndex={(index) => setShown({ ids: shown.ids, index })}
          onClose={onCloseViewer}
        />
      )}

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
