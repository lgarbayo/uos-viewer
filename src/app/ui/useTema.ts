import { useCallback, useEffect, useState } from 'react';

export type Tema = 'claro' | 'oscuro';

/** Clave de `localStorage`. La lee también el script en línea de `index.html`. */
export const CLAVE_TEMA = 'uos-viewer:tema';

/**
 * El tema que el documento ya tiene puesto.
 *
 * ⚠️ **Lo decide el script en línea de `index.html`, antes de pintar.** Si lo decidiera
 * React, la primera pintura saldría con el tema por defecto y saltaría al bueno un
 * fotograma después: un fogonazo blanco en una sala a oscuras, o al revés.
 */
function temaDelDocumento(): Tema {
  return document.documentElement.dataset['theme'] === 'light' ? 'claro' : 'oscuro';
}

function guardado(): Tema | null {
  // ⚠️ Dentro de try/catch SIEMPRE: en una ventana privada, con los datos del sitio
  // bloqueados o en algunos iframes, `localStorage` lanza al leerse. Sin preferencia
  // guardada manda `prefers-color-scheme`, que es lo correcto.
  try {
    const v = localStorage.getItem(CLAVE_TEMA);
    return v === 'claro' || v === 'oscuro' ? v : null;
  } catch {
    return null;
  }
}

/**
 * El tema y cómo cambiarlo. Arranca con `prefers-color-scheme` y recuerda la elección.
 *
 * Mientras el usuario no elija, el visor sigue al sistema también en vivo: si el sistema
 * pasa a oscuro al anochecer, el visor pasa con él. En cuanto elige, manda su elección.
 */
export function useTema(): [Tema, (t: Tema) => void] {
  const [tema, setTema] = useState<Tema>(temaDelDocumento);

  useEffect(() => {
    document.documentElement.dataset['theme'] = tema === 'claro' ? 'light' : 'dark';
  }, [tema]);

  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: light)');
    const cambia = (e: MediaQueryListEvent): void => {
      if (guardado() === null) setTema(e.matches ? 'claro' : 'oscuro');
    };
    mq.addEventListener('change', cambia);
    return () => mq.removeEventListener('change', cambia);
  }, []);

  const elige = useCallback((t: Tema) => {
    setTema(t);
    try {
      localStorage.setItem(CLAVE_TEMA, t);
    } catch {
      // Sin almacenamiento la elección dura lo que la pestaña. No es un error que enseñar.
    }
  }, []);

  return [tema, elige];
}
