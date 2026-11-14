import type { LatLng } from './types';

/*
 * Horas de sol calculadas en el dispositivo (ecuación del amanecer), sin
 * ningún servicio: funciona sin cobertura. Precisión de uno o dos minutos con
 * horizonte llano; en un valle o tras una sierra el sol llega más tarde y se
 * va antes.
 */

export interface SunTimes {
  sunrise: Date;
  sunset: Date;
  /** Fin de la hora dorada de la mañana: el sol supera los 6° de altura. */
  goldenMorningEnd: Date;
  /** Inicio de la hora dorada de la tarde: el sol baja de los 6°. */
  goldenEveningStart: Date;
}

const RAD = Math.PI / 180;
const DAY_MS = 86400000;
const J1970 = 2440587.5;
const J2000 = 2451545;

/** Altura del centro del sol al amanecer: refracción más el radio del disco. */
const HORIZON = -0.833;
const GOLDEN = 6;

/**
 * Horas de sol de un día (`AAAA-MM-DD`) en un punto. Devuelve `null` si la
 * fecha no es válida o si ese día el sol no sale o no se pone.
 */
export function sunTimes(date: string, point: LatLng): SunTimes | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const noon = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
  // Días desde J2000 hasta el mediodía solar medio de ese día en esa longitud.
  const n = Math.round(noon / DAY_MS + J1970 - J2000) + 0.0009 - point.lng / 360;
  const anomaly = (357.5291 + 0.98560028 * n) * RAD;
  const center = 1.9148 * Math.sin(anomaly) + 0.02 * Math.sin(2 * anomaly) + 0.0003 * Math.sin(3 * anomaly);
  const lambda = (anomaly / RAD + center + 180 + 102.9372) * RAD;
  const transit = J2000 + n + 0.0053 * Math.sin(anomaly) - 0.0069 * Math.sin(2 * lambda);
  const sinDec = Math.sin(lambda) * Math.sin(23.4397 * RAD);
  const cosDec = Math.cos(Math.asin(sinDec));
  const phi = point.lat * RAD;

  /** Días entre el mediodía solar y el paso del sol por esa altura. */
  const offset = (altitude: number) => {
    const cos = (Math.sin(altitude * RAD) - Math.sin(phi) * sinDec) / (Math.cos(phi) * cosDec);
    return Math.abs(cos) > 1 ? null : Math.acos(cos) / RAD / 360;
  };
  const toDate = (julian: number) => new Date((julian - J1970) * DAY_MS);

  const horizon = offset(HORIZON);
  if (horizon === null) return null;
  // En invierno, muy al norte, el sol puede no llegar a 6°: todo el día es hora dorada.
  const golden = offset(GOLDEN) ?? 0;
  return {
    sunrise: toDate(transit - horizon),
    sunset: toDate(transit + horizon),
    goldenMorningEnd: toDate(transit - golden),
    goldenEveningStart: toDate(transit + golden),
  };
}

export const formatTime = (date: Date) => date.toLocaleTimeString('es-ES', { hour: 'numeric', minute: '2-digit' });
