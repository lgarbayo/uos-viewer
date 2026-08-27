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
    primitives: { attributes: Record<string, number>; indices?: number; extras?: Record<string, unknown> }[];
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
  const posAcc = prims[0]?.attributes['POSITION'];
  if (posAcc === undefined) throw new Error('la primera primitiva no declara POSITION.');
  if (prims.some((p) => p.attributes['POSITION'] !== posAcc)) {
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

  const primitivas: Primitiva[] = [];
  let triangulos = 0;
  for (const p of prims) {
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

  return { posiciones: copiaPos, primitivas, triangulos };
}
