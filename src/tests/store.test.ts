import { describe, expect, it } from 'vitest';
import { backupDue, emptyData, stampChanges } from '../store';
import type { Data, Place, Trip } from '../types';

const place = (id: string, name = id) => ({ id, name }) as unknown as Place;
const trip = (id: string, placeIds: string[] = []): Trip => ({ id, name: '', date: '', notes: '', placeIds });
const base: Data = {
  ...emptyData(),
  custom: [place('a'), place('b')],
  hidden: ['h1'],
  diary: { a: { status: 'pendiente', notes: '', visits: [] } },
  trips: [trip('t1', ['a'])],
  stamps: { 'p:a': 1, 'p:b': 1, 'h:h1': 1, 'd:a': 1, 't:t1': 1 },
};

describe('stampChanges', () => {
  it('no hace nada si no cambia nada', () => {
    expect(stampChanges(base, base)).toBe(base);
  });

  it('marca solo el registro que cambia', () => {
    const next = stampChanges(base, { ...base, diary: { a: { ...base.diary.a, notes: 'hola' } } });
    expect(next.stamps['d:a']).toBeGreaterThan(1);
    expect({ ...next.stamps, 'd:a': 1 }).toEqual(base.stamps);
  });

  it('no marca un registro recreado con el mismo contenido', () => {
    const next = stampChanges(base, { ...base, custom: base.custom.map((p) => ({ ...p })) });
    expect(next.stamps).toEqual(base.stamps);
  });

  it('marca los registros nuevos y los borrados, que conservan su marca', () => {
    const next = stampChanges(base, {
      ...base,
      custom: [base.custom[0], place('c')],
      hidden: [],
      trips: [],
    });
    for (const key of ['p:b', 'p:c', 'h:h1', 't:t1']) expect(next.stamps[key]).toBeGreaterThan(1);
    expect(next.stamps['p:a']).toBe(1);
  });
});

describe('recordatorio de copia', () => {
  const DAY = 86400000;
  const now = 100 * DAY;
  const withStamp = (stamp: number, photos: string[] = []): Data => ({
    ...emptyData(),
    diary: { x: { status: 'visitado', notes: '', visits: [{ id: 'v', date: '2026-01-01', notes: '', photos }] } },
    stamps: { 'd:x': stamp },
  });

  it('no avisa sin datos ni antes de que pase el plazo', () => {
    expect(backupDue(emptyData(), {}, false, now)).toBe(false);
    expect(backupDue(withStamp(now - 5 * DAY), {}, false, now)).toBe(false);
    expect(backupDue(withStamp(now - 40 * DAY), {}, false, now)).toBe(true);
  });

  it('cuenta desde la última copia y solo si hay cambios posteriores', () => {
    expect(backupDue(withStamp(now - 50 * DAY), { at: now - 40 * DAY }, false, now)).toBe(false);
    expect(backupDue(withStamp(now - DAY), { at: now - 40 * DAY }, false, now)).toBe(true);
    expect(backupDue(withStamp(now - DAY), { at: now - 10 * DAY }, false, now)).toBe(false);
  });

  it('calla una semana al posponerlo', () => {
    const data = withStamp(now - 40 * DAY);
    expect(backupDue(data, { snoozed: now - 2 * DAY }, false, now)).toBe(false);
    expect(backupDue(data, { snoozed: now - 8 * DAY }, false, now)).toBe(true);
  });

  it('con la hoja conectada solo avisa si hay fotos o recorridos', () => {
    expect(backupDue(withStamp(now - 40 * DAY), {}, true, now)).toBe(false);
    expect(backupDue(withStamp(now - 40 * DAY, ['f1']), {}, true, now)).toBe(true);
  });
});
