import { useEffect, useState } from 'react';
import { localDate } from './track';
import type { LatLng } from './types';

/*
 * Previsión del tiempo de Open-Meteo (open-meteo.com), gratuita y sin clave.
 * Se le envían las coordenadas de las paradas, redondeadas a unos 100 m, y la
 * fecha de la salida. Solo hay previsión hasta 16 días vista.
 */

export interface Weather {
  /** Código de tiempo de la OMM. */
  code: number;
  min: number;
  max: number;
  /** Probabilidad de lluvia, en %; no siempre viene. */
  rain: number | null;
  /** Racha máxima de viento a 10 m, en km/h. */
  wind: number;
}

export type WeatherState =
  | { status: 'idle' | 'loading' | 'error' | 'far' | 'past' }
  | { status: 'ok'; stops: Weather[] };

const FORECAST_DAYS = 15;

export function describeWeather(code: number): { glyph: string; label: string } {
  if (code === 0) return { glyph: '☀️', label: 'Despejado' };
  if (code <= 2) return { glyph: '🌤️', label: 'Poco nuboso' };
  if (code === 3) return { glyph: '☁️', label: 'Cubierto' };
  if (code <= 48) return { glyph: '🌫️', label: 'Niebla' };
  if (code <= 57) return { glyph: '🌦️', label: 'Llovizna' };
  if (code <= 67) return { glyph: '🌧️', label: 'Lluvia' };
  if (code <= 77) return { glyph: '❄️', label: 'Nieve' };
  if (code <= 82) return { glyph: '🌦️', label: 'Chubascos' };
  if (code <= 86) return { glyph: '❄️', label: 'Chubascos de nieve' };
  return { glyph: '⛈️', label: 'Tormenta' };
}

/** Días desde hoy hasta la fecha (`AAAA-MM-DD`), en el calendario local. */
export function daysUntil(date: string, today = localDate()): number {
  return Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400000);
}

interface Daily {
  weather_code: number[];
  temperature_2m_max: number[];
  temperature_2m_min: number[];
  precipitation_probability_max?: (number | null)[];
  wind_speed_10m_max: number[];
}

/** La respuesta de Open-Meteo (un objeto con un punto, una lista con varios) como un dato por parada. */
export function parseForecast(json: unknown): Weather[] {
  const list = (Array.isArray(json) ? json : [json]) as { daily?: Daily }[];
  return list.map(({ daily }) => {
    if (!daily?.weather_code?.length) throw new Error('previsión');
    return {
      code: daily.weather_code[0],
      min: daily.temperature_2m_min[0],
      max: daily.temperature_2m_max[0],
      rain: daily.precipitation_probability_max?.[0] ?? null,
      wind: daily.wind_speed_10m_max[0],
    };
  });
}

const memory = new Map<string, Weather[]>();

async function fetchForecast(date: string, points: LatLng[]): Promise<Weather[]> {
  const params = new URLSearchParams({
    latitude: points.map((p) => p.lat.toFixed(3)).join(','),
    longitude: points.map((p) => p.lng.toFixed(3)).join(','),
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max',
    timezone: 'auto',
    start_date: date,
    end_date: date,
  });
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error('previsión');
  return parseForecast(await response.json());
}

/** Previsión del día `date` en cada punto, en el mismo orden. */
export function useWeather(date: string, points: LatLng[]): WeatherState {
  const days = /^\d{4}-\d{2}-\d{2}$/.test(date) ? daysUntil(date) : null;
  const wanted = days !== null && days >= 0 && days <= FORECAST_DAYS && points.length > 0;
  const key = wanted ? `${date}|${points.map((p) => `${p.lat.toFixed(3)},${p.lng.toFixed(3)}`).join(';')}` : '';
  const [result, setResult] = useState<{ key: string; state: WeatherState }>({ key: '', state: { status: 'idle' } });

  useEffect(() => {
    if (!key || memory.has(key)) return;
    let cancelled = false;
    // Espera un poco: al añadir o reordenar paradas la lista cambia varias veces seguidas.
    const timer = setTimeout(() => {
      fetchForecast(date, points).then(
        (stops) => {
          memory.set(key, stops);
          if (!cancelled) setResult({ key, state: { status: 'ok', stops } });
        },
        () => !cancelled && setResult({ key, state: { status: 'error' } }),
      );
    }, 700);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // `key` resume la fecha y los puntos.
  }, [key]);

  if (days === null || !points.length) return { status: 'idle' };
  if (days < 0) return { status: 'past' };
  if (days > FORECAST_DAYS) return { status: 'far' };
  const known = memory.get(key);
  if (known) return { status: 'ok', stops: known };
  return result.key === key ? result.state : { status: 'loading' };
}
