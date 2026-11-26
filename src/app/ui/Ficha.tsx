/**
 * La ficha de la pieza seleccionada, FLOTANDO sobre el lienzo, junto a donde se mira.
 *
 * De dónde viene cada mitad va escrito: la geometría la segmentó un modelo (Layer 3) y lo
 * clínico lo dice un informe que firmó una persona (Layer 1). Son dos fuentes con dos
 * regímenes distintos, y presentarlas juntas sin decirlo las igualaría.
 */

import type { Pieza } from '../../uos/Clinico';
import { avisoDeFrontera, type MetaSegmentacion } from '../../uos/Derivados';
import type { Caso } from '../Caso';
import { margenDePieza, type FronteraPieza } from '../Segmentacion';
import { FichaClinica } from './FichaClinica';
import { useIdioma, type Idioma } from './idioma';

export type Seleccion =
  | { readonly tipo: 'ninguna' }
  | { readonly tipo: 'pieza'; readonly fdi: number }
  /** Un clic que no acertó ninguna pieza: encía, vacío o sin asignar. */
  | { readonly tipo: 'fallo' };

const es = {
  pincha: 'pincha un diente para aislarlo y ver qué dice de él el informe',
  noHayPieza: 'ahí no hay pieza: encía, o sin asignar',
  verArcada: 'ver la arcada entera',
  sinInforme: 'el informe no dice nada de esta pieza',
  // ⚠️ En español la frase es la del lector tal cual (`avisoDeFrontera`, con tests): así no
  // hay dos redacciones que puedan separarse. En inglés se rehace con los mismos números.
  aviso: (_f: FronteraPieza, delLector: string) => delLector,
  segmentadaPor: 'segmentada por',
  capa: (n: number) => `Capa ${n}`,
  capaNoDeclarada: 'Capa no declarada',
};

const TEXTOS: Record<Idioma, typeof es> = {
  es,
  en: {
    pincha: 'click a tooth to isolate it and see what the report says about it',
    noHayPieza: 'no tooth there: gingiva, or unassigned',
    verArcada: 'show the whole arch',
    sinInforme: 'the report says nothing about this tooth',
    aviso: (f) => `⚠️ the crop of this tooth is NOT reliable: it measures `
      + `${f.mesiodistal_mm.toFixed(1)} mm mesiodistal against ${f.table_mm.toFixed(1)} in the `
      + `table, ${Math.abs(f.excess_mm).toFixed(1)} mm ${f.excess_mm > 0 ? 'wider' : 'narrower'}. `
      + `When selected it may carry surface that is not its own`,
    segmentadaPor: 'segmented by',
    capa: (n) => `Layer ${n}`,
    capaNoDeclarada: 'Layer not declared',
  },
};

interface Props {
  readonly hayEtiquetas: boolean;
  readonly seleccion: Seleccion;
  readonly piezas: ReadonlyMap<string, Pieza>;
  readonly segmentador: string;
  /** La Capa que DECLARA el sidecar de la segmentación que numera, o `null` si no la declara. */
  readonly capa: number | null;
  readonly frontera: Caso['frontera'];
  readonly margen: Caso['margen'];
  readonly alCerrar: () => void;
}

export function Ficha({
  hayEtiquetas, seleccion, piezas, segmentador, capa, frontera, margen, alCerrar,
}: Props) {
  const idioma = useIdioma();
  const t = TEXTOS[idioma];
  // `#ficha:not(:empty)` es lo que le pone la caja: sin etiquetas no hay nada que decir.
  if (!hayEtiquetas) return <div id="ficha" />;
  if (seleccion.tipo === 'ninguna') {
    return <div id="ficha"><p className="nota">{t.pincha}</p></div>;
  }
  if (seleccion.tipo === 'fallo') {
    // Ni encía ni vacío se distinguen del «no ha acertado»: los tres significan «aquí no
    // hay pieza», y decirlo es lo que permite comprobar si la segmentación cubre lo que
    // debería. Callar sería indistinguible de que el picking esté roto.
    return <div id="ficha"><p className="nota">{t.noHayPieza}</p></div>;
  }
  const { fdi } = seleccion;
  // ⚠️ **Una pieza sin ficha clínica tiene que decirlo igual**, o no se distingue de «el
  // clic no ha acertado nada». El código FDI va siempre, venga o no con texto.
  const p = piezas.get(String(fdi));
  // ⚠️ **Lo que dice la segmentación de ESTA pieza, al lado de lo que dice el informe.** Sin
  // el aviso de frontera, el visor enciende una corona que arrastra medio diente vecino y
  // lo que se lee al lado —color, hallazgos— es correcto: quien mira concluye que la
  // geometría también. `avisoDeFrontera` es la regla del lector, la misma que tiene tests.
  const aviso = frontera ? avisoDeFrontera({ per_tooth_boundary: {
    criterion: '', note: '', teeth: Object.fromEntries(frontera.piezas) },
  } as unknown as MetaSegmentacion, fdi) : '';
  const datosFrontera = frontera?.piezas.get(fdi);
  const lineaMargen = margen ? margenDePieza(margen.margen, fdi, idioma) : null;
  return (
    <div id="ficha">
      <button id="quita-pieza" className="cerrar" title={t.verArcada}
        onClick={alCerrar}>✕</button>
      <p className="pieza-fdi">FDI <b>{fdi}</b></p>
      {p
        // La presentación de `fichaDe` del lector, traducida: mismas clases, mismo envoltorio.
        ? <div><FichaClinica fdi={fdi} pieza={p} segmentada /></div>
        : <p className="nota">{t.sinInforme}</p>}
      {aviso && datosFrontera && <p className="aviso-frontera">{t.aviso(datosFrontera, aviso)}{' '}
        · <code>{frontera!.id}</code></p>}
      {lineaMargen && <p className="nota">{lineaMargen} · <code>{margen!.id}</code></p>}
      <p className="nota">{t.segmentadaPor} {segmentador || '—'} ·{' '}
        {capa !== null ? <span className="l3">{t.capa(capa)}</span>
          : <span className="sinver">{t.capaNoDeclarada}</span>}</p>
    </div>
  );
}
