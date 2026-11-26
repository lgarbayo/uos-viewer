/**
 * La barra superior lleva SOLO lo que identifica el contenedor abierto: caso, estado PHI,
 * versión del formato y quién lo generó. Es lo único que un clínico necesita ver
 * permanentemente; todo lo demás se pide y se cierra.
 */

import type { ReactNode } from 'react';

import type { Manifiesto } from '../../uos/Manifest';

interface Props {
  readonly manifiesto: Manifiesto | null;
  readonly alAbrir: (f: File) => void;
  /** Lo que va a la derecha del botón de abrir (el interruptor de tema). */
  readonly extremo?: ReactNode;
}

export function Barra({ manifiesto: m, alAbrir, extremo }: Props) {
  return (
    <header id="barra">
      <div id="marca">uos<span>-viewer</span></div>
      <div id="identidad">
        {m && (
          <>
            <span className="caso" title={m.case_id}>{m.case_id}</span>
            <span className={`phi phi-${m.phi_state}`}>{m.phi_state}</span>
            <span className="campo">uos <b>{m.uos_version}</b></span>
            <span className="campo">{m.generator['name'] ?? '—'} <b>{m.generator['version'] ?? ''}</b></span>
            <span className="campo">marco <b>{m.canonical_frame.id}</b> ({m.canonical_frame.units})</span>
            <span className="campo">visitas <b>{m.visits.map((v) => v.id).join(', ') || '—'}</b></span>
          </>
        )}
      </div>
      <label className="boton">
        abrir <code>.uos</code>
        <input id="fichero" type="file" accept=".uos" hidden onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) alAbrir(f);
          // Para que volver a elegir EL MISMO fichero dispare `change` otra vez.
          e.target.value = '';
        }} />
      </label>
      {extremo}
    </header>
  );
}
