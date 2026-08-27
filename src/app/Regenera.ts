/**
 * La reversibilidad, ejecutada desde el visor.
 *
 * ⚠️ **Es la afirmación que el manifiesto hace, cumplida donde está quien la necesita.** El
 * `.uos` declara la extensión `ash_reversible`: de `asset.scene` (geometría y
 * `extras.uos_fdi`) más la columna de color de `asset.apariencia` se regenera una malla de
 * arcada con color por vértice. El STL mejorado **no viaja** dentro —serían 19 MB para
 * duplicar una geometría que el contenedor sabe reconstruir— y hasta ahora la única forma
 * de reconstruirlo era clonar el monorepo del emisor y montar un entorno con CUDA. Eso no
 * es reversible para un dentista: es reversible para nosotros.
 *
 * Este módulo hace el mismo cálculo con los mismos números, en el navegador que ya tiene el
 * contenedor abierto y sin subir nada a ningún sitio.
 *
 * ⚠️ **Las convenciones de unidades se PREGUNTAN, no se suponen.** La opacidad va en logit
 * y las escalas en logaritmo, pero eso no se escribe aquí como constante: se lee del
 * `.gs.json` columna a columna. Un emisor que las escriba en lineal las declara así y esto
 * lo respeta; suponerlo daría un color plausible y falso.
 */

import type { Asset } from '../uos/Manifest';
import { leeGlb } from '../uos/Glb';
import { leePly } from '../uos/Ply';
import type { UosLoader } from '../uos/UosLoader';
import { escribeZip } from '../uos/Zip';
import { apagaSinDeclarar, colorDesdeGaussianas, rellenaHuecos } from '../uos/ColorMalla';
import type { Peticion, Respuesta } from '../uos/ColorMalla';

/** Lo que se devuelve para enseñar y para guardar. */
export interface Regenerado {
  /** Lo que hace falta para construir el `.3mf` cuando alguien lo pida. */
  readonly posiciones: Float32Array;
  readonly caras: Uint32Array;
  readonly rgb: Uint8Array;
  readonly vertices: number;
  readonly triangulos: number;
  readonly medidos: number;
  readonly rellenados: number;
  readonly conFdi: number;
  readonly ply: Uint8Array;
  readonly stl: Uint8Array;
  readonly meta: string;
}

interface ColumnaGS {
  readonly name?: string;
  readonly unit?: string;
}
interface DescriptorGS {
  readonly profile?: string;
  readonly columns?: readonly ColumnaGS[];
}

/**
 * Deshace las convenciones que el descriptor declare, columna a columna.
 *
 * ⚠️ Se recorre lo que el descriptor DICE y no una lista de nombres escrita aquí. El emisor
 * cometió ese error una vez —transformaba `scale_0..2` porque «las escalas son tres»— y
 * reventaba en cuanto un descriptor traía una sola.
 */
function enLineal(
  columnas: Readonly<Record<string, Float32Array>>, esquema: DescriptorGS,
): Record<string, Float32Array> {
  const fuera: Record<string, Float32Array> = {};
  for (const [n, v] of Object.entries(columnas)) fuera[n] = Float32Array.from(v);
  for (const c of esquema.columns ?? []) {
    const col = c.name ? fuera[c.name] : undefined;
    if (!col) continue;
    const u = c.unit ?? '';
    if (u === 'logit') for (let i = 0; i < col.length; i++) col[i] = 1 / (1 + Math.exp(-col[i]!));
    else if (u.startsWith('log')) for (let i = 0; i < col.length; i++) col[i] = Math.exp(col[i]!);
  }
  return fuera;
}

/** El PLY de salida: color por vértice, código FDI y la bandera `medido`. */
function escribePly(
  pos: Float32Array, caras: Uint32Array, rgb: Uint8Array, medido: Uint8Array,
  fdi: Int16Array,
): Uint8Array {
  const nv = pos.length / 3;
  const nt = caras.length / 3;
  const cabecera =
    'ply\nformat binary_little_endian 1.0\n' +
    'comment regenerado por uos-viewer desde el .uos, extension ash_reversible/1.0\n' +
    'comment geometria de asset.scene; color de asset.apariencia, mezcla ponderada por\n' +
    'comment opacidad y caida gaussiana sobre las vecinas que cubren cada vertice\n' +
    'comment medido=1 -> color del paciente. medido=0 -> gris neutro o heredado de un\n' +
    'comment vecino de la MISMA pieza: no es color de nadie y no se debe medir encima\n' +
    'comment el color NO lleva oclusion ambiental: es un factor de visualizacion\n' +
    'comment unidades mm\n' +
    `element vertex ${nv}\n` +
    'property float x\nproperty float y\nproperty float z\n' +
    'property uchar red\nproperty uchar green\nproperty uchar blue\n' +
    'property short fdi\nproperty uchar medido\n' +
    `element face ${nt}\n` +
    'property list uchar uint vertex_indices\nend_header\n';
  const cab = new TextEncoder().encode(cabecera);
  // 12 (xyz) + 3 (rgb) + 2 (fdi) + 1 (medido) por vertice; 1 + 12 por cara.
  const fuera = new Uint8Array(cab.length + nv * 18 + nt * 13);
  fuera.set(cab);
  const v = new DataView(fuera.buffer);
  let o = cab.length;
  for (let i = 0; i < nv; i++) {
    v.setFloat32(o, pos[i * 3]!, true);
    v.setFloat32(o + 4, pos[i * 3 + 1]!, true);
    v.setFloat32(o + 8, pos[i * 3 + 2]!, true);
    fuera[o + 12] = rgb[i * 3]!; fuera[o + 13] = rgb[i * 3 + 1]!; fuera[o + 14] = rgb[i * 3 + 2]!;
    // Mismo orden que el emisor: `fdi` (short) y luego `medido` (uchar). Que dos ficheros
    // que dicen lo mismo se lean igual no es cosmético — evita exactamente el fallo que
    // este proyecto ya cometió leyéndolos al revés.
    v.setInt16(o + 15, fdi[i]!, true);
    fuera[o + 17] = medido[i]!;
    o += 18;
  }
  for (let t = 0; t < nt; t++) {
    fuera[o] = 3;
    v.setUint32(o + 1, caras[t * 3]!, true);
    v.setUint32(o + 5, caras[t * 3 + 1]!, true);
    v.setUint32(o + 9, caras[t * 3 + 2]!, true);
    o += 13;
  }
  return fuera;
}

/**
 * STL binario con color por CARA en RGB555, convención VisCAM.
 *
 * ⚠️ **No es estándar y hay que decirlo cada vez.** El color va en los dos bytes que el
 * formato reserva como *attribute byte count* y que la mayoría de lectores ignoran: quien
 * abra esto en un visor cualquiera verá la geometría en gris, sin ningún aviso. Se emite
 * porque hay cadenas de trabajo que sólo aceptan `.stl`, no porque sea buena idea.
 *
 * ⚠️ **Y es color por CARA**: la resolución baja a un tercio, porque un triángulo no puede
 * llevar tres colores. El degradado cervical-incisal dentro de una corona sólo sobrevive
 * entero en el `.ply` y en el `.3mf`.
 *
 * ⚠️ Esta convención la escribe también el emisor. Aquí faltaba —el visor sacaba un STL
 * liso— y eso significa que dos ficheros que dicen ser la misma arcada llevaban distinto
 * dato según quién los generase. El fichero es lo que alguien se lleva a la fresadora.
 */
function escribeStl(pos: Float32Array, caras: Uint32Array, rgb: Uint8Array): Uint8Array {
  const nt = caras.length / 3;
  const fuera = new Uint8Array(84 + nt * 50);
  const v = new DataView(fuera.buffer);
  new TextEncoder().encodeInto(
    'arcada con color medido (RGB555 VisCAM, NO estandar) - regenerado por uos-viewer',
    fuera.subarray(0, 80),
  );
  v.setUint32(80, nt, true);
  let o = 84;
  for (let t = 0; t < nt; t++) {
    const a = caras[t * 3]! * 3, b = caras[t * 3 + 1]! * 3, c = caras[t * 3 + 2]! * 3;
    const ux = pos[b]! - pos[a]!, uy = pos[b + 1]! - pos[a + 1]!, uz = pos[b + 2]! - pos[a + 2]!;
    const wx = pos[c]! - pos[a]!, wy = pos[c + 1]! - pos[a + 1]!, wz = pos[c + 2]! - pos[a + 2]!;
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    v.setFloat32(o, nx, true); v.setFloat32(o + 4, ny, true); v.setFloat32(o + 8, nz, true);
    for (let k = 0; k < 3; k++) {
      const i = caras[t * 3 + k]! * 3;
      v.setFloat32(o + 12 + k * 12, pos[i]!, true);
      v.setFloat32(o + 16 + k * 12, pos[i + 1]!, true);
      v.setFloat32(o + 20 + k * 12, pos[i + 2]!, true);
    }
    // El color de la cara: media de sus tres vértices, a cinco bits por canal, con el bit
    // 15 encendido — que es lo que VisCAM usa para decir «este atributo es un color».
    const q = (c: number) =>
      ((rgb[caras[t * 3]! * 3 + c]! + rgb[caras[t * 3 + 1]! * 3 + c]! +
        rgb[caras[t * 3 + 2]! * 3 + c]!) / 3 / 255) * 31 | 0;
    v.setUint16(o + 48, 0x8000 | (q(2) << 10) | (q(1) << 5) | q(0), true);
    o += 50;
  }
  return fuera;
}

/** Cuánto se cuantiza el color al construir la paleta del 3MF. Mismo valor que el emisor. */
const PASO_PALETA_3MF = 4;

/**
 * Cuatro decimales con redondeo AL PAR, como `f"{x:.4f}"` de Python.
 *
 * ⚠️ **`toFixed` no vale, y la diferencia aparece de verdad en esta malla.** JavaScript
 * redondea los empates alejándose del cero y Python los redondea al par: una coordenada de
 * −23,03125 —un valor exacto en `float32`, de los que abundan aquí— sale `-23.0313` con
 * `toFixed` y `-23.0312` en el fichero del emisor. Un solo dígito por vértice, 112.067
 * vértices, y dos ficheros que dicen ser la misma arcada.
 *
 * Los empates se detectan sobre la representación decimal exacta —`toFixed(12)` es
 * suficiente para cualquier `float32`— en vez de multiplicando por 10.000, que introduce
 * su propio error justo donde importa.
 */
function f4(x: number): string {
  const s = x.toFixed(12);
  const punto = s.indexOf('.');
  const resto = s.slice(punto + 5);
  if (!/^50*$/.test(resto)) return x.toFixed(4);
  const truncado = Number(s.slice(0, punto + 5));
  const ultimo = Number(s[punto + 4]);
  return (ultimo % 2 === 0 ? truncado : truncado + (x < 0 ? -1e-4 : 1e-4)).toFixed(4);
}

function xml(t: string): string {
  return t.replace(/[<>&"']/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);
}

/**
 * El `.3mf`: la malla con color por vértice, en el formato que sustituye al STL.
 *
 * ⚠️ **El STL no puede llevar esto y por eso existe este fichero.** El STL binario es de
 * 1987 y sólo tiene triángulos; las convenciones que meten RGB de 15 bits en su campo
 * *attribute byte count* son no estándar. El 3MF lleva color, unidades y metadatos DENTRO.
 *
 * El color va como `colorgroup` con **un índice por vértice de cada triángulo**, no uno por
 * triángulo: así el degradado cervical-incisal de una corona sobrevive.
 *
 * ⚠️ **Se construye a petición y no con el resto.** Son veinticinco megas de XML: hacerlo
 * siempre costaría un par de segundos de página congelada a todo el que regenere sin
 * querer el 3MF. El `.ply` y el `.stl` salen del cálculo; éste, del botón.
 */
export async function construye3mf(
  pos: Float32Array, caras: Uint32Array, rgb: Uint8Array, descripcion: string,
): Promise<Uint8Array> {
  // La paleta: el color cuantizado a saltos de 4, y un índice por vértice. Cuantizar no es
  // ahorro por ahorro — sin ello habría casi un color por vértice y el `colorgroup` sería
  // más grande que la malla.
  // ⚠️ **Se redondea a PAR y la paleta va ORDENADA, las dos cosas por el mismo motivo:
  // producir el mismo fichero que el emisor.** `np.round` usa redondeo bancario —2,5 → 2,
  // no 3— y `np.unique` devuelve las filas ordenadas. Con `Math.round` y orden de aparición
  // salían 971 colores en vez de 950 y todos los índices de triángulo distintos: un 3MF
  // igual de válido y distinto byte a byte del que produce el pipeline para el mismo caso.
  const aPar = (x: number) => {
    const e = Math.floor(x);
    const f = x - e;
    if (f > 0.5) return e + 1;
    if (f < 0.5) return e;
    return e % 2 === 0 ? e : e + 1;
  };
  const q = (v: number) =>
    Math.min(255, Math.max(0, aPar(v / PASO_PALETA_3MF) * PASO_PALETA_3MF));
  const claveDe = new Uint32Array(pos.length / 3);
  const vistos = new Set<number>();
  for (let i = 0; i < claveDe.length; i++) {
    const k = (q(rgb[i * 3]!) << 16) | (q(rgb[i * 3 + 1]!) << 8) | q(rgb[i * 3 + 2]!);
    claveDe[i] = k;
    vistos.add(k);
  }
  // Orden lexicográfico por (R,G,B), que es lo que hace `np.unique(axis=0)`; como los tres
  // canales caben en un entero de 24 bits en ese orden, ordenar el entero basta.
  const unicos = [...vistos].sort((a, b) => a - b);
  const donde = new Map<number, number>();
  unicos.forEach((k, n) => donde.set(k, n));
  const paleta = unicos.map(
    (k) => `<m:color color="#${k.toString(16).toUpperCase().padStart(6, '0')}"/>`,
  );
  const indice = new Uint32Array(claveDe.length);
  for (let i = 0; i < claveDe.length; i++) indice[i] = donde.get(claveDe[i]!)!;

  // Se acumula en trozos y se une una vez: concatenar cadenas de veinticinco megas dentro
  // de un bucle de 220.085 vueltas es cuadrático y no termina.
  const partes: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<model unit="millimeter" xml:lang="en-US"',
    ' xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"',
    ' xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02">',
    `<metadata name="Description">${xml(descripcion)}</metadata>`,
    '<resources><m:colorgroup id="1">', ...paleta, '</m:colorgroup>',
    '<object id="2" type="model" pid="1" pindex="0"><mesh><vertices>',
  ];
  for (let i = 0; i < pos.length / 3; i++) {
    partes.push(
      `<vertex x="${f4(pos[i * 3]!)}" y="${f4(pos[i * 3 + 1]!)}" z="${f4(pos[i * 3 + 2]!)}"/>`,
    );
  }
  partes.push('</vertices><triangles>');
  for (let t = 0; t < caras.length; t += 3) {
    const a = caras[t]!, b = caras[t + 1]!, c = caras[t + 2]!;
    partes.push(
      `<triangle v1="${a}" v2="${b}" v3="${c}" pid="1" ` +
      `p1="${indice[a]}" p2="${indice[b]}" p3="${indice[c]}"/>`,
    );
  }
  partes.push('</triangles></mesh></object></resources><build><item objectid="2"/></build></model>');

  const t = new TextEncoder();
  return escribeZip([
    {
      nombre: '[Content_Types].xml',
      datos: t.encode(
        '<?xml version="1.0" encoding="UTF-8"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>' +
        '</Types>',
      ),
    },
    {
      nombre: '_rels/.rels',
      datos: t.encode(
        '<?xml version="1.0" encoding="UTF-8"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Target="/3D/3dmodel.model" Id="rel0"' +
        ' Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>',
      ),
    },
    { nombre: '3D/3dmodel.model', datos: t.encode(partes.join('')) },
  ]);
}

/**
 * Regenera la malla coloreada a partir del contenedor abierto.
 *
 * `avisa` recibe una línea de estado para enseñar mientras dura; no es decorativa: el
 * cálculo tarda segundos y sin ella el botón parece colgado.
 */
export async function regenera(
  uos: UosLoader, avisa: (texto: string) => void,
  // ⚠️ **El cálculo entra por parámetro, y no es una abstracción gratuita.** Por defecto va
  // a un Worker, que es lo correcto en el navegador y lo único que no existe en Node — así
  // que sin esto la función que de verdad usa el visor no se podría probar entera: sólo
  // sus piezas, y el pegamento entre ellas es donde estaban los dos fallos que encontró
  // el test de color.
  calcula: (p: Peticion, progreso: (frac: number) => void) => Promise<Respuesta> = enWorker,
): Promise<Regenerado> {
  const escena = uos.porPrioridad.find((a) => a.uri.endsWith('.glb') && !a.external);
  const apar = await primeraApariencia(uos);
  if (!escena) {
    throw new Error(
      'este contenedor no lleva `asset.scene`: sin geometría dentro no hay malla que ' +
        'regenerar. El manifiesto sólo declara `ash_reversible` cuando la lleva.',
    );
  }
  if (!apar) {
    throw new Error(
      'este contenedor no lleva una capa `ash-gs-apariencia/1.0`: sin color por gaussiana ' +
        'la malla saldría entera en gris, que no es color de nadie.',
    );
  }

  avisa('leyendo la geometría del gemelo…');
  const malla = leeGlb(await uos.bytes(escena));
  // Los índices de todas las primitivas, seguidos, y el FDI llevado a cada vértice.
  const total = malla.primitivas.reduce((n, p) => n + p.indices.length, 0);
  const indices = new Uint32Array(total);
  const fdiVertice = new Int16Array(malla.posiciones.length / 3);
  let o = 0;
  for (const p of malla.primitivas) {
    indices.set(p.indices, o);
    o += p.indices.length;
    if (p.fdi === null) continue;
    for (const i of p.indices) fdiVertice[i] = p.fdi;
  }

  avisa('leyendo el color por gaussiana…');
  const campo = leePly(await uos.bytes(apar));
  const esquema = (await uos.sidecar<DescriptorGS>(apar)) ?? {};
  const col = enLineal(campo.columnas, esquema);
  const falta = ['x', 'y', 'z', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity', 'scale_0']
    .filter((n) => !col[n]);
  if (falta.length) {
    throw new Error(
      `a la capa de apariencia le faltan columnas (${falta.join(', ')}): no se puede ` +
        'calcular el color sin ellas.',
    );
  }
  const ng = col['x']!.length;
  const centros = new Float32Array(ng * 3);
  const fdc = new Float32Array(ng * 3);
  const sigma = new Float32Array(ng);
  // Sigma media de los tres ejes, como hace el emisor: el soporte de un splat elíptico
  // resumido en un número, que es lo que necesita la prueba de cobertura.
  const s0 = col['scale_0']!, s1 = col['scale_1'] ?? s0, s2 = col['scale_2'] ?? s0;
  for (let i = 0; i < ng; i++) {
    centros[i * 3] = col['x']![i]!;
    centros[i * 3 + 1] = col['y']![i]!;
    centros[i * 3 + 2] = col['z']![i]!;
    fdc[i * 3] = col['f_dc_0']![i]!;
    fdc[i * 3 + 1] = col['f_dc_1']![i]!;
    fdc[i * 3 + 2] = col['f_dc_2']![i]!;
    sigma[i] = (s0[i]! + s1[i]! + s2[i]!) / 3;
  }

  // ⚠️ **Qué piezas tienen color DECLARADO, no cuáles el campo sabe pintar.** El campo
  // pinta la arcada entera; lo que dice si un color es del paciente es la capa clínica.
  const conColor = await piezasConColor(uos);

  avisa(`mezclando ${(malla.posiciones.length / 3).toLocaleString()} vértices…`);
  const peticion: Peticion = {
    posiciones: malla.posiciones, indices, fdiVertice,
    centros, fdc, opacidad: col['opacity']!, sigma, conColor,
  };
  const res = await calcula(peticion, (frac) =>
    avisa(`mezclando color… ${Math.round(frac * 100)} %`));

  avisa('escribiendo los ficheros…');
  let conFdi = 0;
  for (let i = 0; i < fdiVertice.length; i++) if (fdiVertice[i]) conFdi++;
  const nv = malla.posiciones.length / 3;
  const meta = JSON.stringify({
    generado_por: 'uos-viewer',
    extension: 'ash_reversible/1.0',
    desde: { geometria: escena.id, color: apar.id, sha256: { escena: escena.sha256, apariencia: apar.sha256 } },
    vertices: nv,
    triangulos: malla.triangulos,
    con_color_medido: res.medidos,
    rellenados_desde_vecinos: res.rellenados,
    con_codigo_fdi: conFdi,
    que_pierde_cada_formato: {
      ply: 'nada: lleva color por vertice, codigo FDI y la bandera `medido`',
      '3mf': (
        'el codigo FDI y la bandera `medido`. Lleva el color, cuantizado a saltos de 4 ' +
        'por canal para que la paleta no tenga un color por vertice'
      ),
      stl: (
        'el codigo FDI y la bandera `medido`. Lleva color por CARA en RGB555 (convencion ' +
        'VisCAM, NO estandar): la mayoria de lectores lo ignoran y ensenan la geometria en ' +
        'gris sin avisar, y al ser por cara el degradado dentro de la corona se pierde'
      ),
    },
    aviso: (
      'el color NO lleva oclusion ambiental (es visualizacion) y su nivel absoluto no ' +
      'esta calibrado: la foto no llevaba referencia gris. Los vertices con medido=0 ' +
      'salen en gris neutro o heredan de un vecino de su misma pieza; ese color no es de ' +
      'nadie y no se debe medir encima'
    ),
  }, null, 1);

  return {
    posiciones: malla.posiciones,
    caras: indices,
    rgb: res.rgb,
    vertices: nv,
    triangulos: malla.triangulos,
    medidos: res.medidos,
    rellenados: res.rellenados,
    conFdi,
    ply: escribePly(malla.posiciones, indices, res.rgb, res.medido, fdiVertice),
    stl: escribeStl(malla.posiciones, indices, res.rgb),
    meta,
  };
}

/**
 * Los códigos FDI que la capa clínica declara con color medido.
 *
 * ⚠️ Si el contenedor no trae capa clínica se devuelve la lista vacía, y entonces **ninguna
 * pieza** queda marcada como medida. Es lo correcto y es incómodo a propósito: sin nada que
 * declare de qué coronas se midió el color, afirmar que alguna lo está sería inventarlo.
 */
async function piezasConColor(uos: UosLoader): Promise<number[]> {
  const doc = uos
    .de('document')
    .find((a) => !a.external && a.uri.startsWith('clinical/') && a.media_type === 'application/json');
  if (!doc) return [];
  const capa = JSON.parse(new TextDecoder().decode(await uos.bytes(doc))) as {
    teeth?: { fdi?: string | number; color?: unknown }[];
  };
  return (capa.teeth ?? [])
    .filter((t) => t.color)
    .map((t) => Number(t.fdi))
    .filter((n) => Number.isFinite(n));
}

/**
 * El mismo cálculo, en el hilo que llame. Para Node y para los tests.
 *
 * ⚠️ En el navegador NO se usa: son 112.067 vértices contra 113.218 gaussianas y la página
 * se quedaría congelada varios segundos, sin poder ni dibujar el progreso.
 */
export async function calculaAqui(
  p: Peticion, progreso: (frac: number) => void,
): Promise<Respuesta> {
  const { rgb, medido } = colorDesdeGaussianas(p, progreso);
  apagaSinDeclarar(p.fdiVertice, rgb, medido, p.conColor);
  const rellenados = rellenaHuecos(p.indices, p.fdiVertice, rgb, medido);
  let medidos = 0;
  for (let i = 0; i < medido.length; i++) medidos += medido[i]!;
  return { rgb, medido, medidos, rellenados };
}

/** La capa cuyo sidecar declara el perfil de apariencia. La autoridad es el sidecar. */
async function primeraApariencia(uos: UosLoader): Promise<Asset | null> {
  for (const a of uos.de('mesh_gs_scene')) {
    if (a.external || a.media_type === 'model/gltf-binary') continue;
    const d = await uos.sidecar<DescriptorGS>(a);
    if (d?.profile === 'ash-gs-apariencia/1.0') return a;
  }
  return null;
}

/**
 * Lanza el Worker y espera su respuesta.
 *
 * ⚠️ Va en un Worker por una razón medible: son 112.067 vértices contra 113.218 gaussianas,
 * y en el hilo principal la página se queda congelada varios segundos — sin poder ni
 * dibujar la barra de progreso que diría que sigue viva.
 */
function enWorker(p: Peticion, progreso: (frac: number) => void): Promise<Respuesta> {
  return new Promise((cumple, falla) => {
    const w = new Worker(new URL('./regenera.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (ev: MessageEvent<Respuesta & { progreso?: number; error?: string }>) => {
      if (typeof ev.data.progreso === 'number') { progreso(ev.data.progreso); return; }
      w.terminate();
      if (ev.data.error) falla(new Error(ev.data.error));
      else cumple(ev.data);
    };
    w.onerror = (e) => { w.terminate(); falla(new Error(e.message || 'el worker falló')); };
    w.postMessage(p);
  });
}
