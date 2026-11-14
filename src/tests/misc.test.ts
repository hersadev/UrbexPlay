import { describe, expect, it } from 'vitest';
import { bearing, cardinal, distanceKm, nearestOnLine } from '../geo';
import { sunTimes } from '../sun';
import { toGpx, trackKm, trackMinutes } from '../track';
import { makeZip, readZip } from '../zip';

const MURCIA = { lat: 37.99, lng: -1.13 };
/** Minutos UTC desde medianoche. */
const utcMinutes = (d: Date) => d.getUTCHours() * 60 + d.getUTCMinutes();

describe('sunTimes', () => {
  it('acierta el solsticio de verano en Murcia con pocos minutos de margen', () => {
    const sun = sunTimes('2026-06-21', MURCIA)!;
    // Efemérides: sale hacia las 04:44 UTC y se pone hacia las 19:32 UTC.
    expect(Math.abs(utcMinutes(sun.sunrise) - (4 * 60 + 44))).toBeLessThanOrEqual(4);
    expect(Math.abs(utcMinutes(sun.sunset) - (19 * 60 + 32))).toBeLessThanOrEqual(4);
  });

  it('ordena amanecer, horas doradas y atardecer', () => {
    const sun = sunTimes('2026-12-21', MURCIA)!;
    expect(sun.sunrise < sun.goldenMorningEnd).toBe(true);
    expect(sun.goldenMorningEnd < sun.goldenEveningStart).toBe(true);
    expect(sun.goldenEveningStart < sun.sunset).toBe(true);
  });

  it('devuelve null con fecha inválida o sin amanecer', () => {
    expect(sunTimes('', MURCIA)).toBeNull();
    expect(sunTimes('2026-06-21', { lat: 80, lng: 0 })).toBeNull();
  });
});

describe('geo', () => {
  it('mide distancias y rumbos', () => {
    expect(distanceKm(MURCIA, { lat: 37.6, lng: -0.98 })).toBeCloseTo(45.3, 0);
    expect(bearing(MURCIA, { lat: 38.99, lng: -1.13 })).toBeCloseTo(0, 5);
    expect(cardinal(MURCIA, { lat: 37.99, lng: -0.13 })).toBe('E');
    expect(cardinal(MURCIA, { lat: 36.99, lng: -2.4 })).toBe('SO');
  });

  it('encuentra el punto más cercano de un trazado', () => {
    const line: [number, number][] = [
      [37, -1],
      [37, -0.9],
      [37.1, -0.9],
    ];
    const near = nearestOnLine(line, { lat: 37.01, lng: -0.95 });
    expect(near.index).toBe(0);
    expect(near.point[0]).toBeCloseTo(37, 5);
    expect(near.point[1]).toBeCloseTo(-0.95, 5);
    expect(near.km).toBeCloseTo(1.11, 1);
  });
});

describe('recorridos', () => {
  const points: [number, number, number][] = [
    [37, -1, 0],
    [37.001, -1, 60000],
    [37.002, -1, 150000],
  ];

  it('calcula distancia y duración', () => {
    expect(trackKm(points)).toBeCloseTo(0.222, 2);
    expect(trackMinutes(points)).toBe(2.5);
  });

  it('genera un GPX con todos los puntos y el nombre escapado', () => {
    const gpx = toGpx('Mina <A> & B', points);
    expect(gpx.match(/<trkpt /g)).toHaveLength(3);
    expect(gpx).toContain('lat="37.001000" lon="-1.000000"');
    expect(gpx).toContain('<time>1970-01-01T00:01:00.000Z</time>');
    expect(gpx).not.toContain('<A>');
  });
});

describe('zip', () => {
  it('lo que se guarda se lee igual', async () => {
    const binary = new Uint8Array(5000).map((_, i) => (i * 31) % 256);
    const zip = await makeZip([
      { name: 'datos.json', data: new Blob(['{"a":"ñ"}']) },
      { name: 'fotos/uno.jpg', data: new Blob([binary]) },
    ]);
    const files = await readZip(zip);
    expect([...files.keys()]).toEqual(['datos.json', 'fotos/uno.jpg']);
    expect(await (await files.get('datos.json')!()).text()).toBe('{"a":"ñ"}');
    expect(new Uint8Array(await (await files.get('fotos/uno.jpg')!()).arrayBuffer())).toEqual(binary);
  });

  it('rechaza un fichero que no es un ZIP', async () => {
    await expect(readZip(new Blob(['PK esto no es un zip']))).rejects.toThrow(/dañado/);
  });
});

describe('plan de la salida', () => {
  it('lleva las paradas con sus coordenadas, las horas y la ruta', async () => {
    const { tripPlan } = await import('../plan');
    const stop = (name: string, lat: number, lng: number) => ({ name, town: 'Cartagena', lat, lng }) as never;
    const text = tripPlan(
      { id: 't', name: 'Baterías', date: '2026-11-21', notes: '', placeIds: [], leaveAt: '08:30', backAt: '19:00', start: { lat: 37.99, lng: -1.13, label: 'Murcia' } },
      [stop('Castillitos', 37.54037, -1.12016), stop('Cenizas', 37.58, -0.82)],
    );
    expect(text).toContain('Salida de urbex: Baterías');
    expect(text).toContain('salgo a las 08:30');
    expect(text).toContain('Salgo de: Murcia');
    expect(text).toContain('1. Castillitos, Cartagena');
    expect(text).toContain('37.54037, -1.12016 · https://www.google.com/maps?q=37.54037,-1.12016');
    expect(text).toContain('Vuelta prevista: 19:00');
    expect(text).toContain('Ruta completa: https://www.google.com/maps/dir/');
  });
});

describe('tiempo previsto', () => {
  it('lee la respuesta de Open-Meteo con uno o varios puntos', async () => {
    const { parseForecast, daysUntil, describeWeather } = await import('../weather');
    const point = (code: number) => ({
      daily: { weather_code: [code], temperature_2m_max: [21.8], temperature_2m_min: [8.7], precipitation_probability_max: [2], wind_speed_10m_max: [4.3] },
    });
    expect(parseForecast(point(3))).toEqual([{ code: 3, min: 8.7, max: 21.8, rain: 2, wind: 4.3 }]);
    expect(parseForecast([point(0), point(95)]).map((w) => describeWeather(w.code).label)).toEqual(['Despejado', 'Tormenta']);
    expect(() => parseForecast({ error: true })).toThrow();
    expect(daysUntil('2026-11-21', '2026-11-14')).toBe(7);
    expect(daysUntil('2026-11-13', '2026-11-14')).toBe(-1);
  });
});
