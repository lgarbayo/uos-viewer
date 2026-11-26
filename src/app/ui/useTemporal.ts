import { useCallback, useEffect, useRef } from 'react';

/**
 * Un `setTimeout` que se cancela solo al desmontar.
 *
 * ⚠️ Los botones de guardar y regenerar vuelven a su texto a los pocos segundos. Sin esto,
 * cerrar el modal antes dejaba el temporizador vivo actualizando un componente muerto.
 */
export function useTemporal(): (fn: () => void, ms: number) => void {
  const ids = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const vivos = ids.current;
    return () => {
      for (const id of vivos) clearTimeout(id);
      vivos.clear();
    };
  }, []);
  return useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      ids.current.delete(id);
      fn();
    }, ms);
    ids.current.add(id);
  }, []);
}
