import { describe, expect, it } from 'vitest';
import { baseFrom, hasUnsyncedDiary, mergeDiary, mergeRemote, type SyncBase } from '../sync';
import { emptyData } from '../store';
import type { Data, Diary, Visit } from '../types';

const visit = (id: string, extra: Partial<Visit> = {}): Visit => ({ id, date: '2026-01-01', notes: '', photos: [], ...extra });
const diary = (extra: Partial<Diary> = {}): Diary => ({ status: 'ninguno', notes: '', visits: [], ...extra });
const diaryRow = (id: string, d: Diary, stamp: number) => ({
  id,
  lugar: '',
  estado: d.status,
  notas: d.notes,
  visitas: JSON.stringify(d.visits),
  actualizado: String(stamp),
  borrado: '',
});
const withDiary = (d: Diary, stamp: number): Data => ({ ...emptyData(), diary: { x: d }, stamps: { 'd:x': stamp } });

describe('mergeDiary', () => {
  it('conserva las visitas añadidas en cada dispositivo', () => {
    const base = diary({ visits: [visit('a')] });
    const mine = diary({ visits: [visit('b', { date: '2026-02-01' }), visit('a')] });
    const theirs = diary({ visits: [visit('c', { date: '2026-03-01' }), visit('a')] });
    expect(mergeDiary(base, mine, theirs, 'mine').visits.map((v) => v.id)).toEqual(['c', 'b', 'a']);
  });

  it('respeta la visita borrada en un lado', () => {
    const base = diary({ visits: [visit('a'), visit('b')] });
    const mine = diary({ visits: [visit('b')] });
    const theirs = diary({ visits: [visit('a'), visit('b'), visit('c')] });
    expect(mergeDiary(base, mine, theirs, 'theirs').visits.map((v) => v.id).sort()).toEqual(['b', 'c']);
  });

  it('toma de cada lado lo que ese lado cambió', () => {
    const base = diary({ status: 'pendiente', notes: 'ir en otoño' });
    const mine = diary({ status: 'visitado', notes: 'ir en otoño' });
    const theirs = diary({ status: 'pendiente', notes: 'ir en otoño, por la tarde' });
    expect(mergeDiary(base, mine, theirs, 'theirs')).toMatchObject({
      status: 'visitado',
      notes: 'ir en otoño, por la tarde',
    });
  });

  it('guarda las dos notas cuando se han reescrito en los dos lados', () => {
    const base = diary({ notes: 'base' });
    const merged = mergeDiary(base, diary({ notes: 'la mía' }), diary({ notes: 'la suya' }), 'mine');
    expect(merged.notes).toBe('la mía\n\nla suya');
  });

  it('en una misma visita suma las fotos nuevas y quita las borradas', () => {
    const base = diary({ visits: [visit('a', { photos: ['p1', 'p2'] })] });
    const mine = diary({ visits: [visit('a', { photos: ['p1', 'p2', 'p3'], notes: 'mía' })] });
    const theirs = diary({ visits: [visit('a', { photos: ['p2', 'p4'] })] });
    const [merged] = mergeDiary(base, mine, theirs, 'mine').visits;
    expect(merged.photos).toEqual(['p2', 'p3', 'p4']);
    expect(merged.notes).toBe('mía');
  });

  it('sin versión común une lo de los dos', () => {
    const merged = mergeDiary(null, diary({ visits: [visit('a')] }), diary({ visits: [visit('b')] }), 'mine');
    expect(merged.visits).toHaveLength(2);
  });
});

describe('mergeRemote', () => {
  it('aplica la fila de la hoja cuando es más reciente', () => {
    const local = withDiary(diary({ notes: 'vieja' }), 10);
    const remote = { Diario: [diaryRow('x', diary({ notes: 'nueva' }), 20)] };
    const base: SyncBase = { x: { stamp: 10, diary: diary({ notes: 'vieja' }) } };
    const { data } = mergeRemote(local, remote, base, 99);
    expect(data.diary.x.notes).toBe('nueva');
    expect(data.stamps['d:x']).toBe(20);
  });

  it('no toca lo local cuando la hoja es más antigua y no ha cambiado', () => {
    const local = withDiary(diary({ notes: 'nueva' }), 30);
    const remote = { Diario: [diaryRow('x', diary({ notes: 'vieja' }), 10)] };
    const base: SyncBase = { x: { stamp: 10, diary: diary({ notes: 'vieja' }) } };
    expect(mergeRemote(local, remote, base, 99).data).toBe(local);
  });

  it('mezcla el diario cambiado en los dos lados, gane quien gane el reloj', () => {
    const common = diary({ visits: [visit('a')] });
    const base: SyncBase = { x: { stamp: 10, diary: common } };
    const mine = diary({ visits: [visit('b'), visit('a')] });
    const theirs = diary({ visits: [visit('c'), visit('a')] });
    for (const [localStamp, remoteStamp] of [
      [20, 30],
      [30, 20],
    ]) {
      const { data } = mergeRemote(withDiary(mine, localStamp), { Diario: [diaryRow('x', theirs, remoteStamp)] }, base, 99);
      expect(data.diary.x.visits.map((v) => v.id).sort()).toEqual(['a', 'b', 'c']);
      // La mezcla lleva una marca posterior a las dos, para que llegue a la hoja.
      expect(data.stamps['d:x']).toBe(99);
    }
  });

  it('borra el diario que la hoja da por borrado', () => {
    const local = withDiary(diary({ notes: 'x' }), 10);
    const row = { ...diaryRow('x', diary(), 20), borrado: 'TRUE' };
    expect(mergeRemote(local, { Diario: [row] }, { x: { stamp: 10, diary: diary({ notes: 'x' }) } }).data.diary).toEqual({});
  });

  it('carga un lugar escrito a mano en la hoja y cuenta las filas ilegibles', () => {
    const remote = {
      Lugares: [
        { id: 'n1', nombre: 'Casa', lat: '37,5', lng: '-1,2', actualizado: '5', borrado: '' },
        { id: 'n2', nombre: '', lat: '37.5', lng: '-1.2', actualizado: '5', borrado: '' },
      ],
    };
    const { data, skipped } = mergeRemote(emptyData(), remote);
    expect(skipped).toBe(1);
    expect(data.custom).toHaveLength(1);
    expect(data.custom[0]).toMatchObject({ id: 'n1', lat: 37.5, lng: -1.2, type: 'edificio' });
  });

  it('conserva aparcamiento y entrada si la hoja no tiene esas columnas', () => {
    const place = { ...mergeRemote(emptyData(), { Lugares: [{ id: 'n1', nombre: 'Casa', lat: '37.5', lng: '-1.2', actualizado: '5', borrado: '' }] }).data.custom[0], parkingAt: { lat: 1, lng: 2 } };
    const local: Data = { ...emptyData(), custom: [place], stamps: { 'p:n1': 5 } };
    const newer = { Lugares: [{ id: 'n1', nombre: 'Casa nueva', lat: '37.5', lng: '-1.2', actualizado: '9', borrado: '' }] };
    expect(mergeRemote(local, newer).data.custom[0]).toMatchObject({ name: 'Casa nueva', parkingAt: { lat: 1, lng: 2 } });
    const emptied = { Lugares: [{ ...newer.Lugares[0], aparcamiento_coords: '' }] };
    expect(mergeRemote(local, emptied).data.custom[0].parkingAt).toBeUndefined();
  });
});

describe('estado recordado de la hoja', () => {
  it('detecta diarios cambiados aquí que la hoja no conoce', () => {
    const base = baseFrom({ Diario: [diaryRow('x', diary(), 10)] });
    expect(hasUnsyncedDiary(withDiary(diary(), 10), base)).toBe(false);
    expect(hasUnsyncedDiary(withDiary(diary(), 11), base)).toBe(true);
    expect(hasUnsyncedDiary({ ...emptyData(), stamps: { 'd:nuevo': 5 } }, base)).toBe(true);
  });
});
