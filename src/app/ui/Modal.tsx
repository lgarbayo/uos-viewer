import type { ReactNode } from 'react';

/**
 * Un modal de esquina. El contenido se monta al abrir y se desmonta al cerrar.
 *
 * ⚠️ El fondo cierra; el contenido no. Sin la comprobación, un clic dentro de la lista de
 * assets cerraba el modal a media lectura.
 */
export function Modal({ titulo, alCerrar, children }: {
  titulo: string; alCerrar: () => void; children: ReactNode;
}) {
  return (
    <div id="modal" onClick={(e) => { if (e.target === e.currentTarget) alCerrar(); }}>
      <div id="caja-modal" role="dialog" aria-modal="true" aria-labelledby="titulo-modal">
        <header>
          <h2 id="titulo-modal">{titulo}</h2>
          <button id="cierra-modal" title="cerrar (Esc)" onClick={alCerrar}>✕</button>
        </header>
        <div id="cuerpo-modal">{children}</div>
      </div>
    </div>
  );
}
