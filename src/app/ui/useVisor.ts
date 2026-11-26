import { useEffect, useState, type RefObject } from 'react';

import { Visor } from '../Visor';

/**
 * Monta el `Visor` sobre un elemento y lo libera al desmontar.
 *
 * ⚠️ **La limpieza lo suelta TODO, y no es un detalle.** El modo estricto de React monta,
 * desmonta y vuelve a montar este efecto en desarrollo: si `dispose` se dejara algo —un
 * contexto WebGL, el `DropInViewer` y sus workers, los controles de órbita, el `resize`—, cada
 * recarga en caliente lo duplicaría, y el tope de contextos del navegador se alcanza pronto.
 * Lo que se suelta está enumerado en `Visor.dispose`.
 *
 * Devuelve el visor en ESTADO y no sólo en un ref, para que quien lo use se entere de que
 * el del segundo montaje es otro objeto.
 */
export function useVisor(montaje: RefObject<HTMLElement | null>): Visor | null {
  const [visor, setVisor] = useState<Visor | null>(null);
  useEffect(() => {
    const el = montaje.current;
    if (!el) return;
    const v = new Visor(el);
    setVisor(v);
    return () => {
      setVisor(null);
      void v.dispose();
    };
  }, [montaje]);
  return visor;
}
