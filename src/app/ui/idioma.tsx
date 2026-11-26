/**
 * El idioma de la interfaz: español o inglés.
 *
 * ⚠️ **Los textos van al lado de la componente que los pinta, no en un fichero central.**
 * Cada componente declara `const TEXTOS: Record<Idioma, typeof es> = { es, en }`: el
 * compilador obliga a que el inglés tenga exactamente las mismas claves que el español, y
 * quien cambia una frase la tiene delante en los dos idiomas, junto al código que explica
 * por qué dice lo que dice.
 *
 * ⚠️ **Se traduce la interfaz, no los datos ni los diagnósticos.** Lo que trae el contenedor
 * —hallazgos del informe, notas del emisor, ids, métodos de registración— va tal cual: es
 * lo que el `.uos` afirma, y traducirlo sería reescribirlo. Los reparos y errores que
 * escribe el lector (`src/uos`, que no se toca) salen en español en los dos idiomas, y se
 * marcan con `lang="es"` para que un lector de pantalla los pronuncie bien.
 */

import { createContext, useCallback, useContext, useEffect, useState } from 'react';

export type Idioma = 'es' | 'en';

export const IDIOMAS: readonly Idioma[] = ['es', 'en'];

/** Clave de `localStorage`. La lee también el script en línea de `index.html`. */
export const CLAVE_IDIOMA = 'uos-viewer:idioma';

const Contexto = createContext<Idioma>('es');

/** Lo pone `App` en la raíz; el resto lo lee con `useIdioma` o `useTextos`. */
export const ProveedorIdioma = Contexto.Provider;

export function useIdioma(): Idioma {
  return useContext(Contexto);
}

/** Los textos del idioma en uso, de un diccionario declarado junto a la componente. */
export function useTextos<T>(textos: Record<Idioma, T>): T {
  return textos[useIdioma()];
}

/** Un número con los separadores del idioma: `1.234,5` en español, `1,234.5` en inglés. */
export function numero(i: Idioma, v: number, decimales?: number): string {
  return v.toLocaleString(i, decimales === undefined ? undefined
    : { minimumFractionDigits: decimales, maximumFractionDigits: decimales });
}

/** El idioma que el documento ya tiene puesto: lo decide `index.html` antes de pintar. */
function idiomaDelDocumento(): Idioma {
  return document.documentElement.lang === 'en' ? 'en' : 'es';
}

/**
 * El idioma y cómo cambiarlo. Arranca con el del navegador y recuerda la elección.
 *
 * Sin elección guardada, cualquier navegador en español abre en español y el resto en
 * inglés: quien no lee español no tiene que encontrar el botón en una interfaz que no
 * entiende.
 */
export function useEleccionIdioma(): [Idioma, (i: Idioma) => void] {
  const [idioma, setIdioma] = useState<Idioma>(idiomaDelDocumento);

  useEffect(() => {
    document.documentElement.lang = idioma;
  }, [idioma]);

  const elige = useCallback((i: Idioma) => {
    setIdioma(i);
    try {
      localStorage.setItem(CLAVE_IDIOMA, i);
    } catch {
      // Sin almacenamiento la elección dura lo que la pestaña. No es un error que enseñar.
    }
  }, []);

  return [idioma, elige];
}

/** El selector ES | EN de la barra. Dos botones y no un desplegable: son dos opciones. */
export function SelectorIdioma({ idioma, alCambiar }: {
  idioma: Idioma; alCambiar: (i: Idioma) => void;
}) {
  return (
    <span className="selector-idioma" role="group"
      aria-label={idioma === 'es' ? 'Idioma' : 'Language'}>
      {IDIOMAS.map((i) => (
        <button key={i} type="button" lang={i} aria-pressed={idioma === i}
          title={i === 'es' ? 'Español' : 'English'} onClick={() => alCambiar(i)}>
          {i.toUpperCase()}
        </button>
      ))}
    </span>
  );
}
