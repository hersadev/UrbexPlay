import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DETAIL_KM,
  MAX_TILES,
  downloadTiles,
  estimateMb,
  loadSavedMaps,
  offlineSupported,
  saveSavedMaps,
  tilesForStops,
  type SavedMap,
} from '../offline';
import type { Place } from '../types';

const formatDay = (ms: number) => new Date(ms).toLocaleDateString('es-ES', { day: 'numeric', month: 'long' });

/** Descarga el mapa del IGN alrededor de las paradas para usarlo sin cobertura. */
export default function TripMap({ tripId, stops }: { tripId: string; stops: Place[] }) {
  const [saved, setSaved] = useState<SavedMap | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [message, setMessage] = useState('');
  const abort = useRef<AbortController>();

  const urls = useMemo(() => tilesForStops(stops), [stops]);
  const stopsKey = stops.map((p) => `${p.id}@${p.lat},${p.lng}`).join('|');

  useEffect(() => {
    loadSavedMaps().then((maps) => setSaved(maps[tripId] ?? null));
    return () => abort.current?.abort();
  }, [tripId]);

  if (!stops.length) return null;

  if (!offlineSupported()) {
    return (
      <section>
        <h2>Mapa sin cobertura</h2>
        <p className="muted">Este navegador no permite guardar mapas. Hace falta abrir la app por HTTPS.</p>
      </section>
    );
  }

  const download = async () => {
    const controller = new AbortController();
    abort.current = controller;
    setMessage('');
    setProgress({ done: 0, total: urls.length });
    try {
      const result = await downloadTiles(urls, (done, total) => setProgress({ done, total }), controller.signal);
      if (controller.signal.aborted) {
        setMessage('Descarga cancelada. Lo ya descargado se conserva.');
        return;
      }
      if (result.saved === 0) {
        setMessage('No se ha podido descargar el mapa. Comprueba la conexión.');
        return;
      }
      const entry: SavedMap = { at: Date.now(), stops: stopsKey, tiles: result.saved, failed: result.failed };
      await saveSavedMaps({ ...(await loadSavedMaps()), [tripId]: entry });
      setSaved(entry);
    } catch {
      setMessage('No se ha podido guardar el mapa. Puede que no quede espacio en el dispositivo.');
    } finally {
      setProgress(null);
    }
  };

  const tooBig = urls.length > MAX_TILES;
  const outdated = saved && saved.stops !== stopsKey;

  return (
    <section>
      <h2>Mapa sin cobertura</h2>
      {saved && (
        <p className="prose">
          {outdated ? 'Mapa guardado el ' : '✓ Mapa guardado el '}
          {formatDay(saved.at)}.
          {saved.failed > 0 && ` Faltan ${saved.failed} teselas que no se pudieron descargar.`}
          {outdated && ' Has cambiado las paradas desde entonces: vuelve a guardarlo.'}
        </p>
      )}
      {progress ? (
        <>
          <progress value={progress.done} max={progress.total} aria-label="Descarga del mapa" />
          <div className="row between">
            <span className="muted">
              {progress.done} de {progress.total} teselas
            </span>
            <button className="btn small" onClick={() => abort.current?.abort()}>
              Cancelar
            </button>
          </div>
        </>
      ) : (
        <button className="btn" onClick={download} disabled={tooBig}>
          {saved ? 'Volver a guardar el mapa' : 'Guardar mapa de esta salida'} (~{estimateMb(urls.length)} MB)
        </button>
      )}
      {tooBig && <p className="error">Demasiadas paradas para un solo mapa. Divide la salida en dos.</p>}
      {message && <p className="muted">{message}</p>}
      <p className="muted small">
        Guarda el topográfico y el satélite del IGN en {DETAIL_KM} km alrededor de cada parada, más una vista general
        de la zona. Sin cobertura, elige una de esas dos capas en el mapa: el callejero no se puede descargar. No
        incluye la carretera entre paradas.
      </p>
    </section>
  );
}
