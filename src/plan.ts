import { drivePoint, formatCoords, googleMapsRoute } from './geo';
import type { Place, Trip } from './types';

/*
 * El plan de una salida en texto, para dejárselo dicho a alguien antes de
 * salir: adónde se va, por dónde y a qué hora se piensa volver.
 */

export function tripPlan(trip: Trip, stops: Place[]): string {
  const lines: string[] = [`Salida de urbex: ${trip.name.trim() || 'sin nombre'}`];

  const when: string[] = [];
  if (trip.date) {
    when.push(
      new Date(`${trip.date}T12:00:00`).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
    );
  }
  if (trip.leaveAt) when.push(`salgo a las ${trip.leaveAt}`);
  if (when.length) lines.push(when.join(', '));
  if (trip.start) lines.push(`Salgo de: ${trip.start.label || formatCoords(trip.start)}`);

  lines.push('', stops.length === 1 ? 'Voy a:' : 'Paradas, por orden:');
  stops.forEach((p, i) => {
    lines.push(`${i + 1}. ${p.name}${p.town ? `, ${p.town}` : ''}`);
    lines.push(`   ${formatCoords(p)} · https://www.google.com/maps?q=${p.lat.toFixed(5)},${p.lng.toFixed(5)}`);
  });

  lines.push('');
  lines.push(
    trip.backAt
      ? `Vuelta prevista: ${trip.backAt}. Si a esa hora no he dado señales, llámame.`
      : 'Te aviso cuando esté de vuelta.',
  );
  if (stops.length > 1) lines.push(`Ruta completa: ${googleMapsRoute(stops.map(drivePoint), trip.start)}`);
  return lines.join('\n');
}
