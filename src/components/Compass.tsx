import { useEffect, useRef, useState } from 'react';

/*
 * Flecha que señala un rumbo usando la brújula del móvil. Gira sin volver a
 * pintar el resto de la app: el sensor da decenas de lecturas por segundo.
 */

type WithPermission = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<string> };

/** En iOS la brújula hay que pedirla, y solo vale como respuesta a un toque del usuario. */
export function requestCompass() {
  const api = (window as { DeviceOrientationEvent?: WithPermission }).DeviceOrientationEvent;
  api?.requestPermission?.().catch(() => {});
}

/** Hacia dónde apunta la parte de arriba del móvil, en grados desde el norte; `null` si la lectura no sirve. */
function headingOf(e: DeviceOrientationEvent): number | null {
  const ios = (e as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading;
  if (typeof ios === 'number') return ios;
  // En Android solo las lecturas «absolutas» están referidas al norte.
  if (e.absolute && e.alpha !== null) return 360 - e.alpha;
  return null;
}

interface Props {
  /** Rumbo que hay que señalar, en grados desde el norte. */
  bearing: number;
  /** Lo que se enseña si el dispositivo no tiene brújula (por ejemplo «al NE»). */
  fallback: string;
}

export default function Compass({ bearing, fallback }: Props) {
  const el = useRef<HTMLSpanElement>(null);
  const heading = useRef<number | null>(null);
  const target = useRef(bearing);
  target.current = bearing;
  const [available, setAvailable] = useState(false);

  const paint = () => {
    if (el.current && heading.current !== null) {
      el.current.style.transform = `rotate(${target.current - heading.current}deg)`;
    }
  };

  useEffect(() => {
    const onTurn = (e: DeviceOrientationEvent) => {
      const value = headingOf(e);
      if (value === null) return;
      // Con el móvil apaisado, «arriba» de la pantalla ya no es «arriba» del aparato.
      heading.current = value + (screen.orientation?.angle ?? 0);
      setAvailable(true);
      paint();
    };
    window.addEventListener('deviceorientationabsolute', onTurn);
    window.addEventListener('deviceorientation', onTurn);
    return () => {
      window.removeEventListener('deviceorientationabsolute', onTurn);
      window.removeEventListener('deviceorientation', onTurn);
    };
  }, []);

  useEffect(paint);

  if (!available) return <>{fallback}</>;
  return (
    <span ref={el} className="compass" role="img" aria-label={fallback}>
      ↑
    </span>
  );
}
