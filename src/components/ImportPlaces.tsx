import { useMemo, useRef, useState } from 'react';
import { distanceKm, formatCoords } from '../geo';
import { parseFile, parseLines, type ImportItem } from '../import';
import { uid } from '../store';
import { TYPE_META, TYPES, type Place, type PlaceType } from '../types';

interface Props {
  places: Place[];
  onImport: (places: Place[]) => void;
  onCancel: () => void;
}

interface Row extends ImportItem {
  key: string;
  /** Lugar ya existente a menos de 50 m. */
  duplicateOf?: string;
}

export default function ImportPlaces({ places, onImport, onCancel }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [type, setType] = useState<PlaceType>('edificio');
  const [province, setProvince] = useState('');
  const [message, setMessage] = useState('');

  const addItems = (items: ImportItem[], note = '') => {
    const known = [...places, ...rows];
    const added: Row[] = [];
    for (const item of items) {
      const near = [...known, ...added].find((p) => distanceKm(p, item) < 0.05);
      added.push({ ...item, key: uid(), duplicateOf: near?.name || (near ? 'otro punto de la lista' : undefined) });
    }
    setRows((prev) => [...prev, ...added]);
    setSelected((prev) => new Set([...prev, ...added.filter((r) => !r.duplicateOf).map((r) => r.key)]));
    const repeated = added.filter((r) => r.duplicateOf).length;
    setMessage(
      [
        items.length ? `${items.length} ${items.length === 1 ? 'punto leído' : 'puntos leídos'}.` : 'No se ha encontrado ningún punto.',
        repeated ? `${repeated} ya ${repeated === 1 ? 'existe' : 'existen'} y ${repeated === 1 ? 'queda desmarcado' : 'quedan desmarcados'}.` : '',
        note,
      ]
        .filter(Boolean)
        .join(' '),
    );
  };

  const readFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const items: ImportItem[] = [];
    const problems: string[] = [];
    for (const file of Array.from(files)) {
      try {
        items.push(...parseFile(await file.text(), file.name));
      } catch (e) {
        problems.push(e instanceof Error ? e.message : `No se ha podido leer ${file.name}.`);
      }
    }
    addItems(items, problems.join(' '));
  };

  const readText = () => {
    const { items, unread } = parseLines(text);
    addItems(
      items,
      unread.length ? `${unread.length} ${unread.length === 1 ? 'línea sin' : 'líneas sin'} ubicación reconocible (los enlaces cortos no sirven).` : '',
    );
    if (items.length) setText(unread.join('\n'));
  };

  const chosen = useMemo(() => rows.filter((r) => selected.has(r.key)), [rows, selected]);

  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const rename = (key: string, name: string) => setRows((prev) => prev.map((r) => (r.key === key ? { ...r, name } : r)));

  const submit = () =>
    onImport(
      chosen.map((r, i) => ({
        id: uid(),
        name: r.name.trim() || `Lugar importado ${i + 1}`,
        type,
        lat: r.lat,
        lng: r.lng,
        town: '',
        province: province.trim(),
        summary: '',
        history: r.description,
        legend: '',
        sources: [],
        practical: { state: '', access: '', ownership: 'desconocida', difficulty: 1, risks: '', parking: '', gear: '' },
        custom: true,
      })),
    );

  return (
    <div className="view">
      <header className="view-head">
        <h1>Importar lugares</h1>
        <button className="link" onClick={onCancel}>
          Cancelar
        </button>
      </header>

      <section>
        <h2>Desde un fichero</h2>
        <p className="muted">
          KML (Google My Maps, Google Earth), GPX o GeoJSON. Se leen los puntos; las líneas y zonas se ignoran.
        </p>
        <div className="row">
          <button className="btn" onClick={() => fileInput.current?.click()}>
            Elegir ficheros
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".kml,.gpx,.json,.geojson,.kmz"
            multiple
            hidden
            onChange={(e) => {
              readFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </div>
      </section>

      <section>
        <h2>Pegando enlaces o coordenadas</h2>
        <label className="field">
          Uno por línea. Puedes poner el nombre delante.
          <textarea
            className="input"
            rows={4}
            value={text}
            placeholder={'Cortijo del Tío Juan 37.9123, -1.3456\nhttps://www.google.com/maps/place/…'}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <div className="row">
          <button className="btn" onClick={readText} disabled={!text.trim()}>
            Leer
          </button>
        </div>
      </section>

      {message && (
        <p className="muted" role="status">
          {message}
        </p>
      )}

      {rows.length > 0 && (
        <section>
          <h2>
            {chosen.length} de {rows.length} para importar
          </h2>
          <ul className="import-list">
            {rows.map((r) => (
              <li key={r.key}>
                <input
                  type="checkbox"
                  checked={selected.has(r.key)}
                  onChange={() => toggle(r.key)}
                  aria-label={`Importar ${r.name || 'punto sin nombre'}`}
                />
                <span className="card-body">
                  <input
                    className="input"
                    value={r.name}
                    placeholder="Sin nombre"
                    onChange={(e) => rename(r.key, e.target.value)}
                    aria-label="Nombre"
                  />
                  <span className="muted small">
                    {formatCoords(r)}
                    {r.duplicateOf && ` · ya existe: ${r.duplicateOf}`}
                  </span>
                </span>
              </li>
            ))}
          </ul>

          <div className="grid2">
            <label className="field">
              Tipo para todos
              <select className="input" value={type} onChange={(e) => setType(e.target.value as PlaceType)}>
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_META[t].label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Provincia para todos (opcional)
              <input className="input" value={province} onChange={(e) => setProvince(e.target.value)} />
            </label>
          </div>
          <p className="muted small">
            Entran sin historia ni fuentes, y con la ficha práctica en blanco: complétalos después desde cada ficha.
          </p>
        </section>
      )}

      <footer className="row sticky">
        <button className="btn primary" onClick={submit} disabled={!chosen.length}>
          Importar {chosen.length || ''} {chosen.length === 1 ? 'lugar' : 'lugares'}
        </button>
        <button className="btn" onClick={onCancel}>
          Cancelar
        </button>
      </footer>
    </div>
  );
}
