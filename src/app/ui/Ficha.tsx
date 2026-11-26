/**
 * La ficha de la pieza seleccionada, FLOTANDO sobre el lienzo, junto a donde se mira.
 *
 * De dónde viene cada mitad va escrito: la geometría la segmentó un modelo (Layer 3) y lo
 * clínico lo dice un informe que firmó una persona (Layer 1). Son dos fuentes con dos
 * regímenes distintos, y presentarlas juntas sin decirlo las igualaría.
 */

import { fichaDe, type Pieza } from '../../uos/Clinico';

export type Seleccion =
  | { readonly tipo: 'ninguna' }
  | { readonly tipo: 'pieza'; readonly fdi: number }
  /** Un clic que no acertó ninguna pieza: encía, vacío o sin asignar. */
  | { readonly tipo: 'fallo' };

interface Props {
  readonly hayEtiquetas: boolean;
  readonly seleccion: Seleccion;
  readonly piezas: ReadonlyMap<string, Pieza>;
  readonly segmentador: string;
  readonly alCerrar: () => void;
}

export function Ficha({ hayEtiquetas, seleccion, piezas, segmentador, alCerrar }: Props) {
  // `#ficha:not(:empty)` es lo que le pone la caja: sin etiquetas no hay nada que decir.
  if (!hayEtiquetas) return <div id="ficha" />;
  if (seleccion.tipo === 'ninguna') {
    return <div id="ficha"><p className="nota">pincha un diente para aislarlo y ver qué dice
      de él el informe</p></div>;
  }
  if (seleccion.tipo === 'fallo') {
    // Ni encía ni vacío se distinguen del «no ha acertado»: los tres significan «aquí no
    // hay pieza», y decirlo es lo que permite comprobar si la segmentación cubre lo que
    // debería. Callar sería indistinguible de que el picking esté roto.
    return <div id="ficha"><p className="nota">ahí no hay pieza: encía, o sin asignar</p></div>;
  }
  const { fdi } = seleccion;
  // ⚠️ **Una pieza sin ficha clínica tiene que decirlo igual**, o no se distingue de «el
  // clic no ha acertado nada». El código FDI va siempre, venga o no con texto.
  const p = piezas.get(String(fdi));
  return (
    <div id="ficha">
      <button id="quita-pieza" className="cerrar" title="ver la arcada entera"
        onClick={alCerrar}>✕</button>
      <p className="pieza-fdi">FDI <b>{fdi}</b></p>
      {p
        // `fichaDe` es del lector (`src/uos`, que no se toca) y devuelve HTML: se inyecta
        // tal cual, exactamente como lo hacía el `innerHTML` de antes de React.
        ? <div dangerouslySetInnerHTML={{ __html: fichaDe(fdi, p, true) }} />
        : <p className="nota">el informe no dice nada de esta pieza</p>}
      <p className="nota">segmentada por {segmentador || '—'} · <span className="l3">Layer 3</span></p>
    </div>
  );
}
