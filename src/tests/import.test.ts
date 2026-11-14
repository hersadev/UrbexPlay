import { describe, expect, it } from 'vitest';
import { parseLocation } from '../import';

const point = (text: string) => parseLocation(text)?.point;

describe('parseLocation', () => {
  it('lee coordenadas decimales con coma o espacio', () => {
    expect(point('37.86833, -1.51216')).toEqual({ lat: 37.86833, lng: -1.51216 });
    expect(point('37.86833 -1.51216')).toEqual({ lat: 37.86833, lng: -1.51216 });
  });

  it('lee enlaces largos de Google Maps y prefiere el punto exacto al centro del mapa', () => {
    const url = 'https://www.google.com/maps/place/Sanatorio/@37.9,-1.6,15z/data=!3d37.86833!4d-1.51216';
    expect(parseLocation(url)).toEqual({ point: { lat: 37.86833, lng: -1.51216 }, name: 'Sanatorio' });
    expect(point('https://maps.google.com/?q=37.5,-1.25')).toEqual({ lat: 37.5, lng: -1.25 });
  });

  it('explica por qué no sirve un enlace corto', () => {
    expect(() => parseLocation('https://maps.app.goo.gl/abc123')).toThrow(/enlaces cortos/);
  });

  it('devuelve null si no hay ubicación o está fuera de rango', () => {
    expect(parseLocation('')).toBeNull();
    expect(parseLocation('un texto cualquiera')).toBeNull();
    expect(parseLocation('137.5, -1.2')).toBeNull();
  });
});
