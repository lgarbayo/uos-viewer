import { useCallback, useEffect, useRef, useState } from 'react';

/** Un aviso efímero: sin esto, una tecla que no cambia nada visible parece rota. */
export function useAviso(): {
  aviso: { texto: string; visible: boolean };
  avisa: (texto: string) => void;
} {
  const [aviso, setAviso] = useState({ texto: '', visible: false });
  const borra = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(borra.current), []);
  const avisa = useCallback((texto: string) => {
    setAviso({ texto, visible: true });
    clearTimeout(borra.current);
    borra.current = setTimeout(() => setAviso((a) => ({ ...a, visible: false })), 1600);
  }, []);
  return { aviso, avisa };
}
