import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { IGN_ORTO, IGN_TOPO, cachedTile } from '../offline';
import { TYPE_META, type Diary, type LatLng, type Place, type Position } from '../types';

export interface Focus extends LatLng {
  zoom?: number;
  /** Cambia en cada petición para poder repetir el mismo destino. */
  key: number;
}

interface Props {
  places: Place[];
  diary: Record<string, Diary>;
  route: Place[] | null;
  userPos: Position | null;
  /** El mapa se mantiene centrado en la posición del usuario. */
  follow: boolean;
  /** Lugar hacia el que se está guiando. */
  target: Place | null;
  focus: Focus | null;
  picking: boolean;
  onPick: (p: LatLng) => void;
  onOpen: (id: string) => void;
  /** El usuario ha movido el mapa a mano. */
  onUserPan: () => void;
}

const MURCIA: L.LatLngTuple = [37.95, -1.25];

/** Capa que mira primero en los mapas guardados y, si no está, va a la red. */
const SavedFirstLayer = L.TileLayer.extend({
  createTile(this: L.TileLayer, coords: L.Coords, done: L.DoneCallback) {
    const tile = document.createElement('img');
    tile.alt = '';
    tile.setAttribute('role', 'presentation');
    const url = this.getTileUrl(coords);
    let local: string | null = null;
    tile.onload = () => {
      if (local) URL.revokeObjectURL(local);
      done(undefined, tile);
    };
    tile.onerror = () => done(new Error('tesela no disponible'), tile);
    cachedTile(url).then((saved) => {
      local = saved;
      if (!saved) tile.crossOrigin = '';
      tile.src = saved ?? url;
    });
    return tile;
  },
}) as unknown as new (url: string, options: L.TileLayerOptions) => L.TileLayer;

export default function MapView({
  places,
  diary,
  route,
  userPos,
  follow,
  target,
  focus,
  picking,
  onPick,
  onOpen,
  onUserPan,
}: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map>();
  const markers = useRef(L.layerGroup());
  const routeLayer = useRef(L.layerGroup());
  const userLayer = useRef(L.layerGroup());
  // El mapa se crea una sola vez; los manejadores leen siempre la versión actual.
  const live = useRef({ picking, onPick, onOpen, onUserPan });
  live.current = { picking, onPick, onOpen, onUserPan };
  /** Destino para el que ya se ha encuadrado el mapa (se hace una vez por guía). */
  const framed = useRef<string | null>(null);
  const hadPosition = useRef(false);

  useEffect(() => {
    const m = L.map(el.current!, { zoomControl: false }).setView(MURCIA, 9);
    map.current = m;
    L.control.zoom({ position: 'bottomright' }).addTo(m);

    const callejero = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      crossOrigin: true,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    });
    const ignAttribution = '© <a href="https://www.ign.es">Instituto Geográfico Nacional</a>';
    const satelite = new SavedFirstLayer(IGN_ORTO, { maxZoom: 19, attribution: `PNOA ${ignAttribution}` });
    const topografico = new SavedFirstLayer(IGN_TOPO, { maxZoom: 17, attribution: `MTN ${ignAttribution}` });
    // Sin conexión se abre con el topográfico, que es el que se puede llevar guardado.
    (navigator.onLine ? callejero : topografico).addTo(m);
    L.control
      .layers({ Callejero: callejero, 'Topográfico (IGN)': topografico, 'Satélite (IGN)': satelite }, undefined, {
        position: 'topright',
      })
      .addTo(m);

    markers.current.addTo(m);
    routeLayer.current.addTo(m);
    userLayer.current.addTo(m);
    m.on('click', (e) => {
      if (live.current.picking) live.current.onPick({ lat: e.latlng.lat, lng: e.latlng.lng });
    });
    m.on('dragstart', () => live.current.onUserPan());

    const observer = new ResizeObserver(() => m.invalidateSize());
    observer.observe(el.current!);
    return () => {
      observer.disconnect();
      m.remove();
    };
  }, []);

  useEffect(() => {
    markers.current.clearLayers();
    for (const place of places) {
      const meta = TYPE_META[place.type];
      const status = diary[place.id]?.status ?? 'ninguno';
      const icon = L.divIcon({
        className: '',
        html: `<span class="pin ${status}" style="--c:${meta.color}">${meta.glyph}</span>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15],
        popupAnchor: [0, -14],
      });

      const popup = document.createElement('div');
      popup.className = 'popup';
      const kind = document.createElement('span');
      kind.className = 'popup-kind';
      kind.textContent = meta.label;
      const title = document.createElement('strong');
      title.textContent = place.name;
      const where = document.createElement('span');
      where.textContent = `${place.town} · ${place.province}`;
      const open = document.createElement('button');
      open.className = 'btn primary small';
      open.textContent = 'Ver ficha';
      open.onclick = () => live.current.onOpen(place.id);
      popup.append(kind, title, where, open);

      L.marker([place.lat, place.lng], { icon, title: place.name }).bindPopup(popup).addTo(markers.current);
    }
  }, [places, diary]);

  useEffect(() => {
    routeLayer.current.clearLayers();
    if (route && route.length > 1) {
      const line = L.polyline(
        route.map((p) => [p.lat, p.lng] as L.LatLngTuple),
        { color: '#e0a341', weight: 4, dashArray: '8 8' },
      ).addTo(routeLayer.current);
      // Sin animación: varias paradas añadidas seguidas cancelaban el encuadre a medias.
      map.current?.fitBounds(line.getBounds(), { padding: [50, 50], animate: false });
    } else if (route && route.length === 1) {
      map.current?.setView([route[0].lat, route[0].lng], 12, { animate: false });
    }
  }, [route]);

  // Posición del usuario, precisión y línea hacia el destino.
  useEffect(() => {
    userLayer.current.clearLayers();
    if (!userPos) {
      hadPosition.current = false;
      return;
    }
    const here: L.LatLngTuple = [userPos.lat, userPos.lng];
    if (userPos.accuracy && userPos.accuracy > 15) {
      L.circle(here, {
        radius: userPos.accuracy,
        color: '#2b7fff',
        weight: 1,
        fillOpacity: 0.12,
        interactive: false,
      }).addTo(userLayer.current);
    }
    if (target) {
      L.polyline([here, [target.lat, target.lng]], { color: '#2b7fff', weight: 4, opacity: 0.85 }).addTo(
        userLayer.current,
      );
    }
    L.circleMarker(here, { radius: 8, color: '#fff', weight: 3, fillColor: '#2b7fff', fillOpacity: 1 })
      .bindTooltip('Tu posición')
      .addTo(userLayer.current);

    const m = map.current;
    if (!m) return;
    if (target && framed.current !== target.id) {
      framed.current = target.id;
      m.fitBounds(L.latLngBounds([here, [target.lat, target.lng]]), { padding: [60, 60], maxZoom: 17, animate: false });
    } else if (follow) {
      // La primera vez se acerca; después solo acompaña, respetando el zoom elegido.
      if (!hadPosition.current && !target) m.setView(here, Math.max(m.getZoom(), 15));
      else m.panTo(here);
    }
    hadPosition.current = true;
  }, [userPos, target, follow]);

  useEffect(() => {
    if (!target) framed.current = null;
  }, [target]);

  useEffect(() => {
    if (focus) map.current?.flyTo([focus.lat, focus.lng], focus.zoom ?? 14, { duration: 0.8 });
  }, [focus]);

  return <div ref={el} className={`map${picking ? ' picking' : ''}`} />;
}
