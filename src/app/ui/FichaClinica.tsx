/**
 * Lo que dice el informe de UNA pieza: la misma ficha que `fichaDe` del lector, en React.
 *
 * ⚠️ **Es la presentación de `fichaDe` (`src/uos/Clinico.ts`), no una ficha nueva.** Aquel
 * devuelve HTML en español y el lector no se toca; ésta pinta la misma estructura con las
 * mismas clases —`h4`, `dl.ficha`, `ul.tonos`, `p.nota`, `span.l3`, `p.hueco`— para que el
 * CSS y lo que se ve no cambien, y traduce sólo las etiquetas. Lo que trae el contenedor
 * —hallazgos, agente, nota del emisor, espacio de color, `from_photo`— va tal cual.
 * Si cambia `fichaDe`, cambia esto.
 */

import type { ReactNode } from 'react';

import { aCss, type ColorCorona, type Pieza } from '../../uos/Clinico';
import { numero, useIdioma, type Idioma } from './idioma';

/** Por debajo de esta confianza la extracción se marca: el mismo umbral que `fichaDe`. */
const UMBRAL_CONFIANZA = 0.7;

const es = {
  pieza: (fdi: number) => `Pieza ${fdi}`,
  raices: 'raíces',
  conductos: 'conductos',
  hallazgos: 'hallazgos',
  alternativa: 'alternativa',
  procedencia: 'procedencia',
  verProcedencia: 'ver procedencia',
  // `hallazgo` es la etiqueta que pone el lector a los hallazgos con procedencia; el resto
  // de campos son claves del contenedor (`ph`, `n_roots`, `color`) y van tal cual.
  hallazgo: 'hallazgo',
  confianza: 'confianza',
  bajoUmbral: 'bajo umbral',
  cervical: 'cervical',
  medio: 'medio',
  incisal: 'incisal',
  noMenciona: 'el informe no menciona esta pieza',
  noEncontrada: 'la segmentación no la encontró',
};

const TEXTOS: Record<Idioma, typeof es> = {
  es,
  en: {
    pieza: (fdi) => `Tooth ${fdi}`,
    raices: 'roots',
    conductos: 'canals',
    hallazgos: 'findings',
    alternativa: 'alternative',
    procedencia: 'provenance',
    verProcedencia: 'show provenance',
    hallazgo: 'finding',
    confianza: 'confidence',
    bajoUmbral: 'below threshold',
    cervical: 'cervical',
    medio: 'middle',
    incisal: 'incisal',
    noMenciona: 'the report does not mention this tooth',
    noEncontrada: 'the segmentation did not find it',
  },
};

interface Props {
  readonly fdi: number;
  readonly pieza: Pieza | undefined;
  readonly segmentada: boolean;
}

/**
 * ⚠️ **Un diente segmentado puede no tener informe, y al revés**: se dice cuál de los dos
 * falta, como en `fichaDe`, en vez de taparlo con un «sin datos» genérico.
 */
export function FichaClinica({ fdi, pieza: p, segmentada }: Props) {
  const idioma = useIdioma();
  const t = TEXTOS[idioma];

  // Las filas en el orden de `fichaDe`: `[clave, dt, dd]`.
  const filas: [string, string, ReactNode][] = [];
  if (p?.ph !== undefined) filas.push(['ph', 'pH', String(p.ph)]);
  if (p?.n_roots !== undefined) filas.push(['n_roots', t.raices, String(p.n_roots)]);
  if (p?.n_canals !== undefined) filas.push(['n_canals', t.conductos, String(p.n_canals)]);
  if (p?.findings.length) filas.push(['findings', t.hallazgos, p.findings.join(', ')]);

  (p?.details ?? []).forEach((d, i) => {
    const metadata = Object.fromEntries(Object.entries(d.provenance)
      .filter(([k]) => !['value', 'alternatives'].includes(k)));
    const campo = d.field === 'hallazgo' ? t.hallazgo : d.field;
    // `escapa` de `fichaDe` convierte `undefined` en '' y `null` sale como `null` por JSON.
    const valor = typeof d.value === 'object' ? JSON.stringify(d.value) : String(d.value ?? '');
    filas.push([`d${i}`, `${campo} · ${d.alternative ? t.alternativa : t.procedencia}`,
      <details><summary>{t.verProcedencia}</summary>{valor}{' '}
        <span className="nota">{JSON.stringify(metadata)}</span></details>]);
  });

  const huecos: string[] = [];
  if (!p) huecos.push(t.noMenciona);
  if (!segmentada) huecos.push(t.noEncontrada);

  return (
    <>
      <h4>{t.pieza(fdi)}</h4>
      {filas.length > 0 && (
        <dl className="ficha">
          {filas.map(([k, dt, dd]) => [<dt key={`${k}-t`}>{dt}</dt>, <dd key={`${k}-d`}>{dd}</dd>])}
        </dl>
      )}
      {p?.color && <BloqueColor c={p.color} idioma={idioma} />}
      {p?.confidence !== undefined && (
        <p className="nota">{p.agent ?? '—'} · {t.confianza} {p.confidence.toFixed(2)}
          {p.confidence < UMBRAL_CONFIANZA && <> <span className="l3">{t.bajoUmbral}</span></>}
        </p>
      )}
      {huecos.map((h) => <p key={h} className="hueco">{h}</p>)}
    </>
  );
}

/**
 * Los tres tercios con su muestra, su L*a*b* y lo que el color NO es.
 *
 * ⚠️ La nota del emisor se enseña entera, sin resumir ni traducir: es lo que el contenedor
 * afirma sobre su propio color medido. La muestra va AL LADO del número, nunca en su lugar.
 */
function BloqueColor({ c, idioma }: { c: ColorCorona; idioma: Idioma }) {
  const t = TEXTOS[idioma];
  const tercios: readonly [string, string, readonly [number, number, number]][] = [
    ['cervical', t.cervical, c.cervical],
    ['middle', t.medio, c.middle],
    ['incisal', t.incisal, c.incisal],
  ];
  return (
    <div className="color">
      <ul className="tonos">
        {tercios.map(([k, nombre, lab]) => (
          <li key={k}>
            <span className="muestra" style={{ background: aCss(lab) }} />
            <span className="tercio">{nombre}</span>
            <span className="lab">L* {lab[0].toFixed(1)} a* {lab[1].toFixed(1)} b* {lab[2].toFixed(1)}</span>
          </li>
        ))}
      </ul>
      <p className="nota">{c.space} · {numero(idioma, c.n_pixels)} px · {c.from_photo}</p>
      <p className="nota">⚠️ {c.note}</p>
    </div>
  );
}
