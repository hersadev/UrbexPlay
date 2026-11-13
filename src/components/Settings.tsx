import { useRef, useState } from 'react';
import { CATALOG } from '../catalog';
import script from '../../google-apps-script/Code.gs?raw';
import { exportBackup, importBackup } from '../store';
import { isScriptUrl, type SyncConfig, type SyncStatus } from '../sync';
import type { Data } from '../types';

interface Props {
  data: Data;
  setData: (data: Data) => void;
  placeCount: number;
  setNotice: (text: string) => void;
  syncConfig: SyncConfig | null;
  syncStatus: SyncStatus;
  onSyncConfig: (config: SyncConfig | null) => void;
  onSync: () => void;
}

const time = (ms: number) => new Date(ms).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

function SyncSection({ config, status, onConfig, onSync, setNotice }: {
  config: SyncConfig | null;
  status: SyncStatus;
  onConfig: (config: SyncConfig | null) => void;
  onSync: () => void;
  setNotice: (text: string) => void;
}) {
  const [url, setUrl] = useState(config?.url ?? '');
  const [key, setKey] = useState(config?.key ?? '');
  const [error, setError] = useState('');

  const copyScript = async () => {
    if (key.trim().length < 6) return setError('Elige primero una clave de al menos 6 caracteres.');
    setError('');
    try {
      await navigator.clipboard.writeText(script.replace('CAMBIA-ESTA-CLAVE', () => key.trim().replace(/['\\]/g, '')));
      setNotice('Script copiado con tu clave. Pégalo en Extensiones → Apps Script de la hoja.');
    } catch {
      setNotice('No se ha podido copiar. El script está en google-apps-script/Code.gs.');
    }
  };

  const connect = () => {
    if (!isScriptUrl(url)) return setError('La URL debe ser la de la aplicación web: https://script.google.com/macros/s/…/exec');
    if (key.trim().length < 6) return setError('Escribe la misma clave que pusiste en el script.');
    setError('');
    onConfig({ url: url.trim(), key: key.trim().replace(/['\\]/g, '') });
  };

  return (
    <section>
      <h2>Sincronizar con Google Sheets</h2>
      {config ? (
        <>
          <p className="prose">
            {status.state === 'syncing' && 'Sincronizando…'}
            {status.state === 'ok' && `Sincronizado a las ${time(status.at!)}.`}
            {status.state === 'error' && <span className="error">{status.message}</span>}
            {status.state === 'off' && 'Conectado.'}
          </p>
          {!!status.skipped && (
            <p className="muted small">
              {status.skipped} {status.skipped === 1 ? 'fila' : 'filas'} de la hoja sin nombre o sin coordenadas válidas:
              no se {status.skipped === 1 ? 'ha' : 'han'} cargado.
            </p>
          )}
          <div className="row">
            <button className="btn primary" onClick={onSync} disabled={status.state === 'syncing'}>
              Sincronizar ahora
            </button>
            <button
              className="btn danger"
              onClick={() => confirm('¿Desconectar la hoja? Tus datos se quedan en este dispositivo.') && onConfig(null)}
            >
              Desconectar
            </button>
          </div>
          <p className="muted small">
            Se sincroniza sola al abrir la app y tras cada cambio. Las fotos no se suben: se quedan en el dispositivo
            donde las hiciste. Para borrar algo desde la hoja, escribe TRUE en su columna «borrado».
          </p>
        </>
      ) : (
        <>
          <p className="prose">
            Conecta una hoja de cálculo de Google para tener lo mismo en el móvil y en el ordenador. Se hace una vez:
          </p>
          <ol className="steps">
            <li>Elige una clave y escríbela aquí abajo.</li>
            <li>
              Pulsa «Copiar script». En tu hoja, abre <em>Extensiones → Apps Script</em>, borra lo que haya, pega y
              guarda.
            </li>
            <li>
              <em>Implementar → Nueva implementación → Aplicación web</em>. Ejecutar como: <em>Yo</em>. Acceso:{' '}
              <em>Cualquier usuario</em>. Autoriza cuando lo pida.
            </li>
            <li>Copia la URL de la aplicación web, pégala aquí y pulsa «Conectar».</li>
            <li>En el otro dispositivo solo hay que repetir este último paso, con la misma URL y clave.</li>
          </ol>
          <label className="field">
            Clave
            <input className="input" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" />
          </label>
          <div className="row">
            <button className="btn" onClick={copyScript}>
              Copiar script
            </button>
          </div>
          <label className="field">
            URL de la aplicación web
            <input
              className="input"
              type="url"
              value={url}
              placeholder="https://script.google.com/macros/s/…/exec"
              onChange={(e) => setUrl(e.target.value)}
              autoComplete="off"
            />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="row">
            <button className="btn primary" onClick={connect}>
              Conectar
            </button>
          </div>
        </>
      )}
    </section>
  );
}

export default function Settings({ data, setData, placeCount, setNotice, syncConfig, syncStatus, onSyncConfig, onSync }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const visited = Object.values(data.diary).filter((d) => d.status === 'visitado').length;
  const pending = Object.values(data.diary).filter((d) => d.status === 'pendiente').length;
  const hidden = CATALOG.filter((p) => data.hidden.includes(p.id));

  const download = async () => {
    setBusy(true);
    try {
      const blob = await exportBackup(data);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `urbexplay-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setNotice('No se ha podido crear la copia.');
    } finally {
      setBusy(false);
    }
  };

  const restore = async (file: File | undefined) => {
    if (!file) return;
    if (!confirm('Importar una copia sustituye todos los datos actuales de este navegador. ¿Continuar?')) return;
    setBusy(true);
    try {
      setData(await importBackup(file));
      setNotice('Copia importada.');
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'No se ha podido importar la copia.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="view">
      <header className="view-head">
        <h1>Ajustes</h1>
      </header>

      <dl className="stats">
        <div>
          <dt>Lugares</dt>
          <dd>{placeCount}</dd>
        </div>
        <div>
          <dt>Visitados</dt>
          <dd>{visited}</dd>
        </div>
        <div>
          <dt>Pendientes</dt>
          <dd>{pending}</dd>
        </div>
        <div>
          <dt>Salidas</dt>
          <dd>{data.trips.length}</dd>
        </div>
      </dl>

      <SyncSection
        key={syncConfig ? 'on' : 'off'}
        config={syncConfig}
        status={syncStatus}
        onConfig={onSyncConfig}
        onSync={onSync}
        setNotice={setNotice}
      />

      <section>
        <h2>Copia de seguridad</h2>
        <p className="prose">
          Un fichero con todo lo de este dispositivo: tus lugares, notas, salidas y también las fotos, que no viajan
          con la sincronización. Importarlo sustituye lo que haya.
        </p>
        <div className="row">
          <button className="btn primary" onClick={download} disabled={busy}>
            Exportar copia
          </button>
          <button className="btn" onClick={() => fileInput.current?.click()} disabled={busy}>
            Importar copia
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              restore(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>
      </section>

      {hidden.length > 0 && (
        <section>
          <h2>Lugares ocultos del catálogo</h2>
          <ul className="sources">
            {hidden.map((p) => (
              <li key={p.id}>
                {p.name}{' '}
                <button
                  className="link"
                  onClick={() => setData({ ...data, hidden: data.hidden.filter((id) => id !== p.id) })}
                >
                  Recuperar
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2>Uso sin cobertura</h2>
        <p className="prose">
          Instala la app desde el menú del navegador («Añadir a pantalla de inicio»). Las fichas, tu diario y tus salidas
          funcionan sin conexión. Del mapa solo se guardan las zonas que hayas visto antes: recorre la zona de la salida
          con el zoom que vayas a usar mientras tengas wifi.
        </p>
      </section>

      <section>
        <h2>Sobre los datos</h2>
        <p className="prose">
          La historia y las coordenadas del catálogo inicial proceden de los artículos de Wikipedia enlazados en cada
          ficha. Las leyendas se presentan aparte, como lo que se cuenta y no como hechos. La ficha práctica es
          orientativa: confirma siempre accesos y titularidad.
        </p>
        <p className="prose">
          Mapas: OpenStreetMap y el Instituto Geográfico Nacional (ortofoto PNOA y mapa topográfico, CC BY 4.0).
        </p>
      </section>

      <section className="warn">
        <strong>Explora con cabeza</strong>
        <ul>
          <li>No entres en propiedad privada sin permiso ni fuerces cierres.</li>
          <li>Nunca vayas solo y deja dicho a alguien dónde vas.</li>
          <li>No entres en minas ni en edificios con riesgo de derrumbe.</li>
          <li>No te lleves nada ni dejes nada: solo fotos.</li>
        </ul>
      </section>
    </div>
  );
}
