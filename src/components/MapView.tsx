import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { TYPE_META, type Diary, type LatLng, type Place } from '../types';

export interface Focus extends LatLng {
  zoom?: number;
  /** Cambia en cada petición para poder repetir el mismo destino. */
  key: number;
}

interface Props {
  places: Place[];
  diary: Record<string, Diary>;
  route: Place[] | null;
  userPos: LatLng | null;
  focus: Focus | null;
  picking: boolean;
  onPick: (p: LatLng) => void;
  onOpen: (id: string) => void;
}

const MURCIA: L.LatLngTuple = [37.95, -1.25];

const ign = (service: string, layer: string) =>
  `https://www.ign.es/wmts/${service}?layer=${layer}&style=default&tilematrixset=GoogleMapsCompatible` +
  '&Service=WMTS&Request=GetTile&Version=1.0.0&Format=image/jpeg&TileMatrix={z}&TileCol={x}&TileRow={y}';

export default function MapView({ places, diary, route, userPos, focus, picking, onPick, onOpen }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map>();
  const markers = useRef(L.layerGroup());
  const overlay = useRef(L.layerGroup());
  // El mapa se crea una sola vez; los manejadores leen siempre la versión actual.
  const live = useRef({ picking, onPick, onOpen });
  live.current = { picking, onPick, onOpen };

  useEffect(() => {
    const m = L.map(el.current!, { zoomControl: false }).setView(MURCIA, 9);
    map.current = m;
    L.control.zoom({ position: 'bottomright' }).addTo(m);

    const callejero = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      crossOrigin: true,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(m);
    const ignAttribution = '© <a href="https://www.ign.es">Instituto Geográfico Nacional</a>';
    const satelite = L.tileLayer(ign('pnoa-ma', 'OI.OrthoimageCoverage'), {
      maxZoom: 19,
      crossOrigin: true,
      attribution: `PNOA ${ignAttribution}`,
    });
    const topografico = L.tileLayer(ign('mapa-raster', 'MTN'), {
      maxZoom: 17,
      crossOrigin: true,
      attribution: `MTN ${ignAttribution}`,
    });
    L.control
      .layers({ Callejero: callejero, 'Satélite (IGN)': satelite, 'Topográfico (IGN)': topografico }, undefined, {
        position: 'topright',
      })
      .addTo(m);

    markers.current.addTo(m);
    overlay.current.addTo(m);
    m.on('click', (e) => {
      if (live.current.picking) live.current.onPick({ lat: e.latlng.lat, lng: e.latlng.lng });
    });

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
    overlay.current.clearLayers();
    if (userPos) {
      L.circleMarker([userPos.lat, userPos.lng], {
        radius: 8,
        color: '#fff',
        weight: 3,
        fillColor: '#2b7fff',
        fillOpacity: 1,
      })
        .bindTooltip('Tu posición')
        .addTo(overlay.current);
    }
    if (route && route.length > 1) {
      const line = L.polyline(
        route.map((p) => [p.lat, p.lng] as L.LatLngTuple),
        { color: '#e0a341', weight: 4, dashArray: '8 8' },
      ).addTo(overlay.current);
      // Sin animación: varias paradas añadidas seguidas cancelaban el encuadre a medias.
      map.current?.fitBounds(line.getBounds(), { padding: [50, 50], animate: false });
    } else if (route && route.length === 1) {
      map.current?.setView([route[0].lat, route[0].lng], 12, { animate: false });
    }
  }, [userPos, route]);

  useEffect(() => {
    if (focus) map.current?.flyTo([focus.lat, focus.lng], focus.zoom ?? 14, { duration: 0.8 });
  }, [focus]);

  return <div ref={el} className={`map${picking ? ' picking' : ''}`} />;
}
