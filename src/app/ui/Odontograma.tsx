/**
 * Las dos arcadas en rejilla FDI, que es como se lee un diente en una clínica.
 *
 * ⚠️ **Es PERMANENTE, no un modal.** El odontograma es el ÍNDICE del caso: se pincha un
 * diente, se mira, se pincha el siguiente. Detrás de un botón, mirar dos piezas seguidas
 * costaba cuatro clics. Y en la rejilla un hueco es un hueco: se ve que no hay 18 ni 28 sin
 * contar nada.
 */

import { useLayoutEffect, useRef } from 'react';

import { aCss, type Pieza } from '../../uos/Clinico';
import type { Caso } from '../Caso';

const ARCADAS: readonly (readonly [string, readonly number[]])[] = [
  ['superior · derecha del paciente → izquierda',
   [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28]],
  ['inferior · derecha del paciente → izquierda',
   [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38]],
];

interface Props {
  readonly segmentadas: readonly number[];
  readonly piezas: ReadonlyMap<string, Pieza>;
  readonly frontera: Caso['frontera'];
  readonly seleccionada: number | null;
  readonly alPulsar: (fdi: number) => void;
}

export function Odontograma({ segmentadas, piezas, frontera, seleccionada, alPulsar }: Props) {
  const raiz = useRef<HTMLDivElement>(null);
  const hay = new Set(segmentadas);

  /*
   * Publica el alto REAL de la carta para que la ficha flotante sepa dónde acaba.
   *
   * ⚠️ Sin esto la ficha se metía por debajo del odontograma y su último párrafo quedaba
   * cortado a media frase. El alto depende del texto de la leyenda, de la fuente y del
   * ancho de la ventana —la leyenda envuelve—, así que hay que medirlo y volver a medirlo.
   */
  useLayoutEffect(() => {
    const el = raiz.current;
    if (!el) return;
    const raizDoc = document.documentElement;
    const mide = (): void => raizDoc.style.setProperty('--alto-carta', `${el.offsetHeight}px`);
    mide();
    const ro = new ResizeObserver(mide);
    ro.observe(el);
    return () => {
      ro.disconnect();
      raizDoc.style.setProperty('--alto-carta', '0px');
    };
  }, []);

  return (
    <div id="odontograma" ref={raiz}>
      <div className="fila">
        {ARCADAS.map(([rotulo, fdis]) => (
          <div className="arcada" key={rotulo}>
            <div className="rotulo">{rotulo}</div>
            <div className="dientes">{fdis.map((fdi) => {
              const p = piezas.get(String(fdi));
              const esta = hay.has(fdi);
              const recorte = frontera?.piezas.get(fdi);
              const dudoso = esta && recorte !== undefined && !recorte.within_expert_range;
              return (
                <button key={fdi} className="diente" data-fdi={fdi} data-hay={esta ? 'si' : 'no'}
                  aria-pressed={seleccionada === fdi} disabled={!esta}
                  title={esta ? 'aislar esta pieza' : 'la segmentación no trae esta pieza'}
                  onClick={() => alPulsar(fdi)}>
                  <span className="fdi">{fdi}</span>
                  {/* El tono del tercio medio, el que un dentista compara contra una guía.
                      Sin color medido queda gris: ausencia declarada, no un tono. */}
                  <span className="tono"
                    style={p?.color?.measured ? { background: aCss(p.color.middle) } : undefined} />
                  <span className="marcas">
                    {p?.findings.length
                      ? <span className="hall" title={p.findings.join(', ')}>●</span>
                      : p ? '·' : ''}
                    {dudoso && <span className="recorte" title={
                      `recorte fuera del rango de experto: ${recorte.mesiodistal_mm.toFixed(1)} mm ` +
                      `frente a ${recorte.table_mm.toFixed(1)} de tabla`}>!</span>}
                  </span>
                </button>
              );
            })}</div>
          </div>
        ))}
        <div className="leyenda">
          <p className="nota"><b>{segmentadas.length}</b> pieza(s) segmentada(s) · la barra de
            cada casilla es el <b>tercio medio</b> del color medido.</p>
          <p className="nota">En gris: sin color declarado — ahí el campo pinta el degradado de
            respaldo, que no es color del paciente.</p>
          <p className="nota">● hallazgo en el informe</p>
          {frontera && <p className="nota"><span className="recorte">!</span> recorte fuera del
            rango de experto · <span className="l3">Capa 3</span></p>}
        </div>
      </div>
    </div>
  );
}
