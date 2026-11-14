import { useCallback, useEffect, useState } from 'react';

/*
 * Navegación sobre el historial del navegador. La pantalla que se ve sale de
 * la parte «#/…» de la URL: así el botón atrás del móvil vuelve a la pantalla
 * anterior en vez de cerrar la app, recargar no devuelve al inicio y una ficha
 * o una salida se pueden enlazar.
 *
 *   #/mapa  #/lugares  #/salidas  #/ajustes
 *   #/lugares/nuevo  #/lugares/importar
 *   #/lugar/<id>  #/lugar/<id>/editar
 *   #/salida/<id>  #/salida/<id>/mapa
 *   …/situar tras un formulario: se está eligiendo el punto en el mapa.
 *   #/lugar/<id>/foto: visor de fotos abierto sobre la ficha.
 */

export type Tab = 'mapa' | 'lugares' | 'salidas' | 'ajustes';

export interface Route {
  tab: Tab;
  /** Ficha abierta (o lugar que se edita). */
  placeId: string | null;
  form: 'nuevo' | 'editar' | null;
  importing: boolean;
  /** Se está eligiendo en el mapa el punto del formulario. */
  picking: boolean;
  /** Visor de fotos abierto sobre la ficha. */
  photo: boolean;
  tripId: string | null;
  /** El mapa enseña la salida abierta en lugar de todos los lugares. */
  tripOnMap: boolean;
}

/** Lo que se guarda en cada entrada del historial. */
interface Entry {
  /** Entradas de la app que hay por debajo: con 0, «atrás» saldría de ella. */
  idx: number;
  /** Pantalla desde la que se llegó a esta. */
  from: string;
}

const enc = encodeURIComponent;

export const paths = {
  tab: (tab: Tab) => `#/${tab}`,
  newPlace: '#/lugares/nuevo',
  importPlaces: '#/lugares/importar',
  place: (id: string) => `#/lugar/${enc(id)}`,
  editPlace: (id: string) => `#/lugar/${enc(id)}/editar`,
  photo: (id: string) => `#/lugar/${enc(id)}/foto`,
  trip: (id: string) => `#/salida/${enc(id)}`,
  tripMap: (id: string) => `#/salida/${enc(id)}/mapa`,
};

/** Pantallas que solo tienen sentido viniendo de la anterior: el punto del formulario y el visor de fotos. */
const TRANSIENT = /\/(situar|foto)$/;

const defaultTab = (): Tab => (window.innerWidth >= 900 ? 'lugares' : 'mapa');

const decode = (part: string) => {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
};

export function parseRoute(hash: string): Route {
  const [head, a, b, c] = hash.replace(/^#/, '').split('/').filter(Boolean).map(decode);
  const base: Route = {
    tab: defaultTab(),
    placeId: null,
    form: null,
    importing: false,
    picking: false,
    photo: false,
    tripId: null,
    tripOnMap: false,
  };
  switch (head) {
    case 'mapa':
    case 'salidas':
    case 'ajustes':
      return { ...base, tab: head };
    case 'lugares':
      if (a === 'nuevo') return { ...base, tab: 'lugares', form: 'nuevo', picking: b === 'situar' };
      return { ...base, tab: 'lugares', importing: a === 'importar' };
    case 'lugar':
      if (!a) return { ...base, tab: 'lugares' };
      return {
        ...base,
        tab: 'lugares',
        placeId: a,
        form: b === 'editar' ? 'editar' : null,
        picking: b === 'editar' && c === 'situar',
        photo: b === 'foto',
      };
    case 'salida':
      if (!a) return { ...base, tab: 'salidas' };
      return { ...base, tab: b === 'mapa' ? 'mapa' : 'salidas', tripId: a, tripOnMap: b === 'mapa' };
    default:
      return base;
  }
}

const entry = () => history.state as Partial<Entry> | null;
const depth = () => (typeof entry()?.idx === 'number' ? entry()!.idx! : 0);

/** Mayor profundidad vista, para numerar las entradas que crea el navegador (hash escrito a mano). */
let lastIdx = 0;
let started = false;

/** Deja la entrada actual con una URL reconocible y con su marca. Se puede repetir sin efecto. */
function settle() {
  let hash = location.hash;
  // Sin la pantalla de la que salen (recarga, enlace directo) no hay nada que situar ni que enseñar.
  if (!depth()) hash = hash.replace(TRANSIENT, '');
  if (!/^#\/(mapa|lugares|lugar|salidas|salida|ajustes)(\/|$)/.test(hash)) hash = paths.tab(defaultTab());
  const state = entry();
  if (typeof state?.idx !== 'number') {
    history.replaceState({ idx: started ? lastIdx + 1 : 0, from: '' } satisfies Entry, '', hash);
  } else if (hash !== location.hash) {
    history.replaceState(state, '', hash);
  }
  lastIdx = depth();
  started = true;
}

const read = () => {
  settle();
  return { hash: location.hash, from: depth() > 0 ? (entry()?.from ?? '') : '' };
};

export function useNav() {
  const [loc, setLoc] = useState(read);

  useEffect(() => {
    const onPop = () => setLoc(read());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  /** Abre una pantalla. Con `replace` ocupa el sitio de la actual en vez de apilarse. */
  const go = useCallback((to: string, replace = false) => {
    if (to === location.hash) return;
    if (replace) history.replaceState(history.state, '', to);
    else history.pushState({ idx: depth() + 1, from: location.hash } satisfies Entry, '', to);
    setLoc(read());
  }, []);

  /** Vuelve a la pantalla anterior; si no la hay (se entró por un enlace), va a `fallback`. */
  const back = useCallback(
    (fallback: string) => {
      if (depth() > 0) history.back();
      else go(fallback, true);
    },
    [go],
  );

  return { hash: loc.hash, from: loc.from, route: parseRoute(loc.hash), go, back };
}
