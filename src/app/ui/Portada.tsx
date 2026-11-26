/** Estado inicial, apertura en curso y errores. Desaparece en cuanto hay un contenedor. */

import type { ReactNode } from 'react';

import { useIdioma, type Idioma } from './idioma';

type Estado = { readonly abriendo: string } | { readonly error: string } | null;

const es = {
  abriendo: (nombre: ReactNode) => <>Abriendo {nombre}…</>,
  titular: <>Arrastra un <b>.uos</b> aquí</>,
  descripcion: 'Visor de referencia del formato. Abre el contenedor sin saber nada de quién lo '
    + 'escribió: lee el manifiesto, ordena los assets y aplica una vista guardada.',
  nota: 'Nada sale de tu navegador: el contenedor se lee en local, por rangos, sin subirlo a '
    + 'ningún sitio.',
};

const TEXTOS: Record<Idioma, typeof es> = {
  es,
  en: {
    abriendo: (nombre) => <>Opening {nombre}…</>,
    titular: <>Drop a <b>.uos</b> here</>,
    descripcion: 'Reference viewer for the format. It opens the container knowing nothing about '
      + 'who wrote it: it reads the manifest, sorts the assets and applies a saved view.',
    nota: 'Nothing leaves your browser: the container is read locally, by byte ranges, without '
      + 'uploading it anywhere.',
  },
};

export function Portada({ estado }: { estado: Estado }) {
  const idioma = useIdioma();
  const t = TEXTOS[idioma];
  if (estado && 'abriendo' in estado) {
    return <div id="portada"><p>{t.abriendo(<code>{estado.abriendo}</code>)}</p></div>;
  }
  if (estado && 'error' in estado) {
    // El mensaje lo escribe el lector o el visor, en español: se marca como tal.
    return <div id="portada"><p className="error" lang="es">{estado.error}</p></div>;
  }
  return (
    <div id="portada">
      <div className="marca">Unified Oral Scene</div>
      <p className="titular">{t.titular}</p>
      <p>{t.descripcion}</p>
      <p className="nota">{t.nota}</p>
    </div>
  );
}
