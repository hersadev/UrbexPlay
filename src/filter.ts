import type { PlaceType, Status } from './types';

/** Filtro de lugares, compartido por la lista y el mapa. */
export interface Filter {
  query: string;
  types: Set<PlaceType>;
  province: string;
  status: Status | '';
  /** Radio en km desde la posición; 0 = a cualquier distancia. */
  radius: number;
  onlyLegend: boolean;
}

export const noFilter = (): Filter => ({
  query: '',
  types: new Set(),
  province: '',
  status: '',
  radius: 0,
  onlyLegend: false,
});

/** Cuántos criterios hay puestos. */
export const filterCount = (f: Filter) =>
  f.types.size + [f.query.trim(), f.province, f.status, f.radius, f.onlyLegend].filter(Boolean).length;

export function toggleType(f: Filter, type: PlaceType): Filter {
  const types = new Set(f.types);
  if (!types.delete(type)) types.add(type);
  return { ...f, types };
}
