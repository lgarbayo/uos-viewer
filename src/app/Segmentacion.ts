/**
 * Lo que DECLARA cada segmentación de `derived/`: qué modelo, con qué pesos, bajo qué
 * régimen, y qué hizo el margen gingival pieza a pieza.
 *
 * ⚠️ **El visor no sabe nada de ningún modelo: lee lo que el emisor escribió.** Desde agosto
 * el segmentador FDI del escáner cambió (un modelo congelado con filtro de terceros molares,
 * un margen gingival opcional, motivos de revisión nuevos), y nada de eso se escribe aquí:
 * si un contenedor declara `model.version` y `weights_sha256`, se enseñan; si los trae a
 * `null`, se dice «no declarado». Rellenar un hueco con lo que «sabemos» que se usó
 * convertiría una inferencia nuestra en una afirmación del contenedor.
 *
 * Todo es Capa 3 e `investigational` cuando el sidecar lo dice, y viaja en `derived/`, que
 * es desmontable por diseño.
 */

import type { UosLoader } from '../uos/UosLoader';
import type { Idioma } from './ui/idioma';

export interface FronteraPieza {
  readonly mesiodistal_mm: number;
  readonly table_mm: number;
  readonly excess_mm: number;
  readonly within_expert_range: boolean;
}

export interface MargenPieza {
  readonly moved: number;
  readonly moved_fraction: number | null;
  readonly declined: boolean;
  readonly reason: string | null;
}

export interface Margen {
  readonly method: string;
  readonly applied: boolean;
  readonly criterion: string | null;
  readonly thresholds: Readonly<Record<string, number>>;
  readonly teeth: ReadonlyMap<number, MargenPieza>;
}

export interface Segmentacion {
  readonly id: string;
  readonly uri: string;
  readonly fuentes: readonly string[];
  readonly modelo: string | null;
  readonly version: string | null;
  readonly pesos: string | null;
  readonly capa: number | null;
  readonly estado: string | null;
  readonly jurisdicciones: readonly string[];
  readonly generado: string | null;
  readonly indexa: string | null;
  readonly vocabulario: string | null;
  readonly piezas: readonly number[];
  readonly etiquetadas: number | null;
  readonly total: number | null;
  /** Por pieza, si el recorte cae dentro del rango de experto. Ausente = no se midió. */
  readonly frontera: ReadonlyMap<number, FronteraPieza> | null;
  readonly criterioFrontera: string | null;
  /** Ausente significa «no se ejecutó», no «no movió nada». */
  readonly margen: Margen | null;
}

const obj = (x: unknown): Record<string, unknown> =>
  x !== null && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : {};
const texto = (x: unknown): string | null => (typeof x === 'string' && x ? x : null);
const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);

/** Interpreta un sidecar de `derived_seg`. Tolerante: lo que falta queda en `null`. */
export function interpretaSegmentacion(id: string, uri: string, raw: unknown): Segmentacion {
  const d = obj(raw);
  const modelo = obj(d['model']);
  const reg = obj(d['regulatory']);
  const enc = obj(d['encoding']);
  const etq = obj(d['labels']);

  let frontera: Map<number, FronteraPieza> | null = null;
  const ptb = obj(d['per_tooth_boundary']);
  if (Object.keys(obj(ptb['teeth'])).length) {
    frontera = new Map();
    for (const [k, v] of Object.entries(obj(ptb['teeth']))) {
      const t = obj(v);
      const md = num(t['mesiodistal_mm']); const tb = num(t['table_mm']);
      const ex = num(t['excess_mm']);
      if (md === null || tb === null || ex === null || typeof t['within_expert_range'] !== 'boolean') continue;
      frontera.set(Number(k), { mesiodistal_mm: md, table_mm: tb, excess_mm: ex,
        within_expert_range: t['within_expert_range'] });
    }
  }

  let margen: Margen | null = null;
  if (d['gingival_margin'] !== undefined) {
    const g = obj(d['gingival_margin']);
    const teeth = new Map<number, MargenPieza>();
    for (const [k, v] of Object.entries(obj(g['teeth']))) {
      const t = obj(v);
      teeth.set(Number(k), {
        moved: num(t['moved']) ?? 0,
        moved_fraction: num(t['moved_fraction']),
        declined: t['declined'] === true,
        reason: texto(t['reason']),
      });
    }
    const umbrales: Record<string, number> = {};
    for (const [k, v] of Object.entries(obj(g['thresholds']))) {
      const n = num(v);
      if (n !== null) umbrales[k] = n;
    }
    margen = { method: texto(g['method']) ?? '—', applied: g['applied'] === true,
      criterion: texto(g['criterion']), thresholds: umbrales, teeth };
  }

  return {
    id, uri,
    fuentes: Array.isArray(d['source_assets']) ? d['source_assets'].map(String) : [],
    modelo: texto(modelo['name']),
    version: texto(modelo['version']),
    pesos: texto(modelo['weights_sha256']),
    capa: num(reg['layer']),
    estado: texto(reg['status']),
    jurisdicciones: Array.isArray(reg['jurisdictions']) ? reg['jurisdictions'].map(String) : [],
    generado: texto(d['generated']),
    indexa: texto(enc['indexes']),
    vocabulario: texto(enc['vocabulary']),
    piezas: Array.isArray(etq['present'])
      ? etq['present'].map(Number).filter(Number.isFinite).sort((a, b) => a - b) : [],
    etiquetadas: num(etq['n_labelled']),
    total: num(etq['n_total']),
    frontera,
    criterioFrontera: texto(ptb['criterion']),
    margen,
  };
}

/** Todas las segmentaciones que viajan dentro, con su sidecar. Las externas no se leen. */
export async function leeSegmentaciones(uos: UosLoader): Promise<Segmentacion[]> {
  const fuera: Segmentacion[] = [];
  for (const a of uos.de('derived_seg')) {
    if (a.external) continue;
    const meta = await uos.sidecar<unknown>(a);
    if (meta) fuera.push(interpretaSegmentacion(a.id, a.uri, meta));
  }
  return fuera;
}

/**
 * Lo que la ficha de UNA pieza tiene que decir del margen gingival, o `null`.
 *
 * ⚠️ Tres estados distintos y no dos: anclado al surco, declinado (sin surco claro, la
 * frontera se queda como la dio el modelo) y propuesto sin aplicar. Un «sin cambios» que no
 * distinguiera «no se intentó» de «se intentó y no había surco» perdería justo lo que el
 * revisor necesita saber.
 *
 * La frase sale en el idioma de la interfaz; el motivo (`reason`) es del emisor y va tal cual.
 */
export function margenDePieza(m: Margen | null, fdi: number, idioma: Idioma = 'es'): string | null {
  const t = m?.teeth.get(fdi);
  if (!m || !t) return null;
  const x = TEXTOS_MARGEN[idioma];
  if (t.declined) return x.declinado(t.reason ? ` (${t.reason})` : '');
  const pct = t.moved_fraction !== null ? ` (${(t.moved_fraction * 100).toFixed(0)} %)` : '';
  // `toLocaleString(idioma)` y no `numero` de `ui/idioma`: este módulo no depende de React.
  const n = t.moved.toLocaleString(idioma);
  return m.applied ? x.anclado(n, pct) : x.propuesto(n, pct);
}

const TEXTOS_MARGEN: Record<Idioma, {
  declinado: (motivo: string) => string;
  anclado: (n: string, pct: string) => string;
  propuesto: (n: string, pct: string) => string;
}> = {
  es: {
    declinado: (motivo) => `margen gingival: sin surco claro, frontera sin corregir${motivo}`,
    anclado: (n, pct) => `margen gingival: anclado al surco cervical · ${n} vértices cedidos a la encía${pct}`,
    propuesto: (n, pct) => `margen gingival: propuesto, NO aplicado · movería ${n} vértices${pct}`,
  },
  en: {
    declinado: (motivo) => `gingival margin: no clear sulcus, boundary left uncorrected${motivo}`,
    anclado: (n, pct) => `gingival margin: anchored to the cervical sulcus · ${n} vertices reassigned to the gingiva${pct}`,
    propuesto: (n, pct) => `gingival margin: proposed, NOT applied · would move ${n} vertices${pct}`,
  },
};
