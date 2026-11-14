import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyData, stampChanges } from '../store';
import { exchange, type SyncBase } from '../sync';
import type { Data, Diary, Visit } from '../types';

/*
 * Dos dispositivos contra una hoja simulada. La mezcla del lado de la hoja es
 * la función `fusionar` del propio script de Google, leída de su fichero.
 */

type Row = Record<string, string>;
const script = readFileSync(new URL('../../google-apps-script/Code.gs', import.meta.url), 'utf8');
const { fusionar, HOJAS } = new Function(`${script}; return { fusionar, HOJAS };`)() as {
  fusionar: (headers: string[], rows: string[][], changes: Row[], now: number, newId: () => string) => { filas: string[][] };
  HOJAS: Record<string, string[]>;
};

let sheet: Record<string, string[][]>;
const config = { url: 'https://script.google.com/macros/s/x/exec', key: 'clave-de-prueba' };

beforeEach(() => {
  sheet = Object.fromEntries(Object.keys(HOJAS).map((name) => [name, []]));
  vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
    const { cambios } = JSON.parse(init.body) as { cambios: Record<string, Row[]> };
    const datos: Record<string, Row[]> = {};
    for (const [name, headers] of Object.entries(HOJAS)) {
      sheet[name] = fusionar(headers, sheet[name], cambios[name] ?? [], 1, () => 'nuevo').filas;
      datos[name] = sheet[name].map((row) => Object.fromEntries(headers.map((h, i) => [h, row[i]])));
    }
    return { json: async () => ({ ok: true, datos }) };
  });
});
afterEach(() => vi.unstubAllGlobals());

const visit = (id: string, date: string): Visit => ({ id, date, notes: '', photos: [] });

class Device {
  data: Data = emptyData();
  base: SyncBase = {};
  /** Edita el diario del lugar `x` como lo haría la app, a la hora `at`. */
  edit(at: number, change: (d: Diary) => Diary) {
    vi.setSystemTime(at);
    const current = this.data.diary.x ?? { status: 'ninguno', notes: '', visits: [] };
    this.data = stampChanges(this.data, { ...this.data, diary: { ...this.data.diary, x: change(current) } });
  }
  async sync(at: number) {
    vi.setSystemTime(at);
    const { apply, base } = await exchange(config, this.data, this.base);
    this.data = apply(this.data).data;
    this.base = base;
  }
}

describe('dos dispositivos y una hoja', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  for (const [first, second] of [
    ['móvil', 'ordenador'],
    ['ordenador', 'móvil'],
  ]) {
    it(`no pierde la visita de ninguno si el ${first} edita antes y sincroniza antes`, async () => {
      const devices = { móvil: new Device(), ordenador: new Device() };
      const a = devices[first as 'móvil'];
      const b = devices[second as 'móvil'];

      a.edit(100, (d) => ({ ...d, status: 'pendiente', visits: [visit('v0', '2026-01-01')] }));
      await a.sync(110);
      await b.sync(120);
      expect(b.data.diary.x.visits.map((v) => v.id)).toEqual(['v0']);

      // Los dos editan el mismo diario sin sincronizar entre medias.
      a.edit(200, (d) => ({ ...d, notes: 'llevar linterna', visits: [visit('va', '2026-02-01'), ...d.visits] }));
      b.edit(300, (d) => ({ ...d, status: 'visitado', visits: [visit('vb', '2026-03-01'), ...d.visits] }));

      await a.sync(400);
      await b.sync(500);
      await a.sync(600);

      for (const device of [a, b]) {
        expect(device.data.diary.x.visits.map((v) => v.id)).toEqual(['vb', 'va', 'v0']);
        expect(device.data.diary.x).toMatchObject({ status: 'visitado', notes: 'llevar linterna' });
      }
      // Y ya no queda nada por enviar: otra ronda no cambia nada.
      const settled = JSON.stringify([a.data, b.data]);
      await b.sync(700);
      await a.sync(800);
      expect(JSON.stringify([a.data, b.data])).toBe(settled);
    });
  }

  it('respeta la visita borrada en un dispositivo mientras el otro añadía otra', async () => {
    const a = new Device();
    const b = new Device();
    a.edit(100, (d) => ({ ...d, visits: [visit('v1', '2026-01-02'), visit('v0', '2026-01-01')] }));
    await a.sync(110);
    await b.sync(120);
    a.edit(200, (d) => ({ ...d, visits: d.visits.filter((v) => v.id !== 'v0') }));
    b.edit(300, (d) => ({ ...d, visits: [visit('v2', '2026-01-03'), ...d.visits] }));
    await b.sync(400);
    await a.sync(500);
    await b.sync(600);
    for (const device of [a, b]) expect(device.data.diary.x.visits.map((v) => v.id)).toEqual(['v2', 'v1']);
  });
});
