/**
 * `derived/` — lo que salio de un modelo (§5.5).
 *
 * ⚠️ **Se renderiza APAGADO por defecto y con su etiqueta regulatoria visible.** Lo dice
 * el spec y no es una preferencia de UI: un `.uos` puede circular por jurisdicciones donde
 * el modulo de IA no esta habilitado, y una segmentacion pintada encima de la anatomia sin
 * decir que es inferencia se lee como si fuera medida.
 */

export interface MetaSegmentacion {
  readonly model: {
    readonly name: string;
    readonly version: string;
    readonly weights_sha256: string | null;
  };
  readonly source_assets: readonly string[];
  readonly regulatory: {
    readonly layer: number;
    readonly status: string;
    readonly jurisdictions: readonly string[];
  };
  readonly generated: string;
  readonly encoding: {
    readonly dtype: string;
    readonly count: number;
    readonly indexes: string;
    readonly vocabulary: string;
  };
  readonly labels: {
    readonly present: readonly number[];
    readonly n_labelled: number;
    readonly n_total: number;
  };
}

/** Los codigos FDI por vertice. `int16` little-endian, en el orden de la escena. */
export function decodificaEtiquetas(crudo: Uint8Array, meta: MetaSegmentacion): Int16Array {
  if (meta.encoding.dtype !== 'int16-le') {
    throw new Error(
      `La segmentacion declara \`${meta.encoding.dtype}\` y este visor solo lee ` +
        '`int16-le`. Se falla en vez de interpretar los bytes de otra forma, que daria ' +
        'codigos FDI plausibles y equivocados.',
    );
  }
  const etq = new Int16Array(crudo.buffer, crudo.byteOffset, crudo.byteLength / 2);
  if (etq.length !== meta.encoding.count) {
    throw new Error(
      `La segmentacion trae ${etq.length} codigos y su sidecar declara ` +
        `${meta.encoding.count}: no se pueden cruzar con la escena.`,
    );
  }
  return etq;
}

/**
 * El tono de una pieza, en [0,1), a partir de su codigo FDI y de nada mas.
 *
 * ⚠️ **La misma formula que el emisor**, a proposito: el indice es la posicion del diente
 * en la boca —`(cuadrante-1)*8 + (pieza-1)`— por el angulo aureo. Depende solo del codigo,
 * asi que la misma pieza sale del mismo color en cualquier caso, en cualquier visita y en
 * cualquier visor que implemente esto. Una paleta arbitraria por contenedor haria que dos
 * capturas del mismo diente no se pudieran comparar.
 */
const ANGULO_AUREO = 0.618033988749895;

export function tonoDe(fdi: number): number {
  const cuadrante = Math.floor(fdi / 10);
  const pieza = fdi % 10;
  return (((cuadrante - 1) * 8 + (pieza - 1)) * ANGULO_AUREO) % 1.0;
}

/** HSL → RGB en [0,1]. Luz y saturacion fijas: lo que distingue es el TONO. */
export function colorDe(fdi: number): [number, number, number] {
  const h = tonoDe(fdi) * 6;
  const c = 0.62 * (1 - Math.abs(2 * 0.46 - 1));
  const x = c * (1 - Math.abs((h % 2) - 1));
  const m = 0.46 - c / 2;
  const t: [number, number, number] =
    h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x]
    : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x];
  return [t[0] + m, t[1] + m, t[2] + m];
}
