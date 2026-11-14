import type { Place } from './types';

export interface GearItem {
  /** Identifica el objeto aunque cambie cómo está escrito (mayúsculas, tildes). */
  key: string;
  label: string;
  /** Paradas que lo piden, con el matiz si lo hay: «Cabezo Rajao (para las galerías)». */
  wanted: string[];
}

const normalize = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** Trozos del texto que son consejos y no cosas que meter en la mochila. */
const ADVICE = /^(sobre todo|ir|no|evitar?|mejor|siempre|nunca|conviene)\b/;

/**
 * Lista de equipo de una salida a partir del campo «Equipo recomendado» de
 * cada parada. «Agua, calzado de monte y linterna para los túneles» da tres
 * objetos; el mismo objeto pedido en varias paradas aparece una sola vez.
 */
export function gearList(stops: Place[]): GearItem[] {
  const items = new Map<string, GearItem>();
  for (const place of stops) {
    for (const piece of place.practical.gear.split(/[;,.\n]|\s+[ye](?=[\s,;])/)) {
      const text = piece.trim();
      if (!text || ADVICE.test(normalize(text))) continue;
      const [name, ...detail] = text.split(/\s+(?=para\s)/);
      const key = normalize(name);
      if (!key) continue;
      const item = items.get(key) ?? { key, label: name[0].toUpperCase() + name.slice(1), wanted: [] };
      item.wanted.push(detail.length ? `${place.name} (${detail.join(' ')})` : place.name);
      items.set(key, item);
    }
  }
  return [...items.values()];
}
