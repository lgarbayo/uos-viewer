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
import { useIdioma, type Idioma } from './idioma';

const ARCADAS: readonly (readonly ['superior' | 'inferior', readonly number[]])[] = [
  ['superior', [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28]],
  ['inferior', [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38]],
];

const es = {
  superior: 'superior · derecha del paciente → izquierda',
  inferior: 'inferior · derecha del paciente → izquierda',
  aislar: 'aislar esta pieza',
  noLaTrae: 'la segmentación no trae esta pieza',
  // Las cifras con toFixed(1), como antes: el tooltip no cambia de separador con el idioma.
  recorteFuera: (mm: string, tabla: string) =>
    `recorte fuera del rango de experto: ${mm} mm frente a ${tabla} de tabla`,
  segmentadas: (n: number) => <><b>{n}</b> pieza(s) segmentada(s) · la barra de
    cada casilla es el <b>tercio medio</b> del color medido.</>,
  enGris: <>En gris: sin color declarado — ahí el campo pinta el degradado de
    respaldo, que no es color del paciente.</>,
  hallazgo: '● hallazgo en el informe',
  recorteLeyenda: 'recorte fuera del rango de experto',
};

const TEXTOS: Record<Idioma, typeof es> = {
  es,
  en: {
    superior: 'upper · patient’s right → left',
    inferior: 'lower · patient’s right → left',
    aislar: 'isolate this tooth',
    noLaTrae: 'the segmentation does not include this tooth',
    recorteFuera: (mm, tabla) =>
      `crop outside the expert range: ${mm} mm vs. ${tabla} in the table`,
    segmentadas: (n) => <><b>{n}</b> segmented {n === 1 ? 'tooth' : 'teeth'} · the bar in
      each cell is the <b>middle third</b> of the measured color.</>,
    enGris: <>In gray: no declared color — there the field paints the fallback
      gradient, which is not the patient’s color.</>,
    hallazgo: '● finding in the report',
    recorteLeyenda: 'crop outside the expert range',
  },
};

interface Props {
  readonly segmentadas: readonly number[];
  readonly piezas: ReadonlyMap<string, Pieza>;
  readonly frontera: Caso['frontera'];
  readonly seleccionada: number | null;
  readonly alPulsar: (fdi: number) => void;
}

export function Odontograma({ segmentadas, piezas, frontera, seleccionada, alPulsar }: Props) {
  const t = TEXTOS[useIdioma()];
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
        {ARCADAS.map(([arcada, fdis]) => (
          <div className="arcada" key={arcada}>
            <div className="rotulo">{t[arcada]}</div>
            <div className="dientes">{fdis.map((fdi) => {
              const p = piezas.get(String(fdi));
              const esta = hay.has(fdi);
              const recorte = frontera?.piezas.get(fdi);
              const dudoso = esta && recorte !== undefined && !recorte.within_expert_range;
              return (
                <button key={fdi} className="diente" data-fdi={fdi} data-hay={esta ? 'si' : 'no'}
                  aria-pressed={seleccionada === fdi} disabled={!esta}
                  title={esta ? t.aislar : t.noLaTrae}
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
                    {dudoso && <span className="recorte" title={t.recorteFuera(
                      recorte.mesiodistal_mm.toFixed(1), recorte.table_mm.toFixed(1))}>!</span>}
                  </span>
                </button>
              );
            })}</div>
          </div>
        ))}
        <div className="leyenda">
          <p className="nota">{t.segmentadas(segmentadas.length)}</p>
          <p className="nota">{t.enGris}</p>
          <p className="nota">{t.hallazgo}</p>
          {/* De qué `derived_seg` sale el recorte, y no una Capa supuesta: la Capa la dice su
              sidecar en «Qué se ve» y en Contenedor → Inferencia. */}
          {frontera && <p className="nota"><span className="recorte">!</span> {t.recorteLeyenda}
            {' '}· <code>{frontera.id}</code></p>}
        </div>
      </div>
    </div>
  );
}
