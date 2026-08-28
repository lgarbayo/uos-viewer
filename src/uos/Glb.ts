/**
 * `scene.glb` → posiciones, triángulos y el código FDI de cada primitiva.
 *
 * ⚠️ **No es un lector de glTF, y no pretende serlo.** Three.js trae `GLTFLoader` y hace
 * mucho más: materiales, animaciones, escenas, extensiones. Aquí sólo hace falta lo que el
 * §11.3 define para el picking semántico —`POSITION`, los índices de cada primitiva y su
 * `extras.uos_fdi`— y ese subconjunto cabe en cien líneas sin arrastrar el resto ni
 * construir objetos de Three que después habría que desmontar. Lo que se saca de aquí va a
 * un Worker a hacer aritmética, no a una escena.
 *
 * Lo que SÍ se comprueba es el sobre: la firma `glTF`, la versión, y que los accessors sean
 * de los tipos que este código sabe leer. Un GLB de otro emisor que no encaje se rechaza
 * **diciendo qué no encaja**, en vez de devolver geometría a medias.
 */

/** Una pieza de la malla: sus triángulos y, si lo declara, su código FDI. */
export interface Primitiva {
  /** Índices a `posiciones`, de tres en tres. */
  readonly indices: Uint32Array;
  /** El `extras.uos_fdi` de esta primitiva, o `null` si no lo declara (encía). */
  readonly fdi: number | null;
}

export interface MallaGlb {
  /** `x,y,z` por vértice, en el marco y las unidades que declare el manifiesto. */
  readonly posiciones: Float32Array;
  readonly primitivas: readonly Primitiva[];
  /** Total de triángulos, sumando todas las primitivas. */
  readonly triangulos: number;
  /** La capa 3DGS del glTF, si la escena la trae con `KHR_gaussian_splatting`. */
  readonly splats: SplatsGlb | null;
}

/**
 * La primitiva `KHR_gaussian_splatting`, con sus arrays **tal y como los define la
 * extensión**: opacidad lineal en `[0,1]`, escala lineal no negativa y el cuaternión en
 * orden glTF `(x,y,z,w)`.
 *
 * ⚠️ **Aquí no se convierte nada a nuestra convención, a propósito.** Esto es lo que dice
 * el estándar; traducirlo al PLY INRIA es otro paso, con su propio módulo y su propio
 * test, porque es exactamente donde se pierde un fichero: opacidades que parecen válidas,
 * elipses del tamaño equivocado y cada una girada.
 */
export interface SplatsGlb {
  readonly n: number;
  readonly posiciones: Float32Array;   // (n*3)
  readonly rotacion: Float32Array;     // (n*4), orden glTF
  readonly escala: Float32Array;       // (n*3), lineal
  readonly opacidad: Float32Array;     // (n)
  readonly sh0: Float32Array;          // (n*3)
  readonly sh1: readonly Float32Array[]; // 0 o 3 coeficientes de (n*3)
  readonly regionId: Int16Array | null;
  /**
   * Oclusión ambiental por gaussiana, `[0,1]`. **No es de la extensión.**
   *
   * ⚠️ Sin ella la arcada se dibuja PLANA. El emisor la manda fuera de `f_dc` a propósito
   * —una lectura de tono no debe oscurecerse porque la pieza tenga una fisura al lado— y
   * quien dibuja la multiplica. La primera versión de esta primitiva la dejó fuera y la
   * apariencia perdió el sombreado sin que nada en el fichero dijera que faltaba.
   */
  readonly ao: Float32Array | null;
  /** Normales del vértice más cercano, con el semántico estándar `NORMAL`. */
  readonly normales: Float32Array | null;
  /** `kernel` y `colorSpace`, obligatorios en la extensión. */
  readonly kernel: string;
  readonly colorSpace: string;
}

// Los `componentType` de glTF que este lector sabe leer para los índices.
const ENTEROS: Record<number, (v: DataView, o: number) => number> = {
  5121: (v, o) => v.getUint8(o), // UNSIGNED_BYTE
  5123: (v, o) => v.getUint16(o, true), // UNSIGNED_SHORT
  5125: (v, o) => v.getUint32(o, true), // UNSIGNED_INT
};
const ANCHO: Record<number, number> = { 5121: 1, 5123: 2, 5125: 4 };

interface Accessor {
  bufferView: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
}
interface Vista {
  buffer: number;
  byteOffset?: number;
  byteLength: number;
  byteStride?: number;
}

export function leeGlb(crudo: Uint8Array): MallaGlb {
  const v = new DataView(crudo.buffer, crudo.byteOffset, crudo.byteLength);
  if (v.byteLength < 20 || v.getUint32(0, true) !== 0x46546c67) {
    throw new Error('no es un GLB: falta la firma `glTF` en los primeros cuatro bytes.');
  }
  const version = v.getUint32(4, true);
  if (version !== 2) {
    throw new Error(`GLB versión ${version}: este lector sólo entiende la 2.`);
  }
  // Los chunks van seguidos: [longitud u32][tipo u32][datos]. El primero es el JSON.
  let o = 12;
  let json: Record<string, unknown> | null = null;
  let bin: Uint8Array | null = null;
  while (o + 8 <= v.byteLength) {
    const largo = v.getUint32(o, true);
    const tipo = v.getUint32(o + 4, true);
    const datos = crudo.subarray(o + 8, o + 8 + largo);
    if (tipo === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(datos));
    else if (tipo === 0x004e4942) bin = datos;
    o += 8 + largo + ((4 - (largo % 4)) % 4);
  }
  if (!json) throw new Error('el GLB no trae chunk JSON.');
  if (!bin) throw new Error('el GLB no trae chunk BIN: la geometría no está dentro.');

  const accessors = (json['accessors'] ?? []) as Accessor[];
  const vistas = (json['bufferViews'] ?? []) as Vista[];
  const mallas = (json['meshes'] ?? []) as {
    primitives: {
      attributes: Record<string, number>;
      indices?: number;
      mode?: number;
      extras?: Record<string, unknown>;
      extensions?: Record<string, unknown>;
    }[];
  }[];
  if (!mallas.length) throw new Error('el GLB no trae ninguna malla.');

  const trozo = (i: number): { vista: Vista; base: number; acc: Accessor } => {
    const acc = accessors[i];
    if (!acc) throw new Error(`el GLB apunta al accessor ${i}, que no existe.`);
    const vista = vistas[acc.bufferView];
    if (!vista) throw new Error(`el accessor ${i} apunta a un bufferView que no existe.`);
    return { vista, base: (vista.byteOffset ?? 0) + (acc.byteOffset ?? 0), acc };
  };

  // ⚠️ **Todas las primitivas comparten un solo `POSITION`, y de eso depende todo lo que
  // viene después.** El emisor parte la malla en una primitiva por diente cambiando sólo
  // los índices, así que un vértice tiene UN índice global y el color se calcula una vez
  // por vértice y no una por pieza. Si un GLB ajeno trajera un `POSITION` por primitiva,
  // esto lo detecta en vez de mezclar dos numeraciones.
  const prims = mallas.flatMap((m) => m.primitives);
  // ⚠️ La capa de splats NO comparte el `POSITION` de la malla —son otras posiciones, las
  // de las gaussianas— así que queda fuera de las comprobaciones de abajo. Sin esto, un
  // contenedor con la extensión reventaba al abrirse diciendo que las primitivas no
  // comparten accessor, que es cierto y no es un problema.
  const deMalla = prims.filter((p) => !p.extensions?.['KHR_gaussian_splatting']);
  const posAcc = deMalla[0]?.attributes['POSITION'];
  if (posAcc === undefined) throw new Error('la primera primitiva no declara POSITION.');
  if (deMalla.some((p) => p.attributes['POSITION'] !== posAcc)) {
    throw new Error(
      'las primitivas no comparten el mismo accessor POSITION: este lector asume una ' +
        'numeración de vértices única para toda la malla, que es lo que hace que el color ' +
        'se calcule una vez por vértice.',
    );
  }

  const { vista: vp, base: bp, acc: ap } = trozo(posAcc);
  if (ap.type !== 'VEC3' || ap.componentType !== 5126) {
    throw new Error(`POSITION es ${ap.type}/${ap.componentType}: se espera VEC3 de float32.`);
  }
  if (vp.byteStride !== undefined && vp.byteStride !== 12) {
    throw new Error(`POSITION viene entrelazado (stride ${vp.byteStride}): no soportado.`);
  }
  // ⚠️ **Se COPIA en vez de mapear, y hace falta.** El chunk BIN empieza donde lo deje el
  // JSON y el propio GLB sale de una entrada del ZIP, así que su offset absoluto no tiene
  // por qué ser múltiplo de 4 — y un `Float32Array` construido sobre un offset no alineado
  // lanza `RangeError`. Copiar los bytes a un buffer propio cuesta 1,3 MB una vez y quita
  // una clase entera de fallos que sólo aparecerían con ciertos contenedores.
  const copiaPos = new Float32Array(ap.count * 3);
  new Uint8Array(copiaPos.buffer).set(bin.subarray(bp, bp + ap.count * 12));

  /** Un accessor de float32 (SCALAR/VEC3/VEC4) como `Float32Array` plano. */
  const flotantes = (i: number, comps: number): Float32Array => {
    const { base, acc } = trozo(i);
    if (acc.componentType !== 5126) {
      throw new Error(
        `el accessor ${i} es componentType ${acc.componentType} y se espera float32: la ` +
          'extensión permite formatos cuantizados que este lector todavía no lee.',
      );
    }
    const fuera = new Float32Array(acc.count * comps);
    new Uint8Array(fuera.buffer).set(bin.subarray(base, base + acc.count * comps * 4));
    return fuera;
  };

  // ⚠️ **Se busca por la EXTENSIÓN, no por el índice de la malla.** El emisor la escribe
  // como segunda malla, pero eso es una decisión suya: la extensión se declara en la
  // primitiva, y ahí es donde hay que preguntarla si esto tiene que leer contenedores que
  // no hayamos escrito nosotros. Que es de lo que va todo esto.
  let splats: SplatsGlb | null = null;
  for (const p of prims) {
    const ext = p.extensions?.['KHR_gaussian_splatting'] as
      | { kernel?: string; colorSpace?: string }
      | undefined;
    if (!ext) continue;
    if (p.mode !== 0) {
      throw new Error(
        `una primitiva con \`KHR_gaussian_splatting\` declara mode ${p.mode}: la extensión ` +
          'exige POINTS (0).',
      );
    }
    const a = p.attributes;
    const falta = [
      'POSITION',
      'KHR_gaussian_splatting:ROTATION',
      'KHR_gaussian_splatting:SCALE',
      'KHR_gaussian_splatting:OPACITY',
      'KHR_gaussian_splatting:SH_DEGREE_0_COEF_0',
    ].filter((k) => a[k] === undefined);
    if (falta.length) {
      throw new Error(
        `a la capa \`KHR_gaussian_splatting\` le faltan atributos obligatorios: ` +
          falta.join(', '),
      );
    }
    const posSplat = flotantes(a['POSITION']!, 3);
    const n = posSplat.length / 3;
    const sh1: Float32Array[] = [];
    for (let k = 0; k < 3; k++) {
      const idxSh = a[`KHR_gaussian_splatting:SH_DEGREE_1_COEF_${k}`];
      if (idxSh !== undefined) sh1.push(flotantes(idxSh, 3));
    }
    // Grado 1 entero o nada: la extensión exige que si va un grado superior estén todos
    // los inferiores, y medio grado 1 daría un realce direccional inventado en dos ejes.
    if (sh1.length && sh1.length !== 3) {
      throw new Error(
        `la capa declara ${sh1.length} coeficiente(s) de grado 1 y son tres: un grado ` +
          'incompleto pintaría un realce que el emisor no calculó.',
      );
    }
    let regionId: Int16Array | null = null;
    const idxReg = a['_REGION_ID'];
    if (idxReg !== undefined) {
      const { base, acc } = trozo(idxReg);
      if (acc.componentType === 5122) {
        regionId = new Int16Array(acc.count);
        new Uint8Array(regionId.buffer).set(bin.subarray(base, base + acc.count * 2));
      }
    }
    const idxAo = a['_AO'];
    const idxNor = a['NORMAL'];
    splats = {
      n,
      ao: idxAo === undefined ? null : flotantes(idxAo, 1),
      normales: idxNor === undefined ? null : flotantes(idxNor, 3),
      posiciones: posSplat,
      rotacion: flotantes(a['KHR_gaussian_splatting:ROTATION']!, 4),
      escala: flotantes(a['KHR_gaussian_splatting:SCALE']!, 3),
      opacidad: flotantes(a['KHR_gaussian_splatting:OPACITY']!, 1),
      sh0: flotantes(a['KHR_gaussian_splatting:SH_DEGREE_0_COEF_0']!, 3),
      sh1,
      regionId,
      kernel: ext.kernel ?? '',
      colorSpace: ext.colorSpace ?? '',
    };
    break;
  }

  const primitivas: Primitiva[] = [];
  let triangulos = 0;
  for (const p of deMalla) {
    if (p.indices === undefined) continue;
    const { base, acc } = trozo(p.indices);
    const leer = ENTEROS[acc.componentType];
    const ancho = ANCHO[acc.componentType];
    if (!leer || !ancho) {
      throw new Error(`índices con componentType ${acc.componentType}: no soportado.`);
    }
    const vd = new DataView(bin.buffer, bin.byteOffset + base, acc.count * ancho);
    const idx = new Uint32Array(acc.count);
    for (let i = 0; i < acc.count; i++) idx[i] = leer(vd, i * ancho);
    // El FDI se lee como número porque el emisor lo escribe como cadena («11»), y lo que
    // se compara después son códigos, no texto.
    const bruto = p.extras?.['uos_fdi'];
    const fdi = bruto === undefined || bruto === null ? null : Number(bruto);
    primitivas.push({ indices: idx, fdi: Number.isFinite(fdi) ? fdi : null });
    triangulos += acc.count / 3;
  }
  if (!primitivas.length) throw new Error('el GLB no trae primitivas con índices.');

  return { posiciones: copiaPos, primitivas, triangulos, splats };
}
