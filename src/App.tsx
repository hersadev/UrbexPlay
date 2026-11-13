import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CATALOG } from './catalog';
import { emptyData, loadData, saveData, stampChanges } from './store';
import { loadSyncConfig, mergeRemote, pushPull, saveSyncConfig, type SyncConfig, type SyncStatus } from './sync';
import type { Data, LatLng, Place } from './types';
import MapView, { type Focus } from './components/MapView';
import PlaceList from './components/PlaceList';
import PlaceDetail from './components/PlaceDetail';
import PlaceForm from './components/PlaceForm';
import Trips from './components/Trips';
import Settings from './components/Settings';

type Tab = 'mapa' | 'lugares' | 'salidas' | 'ajustes';

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
  const [tab, setTab] = useState<Tab>(() => (window.innerWidth >= 900 ? 'lugares' : 'mapa'));
  const [detailId, setDetailId] = useState<string | null>(null);
  /** `null` = sin formulario; 'nuevo' o el id del lugar que se edita. */
  const [editing, setEditing] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<LatLng | null>(null);
  const [visible, setVisible] = useState<Place[] | null>(null);
  const [openTripId, setOpenTripId] = useState<string | null>(null);
  const [userPos, setUserPos] = useState<LatLng | null>(null);
  const [focus, setFocus] = useState<Focus | null>(null);
  const [notice, setNotice] = useState('');
  /** En móvil: el mapa enseña la salida abierta en lugar de todos los lugares. */
  const [tripOnMap, setTripOnMap] = useState(false);

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

  /** Todo cambio hecho por el usuario pasa por aquí para quedar marcado y sincronizarse. */
  const update = useCallback((fn: (d: Data) => Data) => {
    dirty.current = true;
    setData((prev) => stampChanges(prev, fn(prev)));
  }, []);

  const locate = useCallback(() => {
    if (!navigator.geolocation) {
      setNotice('Este dispositivo no permite obtener la ubicación.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUserPos(here);
        setFocus({ ...here, zoom: 11, key: Date.now() });
      },
      () => setNotice('No se ha podido obtener tu ubicación. Revisa los permisos del navegador.'),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }, []);

  const openDetail = (id: string) => {
    setEditing(null);
    setDetailId(id);
    setTab('lugares');
    // En escritorio el mapa sigue a la vista: lo centra en el lugar abierto.
    const place = byId.get(id);
    if (place && window.innerWidth >= 900) setFocus({ lat: place.lat, lng: place.lng, zoom: 13, key: Date.now() });
  };

  const showOnMap = (p: LatLng) => {
    setFocus({ ...p, zoom: 14, key: Date.now() });
    if (window.innerWidth < 900) setTab('mapa');
  };

  const savePlace = (place: Place) => {
    update((d) => ({
      ...d,
      custom: [...d.custom.filter((p) => p.id !== place.id), { ...place, custom: true }],
    }));
    setEditing(null);
    setPicked(null);
    setDetailId(place.id);
    setTab('lugares');
  };

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
    setDetailId(null);
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
            onClick={() => {
              setTab(t.id);
              setPicking(false);
              setTripOnMap(false);
            }}
          >
            <span className="nav-icon" aria-hidden="true">
              {t.icon}
            </span>
            {t.label}
          </button>
        ))}
      </nav>

      <main className="panel" hidden={panelHidden}>
        {editing ? (
          <PlaceForm
            key={editing}
            place={editing === 'nuevo' ? undefined : byId.get(editing)}
            picked={picked}
            userPos={userPos}
            onPick={() => setPicking(true)}
            onSave={savePlace}
            onCancel={() => {
              setEditing(null);
              setPicked(null);
            }}
          />
        ) : tab === 'lugares' && detail ? (
          <PlaceDetail
            key={detail.id}
            place={detail}
            data={data}
            update={update}
            userPos={userPos}
            isCatalog={CATALOG_IDS.has(detail.id)}
            onBack={() => setDetailId(null)}
            onShowOnMap={() => showOnMap(detail)}
            onEdit={() => setEditing(detail.id)}
            onRemove={() => removePlace(detail)}
            onRestore={() => restoreOriginal(detail.id)}
          />
        ) : tab === 'salidas' ? (
          <Trips
            data={data}
            update={update}
            places={places}
            openId={openTripId}
            setOpenId={setOpenTripId}
            onOpenPlace={openDetail}
            onShowOnMap={() => {
              if (window.innerWidth < 900) {
                setTripOnMap(true);
                setTab('mapa');
              }
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
          />
        ) : null}
        {/* La lista sigue montada para no perder los filtros al abrir una ficha. */}
        <div hidden={!!editing || tab !== 'lugares' || !!detail}>
          <PlaceList
            places={places}
            diary={data.diary}
            userPos={userPos}
            onLocate={locate}
            onOpen={openDetail}
            onAdd={() => setEditing('nuevo')}
            onVisible={setVisible}
          />
        </div>
      </main>

      <section className="map-wrap" aria-label="Mapa">
        <MapView
          places={mapPlaces}
          diary={data.diary}
          route={route}
          userPos={userPos}
          focus={focus}
          picking={picking}
          onPick={(p) => {
            setPicked(p);
            setPicking(false);
          }}
          onOpen={openDetail}
        />
        <button className="fab" onClick={locate} title="Mi posición" aria-label="Centrar en mi posición">
          ⌖
        </button>
        {picking && (
          <div className="banner">
            Toca el mapa para situar el lugar
            <button className="btn small" onClick={() => setPicking(false)}>
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
