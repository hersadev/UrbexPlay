import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CATALOG, isCatalogId, isOriginal } from './catalog';
import { emptyData, loadData, saveData, stampChanges } from './store';
import { cardinal, distanceKm, formatKm, nearestOnLine } from './geo';
import { formatDuration, tripPoints, useRoadRoute } from './road';
import { loadSyncConfig, mergeRemote, pushPull, saveSyncConfig, type SyncConfig, type SyncStatus } from './sync';
import { paths, useNav, type Tab } from './nav';
import type { Data, LatLng, Place, Position } from './types';
import MapView, { type Focus } from './components/MapView';
import PlaceList from './components/PlaceList';
import PlaceDetail from './components/PlaceDetail';
import PlaceForm from './components/PlaceForm';
import ImportPlaces from './components/ImportPlaces';
import Trips from './components/Trips';
import Settings from './components/Settings';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'mapa', label: 'Mapa', icon: '◎' },
  { id: 'lugares', label: 'Lugares', icon: '☰' },
  { id: 'salidas', label: 'Salidas', icon: '⇢' },
  { id: 'ajustes', label: 'Ajustes', icon: '⚙︎' },
];

const CATALOG_IDS = new Set(CATALOG.map((p) => p.id));

export default function App() {
  const [data, setData] = useState<Data>(emptyData);
  const [loaded, setLoaded] = useState(false);
  // La pantalla abierta sale de la URL (ver nav.ts): el botón atrás del móvil la deshace paso a paso.
  const nav = useNav();
  const { tab, importing, picking, tripOnMap } = nav.route;
  const detailId = nav.route.placeId;
  const openTripId = nav.route.tripId;
  const [picked, setPicked] = useState<LatLng | null>(null);
  const [visible, setVisible] = useState<Place[] | null>(null);
  const [userPos, setUserPos] = useState<Position | null>(null);
  /** Seguimiento continuo del GPS activo. */
  const [tracking, setTracking] = useState(false);
  /** El mapa acompaña a la posición (se suelta al mover el mapa a mano). */
  const [follow, setFollow] = useState(false);
  /** Lugar hacia el que se guía. */
  const [targetId, setTargetId] = useState<string | null>(null);
  const [focus, setFocus] = useState<Focus | null>(null);
  const [notice, setNotice] = useState('');

  const [syncConfig, setSyncConfig] = useState<SyncConfig | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ state: 'off' });
  // La sincronización corre fuera del ciclo de render: lee siempre lo último por referencia.
  const live = useRef({ data, syncConfig, loaded });
  live.current = { data, syncConfig, loaded };
  const syncing = useRef(false);
  /** Hay cambios locales que aún no se han enviado a la hoja. */
  const dirty = useRef(false);

  useEffect(() => {
    Promise.all([loadData(), loadSyncConfig()])
      .then(([stored, config]) => {
        setData(stored);
        setSyncConfig(config ?? null);
      })
      .catch(() => setNotice('No se han podido leer los datos guardados en este navegador.'))
      .finally(() => setLoaded(true));
    navigator.storage?.persist?.().catch(() => {});
  }, []);

  const syncNow = useCallback(async () => {
    const { syncConfig: config, loaded: ready } = live.current;
    if (!config || !ready || syncing.current) return;
    if (!navigator.onLine) {
      setSyncStatus((st) => ({ ...st, state: 'error', message: 'Sin conexión. Se sincronizará al recuperarla.' }));
      return;
    }
    syncing.current = true;
    dirty.current = false;
    setSyncStatus((st) => ({ ...st, state: 'syncing' }));
    try {
      const remote = await pushPull(config, live.current.data);
      const { skipped } = mergeRemote(live.current.data, remote);
      // Se mezcla sobre el estado del momento: lo editado durante la petición no se pierde.
      setData((prev) => mergeRemote(prev, remote).data);
      setSyncStatus({ state: 'ok', at: Date.now(), skipped });
    } catch (e) {
      dirty.current = true;
      setSyncStatus({ state: 'error', message: e instanceof Error ? e.message : 'Error al sincronizar.' });
    } finally {
      syncing.current = false;
    }
  }, []);

  // Sincroniza al abrir, al volver a la app y al recuperar la conexión.
  useEffect(() => {
    if (!loaded || !syncConfig) return;
    syncNow();
    const onVisible = () => document.visibilityState === 'visible' && syncNow();
    window.addEventListener('online', syncNow);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('online', syncNow);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [loaded, syncConfig, syncNow]);

  // Y unos segundos después de cada cambio local.
  useEffect(() => {
    if (!loaded || !syncConfig || !dirty.current) return;
    const timer = setTimeout(syncNow, 4000);
    return () => clearTimeout(timer);
  }, [data, loaded, syncConfig, syncNow]);

  const changeSyncConfig = (config: SyncConfig | null) => {
    setSyncConfig(config);
    setSyncStatus({ state: 'off' });
    saveSyncConfig(config).catch(() => setNotice('No se ha podido guardar la configuración.'));
  };

  useEffect(() => {
    if (loaded) saveData(data).catch(() => setNotice('No se han podido guardar los cambios.'));
  }, [data, loaded]);

  const places = useMemo(() => {
    const custom = new Map(data.custom.map((p) => [p.id, p]));
    const hidden = new Set(data.hidden);
    const merged = CATALOG.filter((p) => !hidden.has(p.id)).map((p) => custom.get(p.id) ?? p);
    const own = data.custom.filter((p) => !CATALOG_IDS.has(p.id));
    return [...merged, ...own].sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }, [data.custom, data.hidden]);

  const byId = useMemo(() => new Map(places.map((p) => [p.id, p])), [places]);
  const detail = detailId ? byId.get(detailId) : undefined;
  /** `null` = sin formulario; 'nuevo' o el id del lugar que se edita. */
  const editing = nav.route.form === 'nuevo' ? 'nuevo' : nav.route.form === 'editar' && detail ? detail.id : null;

  // Al cerrar el formulario, por el camino que sea, se olvida el punto elegido en el mapa.
  useEffect(() => {
    if (!editing) setPicked(null);
  }, [editing]);

  /** Todo cambio hecho por el usuario pasa por aquí para quedar marcado y sincronizarse. */
  const update = useCallback((fn: (d: Data) => Data) => {
    dirty.current = true;
    setData((prev) => stampChanges(prev, fn(prev)));
  }, []);

  // Seguimiento del GPS mientras esté activo.
  useEffect(() => {
    if (!tracking) return;
    if (!navigator.geolocation) {
      setNotice('Este dispositivo no permite obtener la ubicación.');
      setTracking(false);
      return;
    }
    const watch = navigator.geolocation.watchPosition(
      (pos) => {
        const next = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
        // Ignora el temblor del GPS: solo cuenta si te has movido unos metros o mejora la precisión.
        setUserPos((prev) =>
          prev && distanceKm(prev, next) < 0.005 && Math.abs((prev.accuracy ?? 0) - next.accuracy) < 10 ? prev : next,
        );
      },
      (error) => {
        setNotice(
          error.code === error.PERMISSION_DENIED
            ? 'No hay permiso para usar tu ubicación. Actívalo en los ajustes del navegador.'
            : 'No se ha podido obtener tu ubicación.',
        );
        if (error.code === error.PERMISSION_DENIED) {
          setTracking(false);
          setTargetId(null);
        }
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 },
    );
    // Mantiene la pantalla encendida mientras se sigue la posición, donde el navegador lo permite.
    let lock: WakeLockSentinel | undefined;
    navigator.wakeLock?.request('screen').then((l) => (lock = l)).catch(() => {});
    return () => {
      navigator.geolocation.clearWatch(watch);
      lock?.release().catch(() => {});
    };
  }, [tracking]);

  const startTracking = useCallback(() => {
    setTracking(true);
    setFollow(true);
  }, []);

  /** Botón de posición: activa, vuelve a centrar si el mapa se ha movido, o apaga. */
  const toggleTracking = () => {
    if (!tracking || !follow) return startTracking();
    setTracking(false);
    setFollow(false);
    setTargetId(null);
    setUserPos(null);
  };

  const guideTo = (id: string) => {
    setTargetId(id);
    setTracking(true);
    setFollow(false);
    nav.go(paths.tab('mapa'));
  };

  const openDetail = (id: string) => {
    nav.go(paths.place(id));
    // En escritorio el mapa sigue a la vista: lo centra en el lugar abierto.
    const place = byId.get(id);
    if (place && window.innerWidth >= 900) setFocus({ lat: place.lat, lng: place.lng, zoom: 13, key: Date.now() });
  };

  const showOnMap = (p: LatLng) => {
    setFocus({ ...p, zoom: 14, key: Date.now() });
    if (window.innerWidth < 900) nav.go(paths.tab('mapa'));
  };

  const savePlace = (place: Place) => {
    update((d) => ({
      ...d,
      custom: [...d.custom.filter((p) => p.id !== place.id), { ...place, custom: true }],
    }));
    // Uno nuevo ocupa el sitio del formulario (atrás vuelve a la lista); al editar se vuelve a la ficha.
    if (nav.route.form === 'nuevo') nav.go(paths.place(place.id), true);
    else nav.back(paths.place(place.id));
  };

  const importPlaces = (list: Place[]) => {
    update((d) => ({ ...d, custom: [...d.custom, ...list] }));
    nav.back(paths.tab('lugares'));
    setNotice(`${list.length} ${list.length === 1 ? 'lugar importado' : 'lugares importados'}.`);
  };

  /** Copia a los datos propios los lugares del catálogo que aún no lo están, para que viajen a la hoja. */
  const copyCatalog = () => {
    update((d) => {
      const have = new Set(d.custom.map((p) => p.id));
      const hidden = new Set(d.hidden);
      const missing = CATALOG.filter((p) => !have.has(p.id) && !hidden.has(p.id)).map((p) => ({ ...p, custom: true }));
      return missing.length ? { ...d, custom: [...d.custom, ...missing] } : d;
    });
  };
  const catalogPending = useMemo(() => {
    const have = new Set(data.custom.map((p) => p.id));
    return CATALOG.filter((p) => !have.has(p.id) && !data.hidden.includes(p.id)).length;
  }, [data.custom, data.hidden]);

  const removePlace = (place: Place) => {
    update((d) => {
      const { [place.id]: _gone, ...diary } = d.diary;
      return {
        ...d,
        custom: d.custom.filter((p) => p.id !== place.id),
        hidden: CATALOG_IDS.has(place.id) ? [...d.hidden, place.id] : d.hidden,
        diary,
        trips: d.trips.map((t) => ({ ...t, placeIds: t.placeIds.filter((id) => id !== place.id) })),
      };
    });
    nav.back(paths.tab('lugares'));
  };

  const restoreOriginal = (id: string) =>
    update((d) => ({ ...d, custom: d.custom.filter((p) => p.id !== id) }));

  const openTrip = data.trips.find((t) => t.id === openTripId);
  const showRoute = tab === 'salidas' || (tab === 'mapa' && tripOnMap);
  const route = useMemo(
    () =>
      showRoute && openTrip
        ? openTrip.placeIds.map((id) => byId.get(id)).filter((p): p is Place => !!p)
        : null,
    [showRoute, openTrip, byId],
  );
  const routeStart = (route && openTrip?.start) || null;
  const routePoints = useMemo(() => tripPoints(routeStart ?? undefined, route ?? []), [routeStart, route]);
  const road = useRoadRoute(routePoints);

  const target = targetId ? (byId.get(targetId) ?? null) : null;
  const targetKm = target && userPos ? distanceKm(userPos, target) : null;

  /** Punto desde el que se calculó la ruta de la guía; cambia solo al salirse de ella. */
  const [guideFrom, setGuideFrom] = useState<LatLng | null>(null);
  const guidePoints = useMemo(() => (guideFrom && target ? [guideFrom, target] : []), [guideFrom, target]);
  const guideRoad = useRoadRoute(guidePoints);
  /** Lo que queda de ruta desde la posición actual. */
  const guide = useMemo(() => {
    if (guideRoad.status !== 'ok' || !userPos || guideRoad.route.line.length < 2) return null;
    const { line, legs } = guideRoad.route;
    const near = nearestOnLine(line, userPos);
    const rest: [number, number][] = [near.point, ...line.slice(near.index + 1)];
    const length = (points: [number, number][]) => {
      let km = 0;
      for (let i = 1; i < points.length; i++) {
        km += distanceKm({ lat: points[i - 1][0], lng: points[i - 1][1] }, { lat: points[i][0], lng: points[i][1] });
      }
      return km;
    };
    const km = length(rest);
    const total = length(line);
    return {
      line: [[userPos.lat, userPos.lng] as [number, number], ...rest],
      km,
      minutes: total ? (legs[0].minutes * km) / total : 0,
      off: near.km,
    };
  }, [guideRoad, userPos]);

  useEffect(() => setGuideFrom(null), [targetId]);
  useEffect(() => {
    if (!targetId || !userPos) return;
    const margin = Math.max(0.15, ((userPos.accuracy ?? 0) * 2) / 1000);
    setGuideFrom((from) => {
      if (!from) return userPos;
      // Fuera de la ruta: se recalcula desde aquí. Si falló (sin cobertura), se reintenta al avanzar.
      if (guide && guide.off > margin) return userPos;
      if (guideRoad.status === 'error' && distanceKm(from, userPos) > 0.5) return userPos;
      return from;
    });
  }, [targetId, userPos, guide, guideRoad.status]);

  // Con una salida abierta, el mapa enseña solo sus paradas.
  const mapPlaces = route && route.length ? route : (visible ?? places);

  const panelHidden = tab === 'mapa' || picking;

  return (
    <div className="app" data-panel={panelHidden ? 'off' : 'on'}>
      <nav className="nav" aria-label="Secciones">
        <div className="brand" aria-hidden="true">
          U<span>P</span>
        </div>
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`nav-btn${t.id === 'ajustes' && syncStatus.state === 'error' ? ' alert' : ''}`}
            aria-current={tab === t.id ? 'page' : undefined}
            onClick={() => nav.go(paths.tab(t.id))}
          >
            <span className="nav-icon" aria-hidden="true">
              {t.icon}
            </span>
            {t.label}
          </button>
        ))}
      </nav>

      <main className="panel" hidden={panelHidden}>
        {importing ? (
          <ImportPlaces places={places} onImport={importPlaces} onCancel={() => nav.back(paths.tab('lugares'))} />
        ) : editing ? (
          <PlaceForm
            key={editing}
            place={editing === 'nuevo' ? undefined : byId.get(editing)}
            picked={picked}
            userPos={userPos}
            onPick={() => nav.go(`${nav.hash}/situar`)}
            onSave={savePlace}
            onCancel={() => nav.back(detail ? paths.place(detail.id) : paths.tab('lugares'))}
          />
        ) : tab === 'lugares' && detail ? (
          <PlaceDetail
            key={detail.id}
            place={detail}
            data={data}
            update={update}
            userPos={userPos}
            isCatalog={isCatalogId(detail.id)}
            original={isOriginal(detail)}
            backLabel={
              nav.from.startsWith('#/salida/') && !nav.from.endsWith('/mapa')
                ? '← Volver a la salida'
                : nav.from === '#/mapa' || nav.from.endsWith('/mapa')
                  ? '← Volver al mapa'
                  : !nav.from || nav.from === '#/lugares'
                    ? '← Todos los lugares'
                    : '← Volver'
            }
            shareUrl={isCatalogId(detail.id) ? location.href : undefined}
            onBack={() => nav.back(paths.tab('lugares'))}
            onShowOnMap={() => showOnMap(detail)}
            onGuide={() => guideTo(detail.id)}
            onEdit={() => nav.go(paths.editPlace(detail.id))}
            onRemove={() => removePlace(detail)}
            onRestore={() => restoreOriginal(detail.id)}
          />
        ) : tab === 'salidas' ? (
          <Trips
            data={data}
            update={update}
            places={places}
            openId={openTripId}
            setOpenId={(id) => (id ? nav.go(paths.trip(id)) : nav.back(paths.tab('salidas')))}
            onOpenPlace={openDetail}
            onShowOnMap={() => {
              if (window.innerWidth < 900 && openTripId) nav.go(paths.tripMap(openTripId));
            }}
          />
        ) : tab === 'ajustes' ? (
          <Settings
            data={data}
            setData={(next) => update(() => next)}
            placeCount={places.length}
            setNotice={setNotice}
            syncConfig={syncConfig}
            syncStatus={syncStatus}
            onSyncConfig={changeSyncConfig}
            onSync={syncNow}
            catalogPending={catalogPending}
            onCopyCatalog={copyCatalog}
          />
        ) : null}
        {/* La lista sigue montada para no perder los filtros al abrir una ficha. */}
        <div hidden={importing || !!editing || tab !== 'lugares' || !!detail}>
          <PlaceList
            places={places}
            diary={data.diary}
            userPos={userPos}
            onLocate={startTracking}
            onOpen={openDetail}
            onAdd={() => nav.go(paths.newPlace)}
            onImport={() => nav.go(paths.importPlaces)}
            onVisible={setVisible}
          />
        </div>
      </main>

      <section className="map-wrap" aria-label="Mapa">
        <MapView
          places={mapPlaces}
          diary={data.diary}
          route={route}
          routeStart={routeStart}
          routeLine={road.status === 'ok' ? road.route.line : null}
          userPos={userPos}
          follow={follow}
          target={target}
          guideLine={guide?.line ?? null}
          onUserPan={() => setFollow(false)}
          focus={focus}
          picking={picking}
          onPick={(p) => {
            setPicked(p);
            nav.back(nav.hash.replace(/\/situar$/, ''));
          }}
          onOpen={openDetail}
        />
        <button
          className={`fab${tracking ? (follow ? ' on' : ' loose') : ''}`}
          onClick={toggleTracking}
          aria-pressed={tracking}
          title={!tracking ? 'Seguir mi posición' : follow ? 'Dejar de seguir mi posición' : 'Volver a centrar en mi posición'}
          aria-label={!tracking ? 'Seguir mi posición' : follow ? 'Dejar de seguir mi posición' : 'Volver a centrar en mi posición'}
        >
          ⌖
        </button>
        {target && !picking && (
          <div className="banner guide" role="status">
            <span className="guide-text">
              <strong>{target.name}</strong>
              {targetKm === null
                ? 'Buscando tu posición…'
                : targetKm < 0.03
                  ? 'Has llegado'
                  : guide && guide.km > 0.1
                    ? `${formatKm(guide.km)} · ${formatDuration(guide.minutes)} por carretera`
                    : `${formatKm(targetKm)} al ${cardinal(userPos!, target)} en línea recta`}
              {targetKm !== null && targetKm >= 0.03 && guide && guide.km > 0.1 && (
                <span className="muted small">
                  {formatKm(targetKm)} al {cardinal(userPos!, target)} en línea recta
                </span>
              )}
              {guideRoad.status === 'error' && (
                <span className="muted small">Sin conexión: no se puede calcular la ruta por carretera</span>
              )}
              {userPos?.accuracy && userPos.accuracy > 50 && (
                <span className="muted small">GPS poco preciso (±{Math.round(userPos.accuracy)} m)</span>
              )}
            </span>
            <button className="btn small" onClick={() => setTargetId(null)}>
              Terminar
            </button>
          </div>
        )}
        {picking && (
          <div className="banner">
            Toca el mapa para situar el lugar
            <button className="btn small" onClick={() => nav.back(nav.hash.replace(/\/situar$/, ''))}>
              Cancelar
            </button>
          </div>
        )}
      </section>

      {notice && (
        <div className="toast" role="status">
          {notice}
          <button className="btn small" onClick={() => setNotice('')}>
            Cerrar
          </button>
        </div>
      )}
    </div>
  );
}
