/**
 * Las gaussianas del ESCÁNER que viajan dentro del compuesto, listas para el rasterizador.
 *
 * ⚠️ **Es el segundo escalón de una preferencia, y sólo se usa cuando falta el primero.** Si
 * el contenedor trae apariencia 3DGS (`KHR_gaussian_splatting` o `derived/appearance.glb`),
 * las coronas se pintan con su color real. Si no la trae pero trae el compuesto
 * CBCT + escáner, se pintan sus gaussianas de escáner. Si no hay ninguna de las dos, sólo
 * se ve el CBCT. La interfaz dice en cada caso qué falta.
 *
 * **Qué es dato y qué es display, separado:**
 *
 * - posición, escala y rotación son MEDIDA (`source_modality = 1`: forma medida del
 *   escáner) y se usan tal cual, colocadas en el canónico con la registración declarada;
 * - el COLOR es marfil neutro de visualización: el escáner no mide color y este caso no
 *   trae apariencia, así que cualquier otro tono sería inventarlo;
 * - la OPACIDAD es de visualización. ⚠️ `density` NO se lee como opacidad: en el escáner
 *   vale 0 porque el escáner no mide atenuación, y leerla así lo haría invisible —o, peor,
 *   inventarle una densidad—;
 * - el RELIEVE, si lo hay, sale de las normales que la malla del escáner declara en
 *   `scene.glb`, con la misma fórmula que el emisor usa para la apariencia. La malla NO se
 *   dibuja: de ella se leen sólo sus normales, y sólo si sus vértices coinciden uno a uno
 *   con estas gaussianas.
 */

import { Matrix4, Quaternion, Vector3 } from 'three';

import type { CampoPly } from '../uos/Ply';

/** Marfil neutro. Es color de VISUALIZACIÓN: el escáner no mide color. */
export const MARFIL: readonly [number, number, number] = [0.9, 0.87, 0.8];
/** Opacidad de visualización. No sale de `density`, que en el escáner vale 0. */
export const OPACIDAD_ESCANER = 0.92;
/** Tolerancia para dar por buena la correspondencia malla ↔ gaussianas, en mm. */
export const TOLERANCIA_NORMALES_MM = 1e-3;

const C0 = 0.28209479177387814;
const C1 = 0.4886025119029199;
/**
 * Cuánto oscurece el relieve lo que no mira a la cámara: una cara de frente sale en marfil
 * exacto y una rasante en `marfil · (1 − RELIEVE)`. Es una luz frontal de visualización.
 *
 * ⚠️ **Se resta, no se suma.** La fórmula es la del emisor —`k·(n·v)` en el grado 1, con
 * `n·v < 0` en una cara que mira a la cámara porque el rasterizador usa la dirección
 * cámara→gaussiana—, pero sumada a un marfil ya claro saturaba a blanco todo lo que miraba
 * de frente. Aquí el grado 0 baja a `marfil · (1 − RELIEVE)` y el grado 1 devuelve hasta el
 * marfil: el mismo relieve, sin salirse de rango.
 */
export const RELIEVE = 0.35;

/**
 * Cuánto del espaciado medido de la nube cubre, como mínimo, cada gaussiana AL DIBUJARSE.
 *
 * ⚠️ **Es ganancia de display, como la del campo de densidad, y no viaja a ningún sitio.**
 * Medido en el caso de agosto: σ declarada 0,066 mm y vecino más cercano a 0,133 mm, la
 * mitad. Con eso las caras que miran a la cámara salen moteadas —se ve el fondo entre
 * gaussianas— mientras los bordes, vistos en escorzo, se cierran. El espaciado se MIDE de
 * la propia nube, no se supone: otro escáner tendrá otra densidad de puntos.
 */
export const ESCALA_POR_ESPACIADO = 0.9;
const MUESTRA_ESPACIADO = 2000;

/**
 * Mediana de la distancia al vecino más cercano, sobre una muestra, con una rejilla.
 * Basta una mediana: es para fijar un tamaño de dibujo, no para medir nada del paciente.
 */
export function espaciadoMediano(pos: Float32Array): number {
  const n = pos.length / 3;
  if (n < 2) return 0;
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) for (let e = 0; e < 3; e++) {
    const v = pos[i * 3 + e]!;
    if (v < min[e]!) min[e] = v;
    if (v > max[e]!) max[e] = v;
  }
  const diag = Math.hypot(max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!);
  const celda = Math.max(diag / Math.cbrt(n), 1e-6) * 2;
  const clave = (x: number, y: number, z: number): string =>
    `${Math.floor(x / celda)},${Math.floor(y / celda)},${Math.floor(z / celda)}`;
  const rejilla = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const k = clave(pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!);
    const c = rejilla.get(k);
    if (c) c.push(i); else rejilla.set(k, [i]);
  }
  const m = Math.min(MUESTRA_ESPACIADO, n);
  const d: number[] = [];
  for (let q = 0; q < m; q++) {
    const i = Math.floor((q * n) / m);
    const x = pos[i * 3]!, y = pos[i * 3 + 1]!, z = pos[i * 3 + 2]!;
    let mejor = Infinity;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      for (const j of rejilla.get(clave(x + dx * celda, y + dy * celda, z + dz * celda)) ?? []) {
        if (j === i) continue;
        const r = Math.hypot(pos[j * 3]! - x, pos[j * 3 + 1]! - y, pos[j * 3 + 2]! - z);
        if (r > 0 && r < mejor) mejor = r;
      }
    }
    if (Number.isFinite(mejor)) d.push(mejor);
  }
  d.sort((a, b) => a - b);
  return d.length ? d[Math.floor(d.length / 2)]! : 0;
}

/** Índices de las gaussianas de escáner del compuesto (`source_modality = 1`). */
export function indicesDelEscaner(campo: CampoPly): Int32Array {
  const m = campo.columnas['source_modality'];
  if (!m) return new Int32Array(0);
  let n = 0;
  for (let i = 0; i < campo.n; i++) if (m[i] === 1) n++;
  const fuera = new Int32Array(n);
  for (let i = 0, k = 0; i < campo.n; i++) if (m[i] === 1) fuera[k++] = i;
  return fuera;
}

/** Cuántos códigos son una pieza (`> 0`), sobre todos o sobre los índices dados. */
export function cuentaConPieza(region: Float32Array, idx?: Int32Array): number {
  let n = 0;
  if (idx) { for (let k = 0; k < idx.length; k++) if (region[idx[k]!]! > 0) n++; }
  else for (let i = 0; i < region.length; i++) if (region[i]! > 0) n++;
  return n;
}

/** Las posiciones de esas gaussianas ya en el canónico, en orden. */
export function posicionesEnCanonico(
  campo: CampoPly, idx: Int32Array, matriz: Matrix4,
): Float32Array {
  const { x, y, z } = campo.columnas;
  if (!x || !y || !z) throw new Error('el compuesto no trae x/y/z');
  const p = new Vector3();
  const fuera = new Float32Array(idx.length * 3);
  for (let k = 0; k < idx.length; k++) {
    const i = idx[k]!;
    p.set(x[i]!, y[i]!, z[i]!).applyMatrix4(matriz);
    fuera[k * 3] = p.x; fuera[k * 3 + 1] = p.y; fuera[k * 3 + 2] = p.z;
  }
  return fuera;
}

/**
 * Si los vértices de la malla del escáner SON estas gaussianas: mismo número y cada uno en
 * el mismo sitio, en el canónico. Devuelve el motivo si no lo son, o `null` si lo son.
 *
 * ⚠️ **Es lo único que deja usar algo indexado por la malla sobre las gaussianas**: sus
 * normales para el relieve y, si el compuesto no numera el escáner, sus etiquetas FDI. Se
 * MIDE en cada contenedor; no se supone porque el emisor de hoy lo haga así.
 */
export function motivoSinCorrespondencia(
  posGaussianas: Float32Array, posMalla: Float32Array,
): string | null {
  if (posMalla.length !== posGaussianas.length) {
    return `la malla tiene ${(posMalla.length / 3).toLocaleString('es')} vértices y el ` +
      `escáner del compuesto ${(posGaussianas.length / 3).toLocaleString('es')} gaussianas: ` +
      'no se corresponden uno a uno';
  }
  let peor = 0;
  for (let i = 0; i < posMalla.length; i += 3) {
    const d = Math.hypot(posMalla[i]! - posGaussianas[i]!, posMalla[i + 1]! - posGaussianas[i + 1]!,
      posMalla[i + 2]! - posGaussianas[i + 2]!);
    if (d > peor) peor = d;
  }
  return peor > TOLERANCIA_NORMALES_MM
    ? `los vértices de la malla no caen sobre las gaussianas (hasta ${peor.toFixed(3)} mm)`
    : null;
}

/** Si las normales de una malla valen para estas gaussianas, o el motivo si no. */
export function motivoSinNormales(
  posGaussianas: Float32Array, posMalla: Float32Array, normales: Float32Array | null,
): string | null {
  if (!normales) return 'la malla del escáner no declara normales';
  const sinCorrespondencia = motivoSinCorrespondencia(posGaussianas, posMalla);
  if (sinCorrespondencia) return sinCorrespondencia;
  return normales.length !== posMalla.length
    ? 'la malla declara un número de normales distinto del de vértices' : null;
}

/**
 * El campo del escáner en la convención del rasterizador (INRIA): escala en logaritmo,
 * opacidad en logit, color como armónico de grado 0, y el relieve en el de grado 1.
 *
 * `normales` van en el canónico y en el mismo orden que `idx`; `null` deja el relieve a cero.
 * `etiquetas`, si se dan, sustituyen al `region_id` del compuesto y van también en el orden
 * de `idx`: es la numeración de la malla, ya verificada su correspondencia.
 */
export interface Escaner {
  readonly campo: CampoPly;
  /** Mediana del vecino más cercano, en mm. */
  readonly espaciado: number;
  /** Cuántas gaussianas se dibujaron más grandes de lo declarado (ganancia de display). */
  readonly infladas: number;
  /** Tamaño mínimo de dibujo, en mm (σ). */
  readonly sigmaMinima: number;
}

export function campoDelEscaner(
  campo: CampoPly, idx: Int32Array, matriz: Matrix4, normales: Float32Array | null,
  etiquetas: ArrayLike<number> | null = null,
): Escaner {
  if (etiquetas && etiquetas.length !== idx.length) {
    throw new Error(`${etiquetas.length} etiquetas para ${idx.length} gaussianas del escáner`);
  }
  const c = campo.columnas;
  for (const k of ['scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3']) {
    if (!c[k]) throw new Error(`el compuesto no trae \`${k}\``);
  }
  const n = idx.length;
  const pos = posicionesEnCanonico(campo, idx, matriz);
  const espaciado = espaciadoMediano(pos);
  const sigmaMinima = espaciado * ESCALA_POR_ESPACIADO;
  let infladas = 0;
  // La registración es rígida; si trajera escala, se aplica también a las escalas.
  const giro = new Quaternion();
  const escalaM = new Vector3();
  matriz.decompose(new Vector3(), giro, escalaM);
  const factor = Math.cbrt(Math.abs(escalaM.x * escalaM.y * escalaM.z)) || 1;

  const col = (): Float32Array => new Float32Array(n);
  const fuera: Record<string, Float32Array> = {
    x: col(), y: col(), z: col(),
    f_dc_0: col(), f_dc_1: col(), f_dc_2: col(),
    opacity: col(), scale_0: col(), scale_1: col(), scale_2: col(),
    rot_0: col(), rot_1: col(), rot_2: col(), rot_3: col(),
  };
  const conRelieve = normales !== null;
  if (conRelieve) for (let j = 0; j < 9; j++) fuera[`f_rest_${j}`] = col();
  const region = c['region_id'];
  if (region || etiquetas) fuera['region_id'] = col();

  // Sin relieve el marfil va entero; con relieve, el grado 0 baja y el 1 devuelve hasta él.
  const base = normales ? 1 - RELIEVE : 1;
  const dc = MARFIL.map((v) => (v * base - 0.5) / C0);
  const logitOpacidad = Math.log(OPACIDAD_ESCANER / (1 - OPACIDAD_ESCANER));
  const q = new Quaternion();
  for (let k = 0; k < n; k++) {
    const i = idx[k]!;
    fuera['x']![k] = pos[k * 3]!; fuera['y']![k] = pos[k * 3 + 1]!; fuera['z']![k] = pos[k * 3 + 2]!;
    fuera['f_dc_0']![k] = dc[0]!; fuera['f_dc_1']![k] = dc[1]!; fuera['f_dc_2']![k] = dc[2]!;
    fuera['opacity']![k] = logitOpacidad;
    // ⚠️ El compuesto declara escalas LINEALES en mm («NOT logarithms»); el rasterizador
    // las quiere en logaritmo.
    let inflada = false;
    for (let e = 0; e < 3; e++) {
      const medida = c[`scale_${e}`]![i]! * factor;
      if (medida < sigmaMinima) inflada = true;
      fuera[`scale_${e}`]![k] = Math.log(Math.max(medida, sigmaMinima, 1e-8));
    }
    if (inflada) infladas++;
    // Cuaternión (w, x, y, z) en el fichero; se gira con la registración.
    q.set(c['rot_1']![i]!, c['rot_2']![i]!, c['rot_3']![i]!, c['rot_0']![i]!).normalize()
      .premultiply(giro);
    fuera['rot_0']![k] = q.w; fuera['rot_1']![k] = q.x; fuera['rot_2']![k] = q.y; fuera['rot_3']![k] = q.z;
    if (etiquetas) fuera['region_id']![k] = etiquetas[k]!;
    else if (region) fuera['region_id']![k] = region[i]!;
    if (conRelieve) {
      const nx = normales[k * 3]!, ny = normales[k * 3 + 1]!, nz = normales[k * 3 + 2]!;
      // Canal-mayor (R,R,R,G,G,G,B,B,B), que es el orden del PLY de INRIA.
      for (let ch = 0; ch < 3; ch++) {
        const kk = -RELIEVE * MARFIL[ch]!;
        fuera[`f_rest_${ch * 3}`]![k] = -kk * ny / C1;
        fuera[`f_rest_${ch * 3 + 1}`]![k] = kk * nz / C1;
        fuera[`f_rest_${ch * 3 + 2}`]![k] = -kk * nx / C1;
      }
    }
  }
  return { campo: { n, columnas: fuera, comentarios: {} }, espaciado, infladas, sigmaMinima };
}

/**
 * Las normales (`NORMAL`) de la primitiva de malla de un GLB, en float32, o `null`.
 *
 * Lector mínimo y a propósito aparte del de `src/uos`: sólo hace falta un accessor, y el
 * lector del formato no expone las normales de la malla porque el visor no la dibuja.
 */
export function leeNormalesGlb(crudo: Uint8Array): Float32Array | null {
  const v = new DataView(crudo.buffer, crudo.byteOffset, crudo.byteLength);
  if (v.byteLength < 20 || v.getUint32(0, true) !== 0x46546c67) return null;
  let o = 12;
  let json: { accessors?: { bufferView: number; byteOffset?: number; count: number;
    componentType: number; type: string }[]; bufferViews?: { byteOffset?: number;
    byteStride?: number }[]; meshes?: { primitives: { attributes: Record<string, number>;
    extensions?: Record<string, unknown> }[] }[] } | null = null;
  let bin: Uint8Array | null = null;
  while (o + 8 <= v.byteLength) {
    const largo = v.getUint32(o, true);
    const tipo = v.getUint32(o + 4, true);
    const datos = crudo.subarray(o + 8, o + 8 + largo);
    if (tipo === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(datos));
    else if (tipo === 0x004e4942) bin = datos;
    o += 8 + largo + ((4 - (largo % 4)) % 4);
  }
  if (!json || !bin) return null;
  const prim = (json.meshes ?? []).flatMap((m) => m.primitives)
    .find((p) => !p.extensions?.['KHR_gaussian_splatting'] && p.attributes['NORMAL'] !== undefined);
  const acc = prim ? json.accessors?.[prim.attributes['NORMAL']!] : undefined;
  const vista = acc ? json.bufferViews?.[acc.bufferView] : undefined;
  if (!acc || !vista || acc.type !== 'VEC3' || acc.componentType !== 5126) return null;
  if (vista.byteStride !== undefined && vista.byteStride !== 12) return null;
  const base = (vista.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  // Copia y no vista: el chunk BIN no tiene por qué estar alineado a 4 dentro del ZIP.
  const fuera = new Float32Array(acc.count * 3);
  new Uint8Array(fuera.buffer).set(bin.subarray(base, base + acc.count * 12));
  return fuera;
}
