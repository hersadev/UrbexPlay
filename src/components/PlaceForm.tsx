import { useEffect, useState } from 'react';
import { formatCoords, parseCoords } from '../geo';
import { sourcesToText, textToSources } from '../sources';
import { uid } from '../store';
import {
  DIFFICULTY_LABEL,
  OWNERSHIP_LABEL,
  TYPE_META,
  TYPES,
  type LatLng,
  type Ownership,
  type Place,
  type PlaceType,
} from '../types';

interface Props {
  place?: Place;
  /** Punto elegido tocando el mapa. */
  picked: LatLng | null;
  userPos: LatLng | null;
  onPick: () => void;
  onSave: (place: Place) => void;
  onCancel: () => void;
}

export default function PlaceForm({ place, picked, userPos, onPick, onSave, onCancel }: Props) {
  const [name, setName] = useState(place?.name ?? '');
  const [type, setType] = useState<PlaceType>(place?.type ?? 'edificio');
  const [coords, setCoords] = useState(place ? formatCoords(place) : '');
  const [town, setTown] = useState(place?.town ?? '');
  const [province, setProvince] = useState(place?.province ?? 'Murcia');
  const [summary, setSummary] = useState(place?.summary ?? '');
  const [history, setHistory] = useState(place?.history ?? '');
  const [legend, setLegend] = useState(place?.legend ?? '');
  const [sources, setSources] = useState(sourcesToText(place?.sources ?? []));
  const [practical, setPractical] = useState(
    place?.practical ?? {
      state: '',
      access: '',
      ownership: 'desconocida' as Ownership,
      difficulty: 1 as 1 | 2 | 3,
      risks: '',
      parking: '',
      gear: '',
    },
  );
  const [coordsTouched, setCoordsTouched] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (picked) {
      setCoords(formatCoords(picked));
      setCoordsTouched(true);
    }
  }, [picked]);

  const setP = <K extends keyof typeof practical>(key: K, value: (typeof practical)[K]) =>
    setPractical((prev) => ({ ...prev, [key]: value }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const point = parseCoords(coords);
    if (!name.trim()) return setError('Ponle un nombre al lugar.');
    if (!point) return setError('Indica las coordenadas como «latitud, longitud» o elígelas en el mapa.');
    onSave({
      id: place?.id ?? uid(),
      name: name.trim(),
      type,
      lat: point.lat,
      lng: point.lng,
      // Si no se han tocado las coordenadas, conserva el aviso de «aproximadas».
      approx: coordsTouched ? false : place?.approx,
      town: town.trim(),
      province: province.trim(),
      summary: summary.trim(),
      history: history.trim(),
      legend: legend.trim(),
      sources: textToSources(sources),
      practical,
    });
  };

  return (
    <form className="view form" onSubmit={submit}>
      <header className="view-head">
        <h1>{place ? 'Editar lugar' : 'Nuevo lugar'}</h1>
        <button type="button" className="link" onClick={onCancel}>
          Cancelar
        </button>
      </header>

      <label className="field">
        Nombre
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
      </label>

      <label className="field">
        Tipo
        <select className="input" value={type} onChange={(e) => setType(e.target.value as PlaceType)}>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_META[t].label}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        Coordenadas (latitud, longitud)
        <input
          className="input"
          value={coords}
          placeholder="37.86833, -1.51216"
          inputMode="text"
          onChange={(e) => {
            setCoords(e.target.value);
            setCoordsTouched(true);
          }}
        />
      </label>
      <div className="row">
        <button type="button" className="btn" onClick={onPick}>
          Elegir en el mapa
        </button>
        {userPos && (
          <button
            type="button"
            className="btn"
            onClick={() => {
              setCoords(formatCoords(userPos));
              setCoordsTouched(true);
            }}
          >
            Usar mi posición
          </button>
        )}
      </div>

      <div className="grid2">
        <label className="field">
          Municipio
          <input className="input" value={town} onChange={(e) => setTown(e.target.value)} />
        </label>
        <label className="field">
          Provincia
          <input className="input" value={province} onChange={(e) => setProvince(e.target.value)} />
        </label>
      </div>

      <label className="field">
        Resumen en una línea
        <input className="input" value={summary} onChange={(e) => setSummary(e.target.value)} />
      </label>

      <label className="field">
        Historia (lo documentado)
        <textarea className="input" rows={5} value={history} onChange={(e) => setHistory(e.target.value)} />
      </label>

      <label className="field">
        Lo que se cuenta (leyendas, testimonios)
        <textarea className="input" rows={4} value={legend} onChange={(e) => setLegend(e.target.value)} />
      </label>

      <label className="field">
        Fuentes, una por línea
        <textarea
          className="input"
          rows={3}
          value={sources}
          placeholder={'Título | https://…\nLibro, artículo o «me lo contó un vecino de…»'}
          onChange={(e) => setSources(e.target.value)}
        />
      </label>

      <h2>Ficha práctica</h2>
      <label className="field">
        Estado del lugar
        <input className="input" value={practical.state} onChange={(e) => setP('state', e.target.value)} />
      </label>
      <label className="field">
        Acceso
        <textarea className="input" rows={2} value={practical.access} onChange={(e) => setP('access', e.target.value)} />
      </label>
      <div className="grid2">
        <label className="field">
          Propiedad
          <select
            className="input"
            value={practical.ownership}
            onChange={(e) => setP('ownership', e.target.value as Ownership)}
          >
            {(Object.keys(OWNERSHIP_LABEL) as Ownership[]).map((o) => (
              <option key={o} value={o}>
                {OWNERSHIP_LABEL[o]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Dificultad
          <select
            className="input"
            value={practical.difficulty}
            onChange={(e) => setP('difficulty', Number(e.target.value) as 1 | 2 | 3)}
          >
            {([1, 2, 3] as const).map((n) => (
              <option key={n} value={n}>
                {DIFFICULTY_LABEL[n]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
        Riesgos
        <textarea className="input" rows={2} value={practical.risks} onChange={(e) => setP('risks', e.target.value)} />
      </label>
      <label className="field">
        Dónde aparcar
        <input className="input" value={practical.parking} onChange={(e) => setP('parking', e.target.value)} />
      </label>
      <label className="field">
        Equipo recomendado
        <input className="input" value={practical.gear} onChange={(e) => setP('gear', e.target.value)} />
      </label>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <footer className="row sticky">
        <button type="submit" className="btn primary">
          Guardar
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancelar
        </button>
      </footer>
    </form>
  );
}
