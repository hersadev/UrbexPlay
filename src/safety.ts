import { localDate } from './track';
import type { Place } from './types';

/*
 * Avisos de seguridad y de respeto a la propiedad: los de la pantalla de
 * bienvenida, los de cada ficha y los que salen antes de guiar a un lugar.
 */

/** Versión del aviso de bienvenida; al subirla se vuelve a pedir que se acepte. */
export const NOTICE_VERSION = 1;

export const MAP_IS_NOT_PERMISSION =
  'Que un lugar aparezca en el mapa no significa que se pueda entrar.';

export const RULES = [
  'No entres en lugares privados aunque estén en el mapa: sin permiso de su dueño, quédate fuera. No fuerces ni saltes cierres.',
  'No entres en minas ni en edificios con riesgo de derrumbe.',
  'Nunca vayas solo y deja dicho a alguien adónde vas.',
  'No te lleves nada ni dejes nada: solo fotos.',
];

/** Días a partir de los cuales una comprobación se considera antigua. */
const STALE_DAYS = 365;

export const isDate = (text: string) => /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(Date.parse(text));

const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000);

/** Cuándo se comprobó la ficha sobre el terreno; `null` si nadie lo ha hecho. */
export function checkedInfo(place: Place, today = localDate()): { label: string; stale: boolean } | null {
  if (!place.checked || !isDate(place.checked)) return null;
  const [year, month, day] = place.checked.split('-').map(Number);
  const date = new Date(year, month - 1, day).toLocaleDateString('es-ES', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  return { label: `Comprobada el ${date}`, stale: days(place.checked, today) > STALE_DAYS };
}

/** Avisos propios de un lugar, del más importante al menos. */
export function placeWarnings(place: Place, today = localDate()): string[] {
  const { ownership, difficulty, risks } = place.practical;
  const out: string[] = [];
  if (ownership === 'privada') {
    out.push('Propiedad privada: no entres sin permiso de su dueño, aunque el lugar esté en el mapa.');
  } else if (ownership === 'desconocida') {
    out.push('Titularidad sin confirmar: trátalo como privado y no entres sin permiso.');
  } else {
    out.push('Que sea de titularidad pública no significa que se pueda entrar: respeta cierres y carteles.');
  }
  if (difficulty === 3) out.push('Dificultad alta: lugar exigente o peligroso.');
  if (risks.trim()) out.push(`Riesgos: ${risks.trim()}`);
  const checked = checkedInfo(place, today);
  if (!checked) {
    out.push('Ficha sin verificar sobre el terreno: el estado y los accesos pueden no ser los que se describen.');
  } else if (checked.stale) {
    out.push('Ficha comprobada hace más de un año: el estado y los accesos pueden haber cambiado.');
  }
  if (place.approx) out.push('Coordenadas aproximadas: el punto del mapa puede no ser el lugar exacto.');
  return out;
}
