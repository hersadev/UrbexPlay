import { distanceKm } from './geo';
import type { TrackPoint } from './types';

/** Fecha local (no UTC) en formato AAAA-MM-DD. */
export function localDate(ms = Date.now()): string {
  const d = new Date(ms);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

export function trackKm(points: TrackPoint[]): number {
  let km = 0;
  for (let i = 1; i < points.length; i++) {
    km += distanceKm({ lat: points[i - 1][0], lng: points[i - 1][1] }, { lat: points[i][0], lng: points[i][1] });
  }
  return km;
}

export const trackMinutes = (points: TrackPoint[]) =>
  points.length > 1 ? (points[points.length - 1][2] - points[0][2]) / 60000 : 0;

const xml = (text: string) => text.replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** El recorrido como fichero GPX 1.1, que abren Wikiloc, Komoot, Garmin, OsmAnd… */
export function toGpx(name: string, points: TrackPoint[]): string {
  const body = points
    .map(([lat, lng, time]) => `<trkpt lat="${lat.toFixed(6)}" lon="${lng.toFixed(6)}"><time>${new Date(time).toISOString()}</time></trkpt>`)
    .join('\n      ');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="UrbexPlay" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${xml(name)}</name>
    <trkseg>
      ${body}
    </trkseg>
  </trk>
</gpx>
`;
}

export function downloadGpx(name: string, points: TrackPoint[]) {
  const url = URL.createObjectURL(new Blob([toGpx(name, points)], { type: 'application/gpx+xml' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'recorrido'}.gpx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
