/**
 * La regeneración del visor, contra la salida del pipeline en Python.
 *
 * ⚠️ **Es el único test que puede decir si la reversibilidad es de verdad.** El manifiesto
 * afirma —extensión `ash_reversible/1.0`— que de `asset.scene` más `asset.apariencia` sale
 * una malla coloreada. El visor ahora la calcula, pero «calcula algo» y «calcula lo mismo»
 * son cosas distintas: la mezcla es una media ponderada sobre 32 vecinas con caída
 * gaussiana, y cualquier discrepancia en el orden de los vecinos, en las convenciones de
 * unidades o en la prueba de cobertura daría un color plausible y distinto. Un dentista que
 * regenerase desde el visor se llevaría a la fresadora otra cosa que la que midió el
 * emisor, sin ninguna señal de que son dos.
 *
 * Por eso se compara **vértice a vértice** contra `arcada-color.ply`, el fichero que
 * produjo el pipeline con `scipy` y `numpy`.
 *
 * Los dos ficheros son dato clínico y no se versionan, así que el test se **salta** si no
 * están, en vez de fallar en el CI de alguien que clone el repositorio:
 *
 *     UOS_CORE=…/another_patient.uos \
 *     UOS_PLY_REF=…/mejorado/arcada-color.ply npx vitest run
 */

import { existsSync, readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { calculaAqui, construye3mf, regenera } from '../src/app/Regenera';
import { NodeFileReader } from '../src/uos/NodeReader';
import { UosLoader } from '../src/uos/UosLoader';

const CORE = process.env['UOS_CORE'] ?? '';
const REF = process.env['UOS_PLY_REF'] ?? '';
const REF3MF = process.env['UOS_3MF_REF'] ?? '';
const hay = (p: string) => p !== '' && existsSync(p);

/** El PLY de referencia: `rgb` y `medido` por vértice. */
function refDe(ruta: string): { rgb: Uint8Array; medido: Uint8Array; n: number } {
  const b = readFileSync(ruta);
  const fin = b.indexOf('end_header\n') + 'end_header\n'.length;
  const cab = b.subarray(0, fin).toString('ascii').split('\n');
  const n = Number(cab.find((l) => l.startsWith('element vertex'))!.split(' ')[2]);
  // ⚠️ El orden lo dice la cabecera y no la intuición: x,y,z (12 B) + red,green,blue (3 B)
  // + **fdi** (short, 2 B) + **medido** (uchar, 1 B) = 18 B. Escrito al revés —`medido`
  // antes que `fdi`— este lector devolvía el byte bajo del código FDI como si fuera la
  // bandera, y el test denunciaba 112.003 discrepancias que no existían.
  const paso = 12 + 3 + 2 + 1;
  const rgb = new Uint8Array(n * 3);
  const medido = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const o = fin + i * paso;
    rgb[i * 3] = b[o + 12]!; rgb[i * 3 + 1] = b[o + 13]!; rgb[i * 3 + 2] = b[o + 14]!;
    medido[i] = b[o + 17]!;
  }
  return { rgb, medido, n };
}

describe.runIf(hay(CORE) && hay(REF))('la arcada regenerada por el visor', () => {
  it('da el MISMO color que el pipeline en Python', async () => {
    const uos = await UosLoader.abrir(new NodeFileReader(CORE));

    const r = await regenera(uos, () => {}, calculaAqui);
    const malla = { posiciones: r.posiciones };
    const rgb = r.rgb;
    const raw = Buffer.from(r.ply);
    const start = raw.indexOf('end_header\n') + 'end_header\n'.length;
    const medido = Uint8Array.from({ length: r.vertices }, (_, i) => raw[start + i * 18 + 17]!);
    expect(r.conFdi).toBeGreaterThan(0);
    expect(new DataView(r.stl.buffer).getUint32(80, true)).toBe(r.triangulos);
    expect(r.stl.length).toBe(84 + r.triangulos * 50);
    const provenance = JSON.parse(r.meta).desde;
    expect(provenance.color_sha256).toBeDefined();
    if (uos.porPrioridad.some(a => a.id === 'asset.seg_teeth')) {
      expect(provenance.etiquetas_asset).toBe('asset.seg_teeth');
      expect(provenance.etiquetas_sha256).toBeDefined();
    }

    const ref = refDe(REF);
    expect(ref.n).toBe(malla.posiciones.length / 3);

    // ⚠️ **Se compara EXACTO, byte a byte, y se puede.** Hubo dos versiones de este test
    // con tolerancia —«media 0,48/255, seis vértices dispares»— y las dos estaban tapando
    // errores reales del puerto, no ruido numérico:
    //
    //   · **el emisor TRUNCA al pasar a byte y aquí se redondeaba.** `(clip(c,0,1) *
    //     255).astype(np.uint8)` trunca; medio paso de más en todos los canales, que es
    //     exactamente la media de 0,48 que se veía. En el STL, ese medio paso movía el
    //     13 % de las caras al escalón de al lado al cuantizar a cinco bits.
    //   · **el relleno de huecos usa MEDIANA y aquí se usaba media.** Un hueco está en el
    //     borde de una corona, rodeado de vecinos de los que uno o dos pueden ser mucho
    //     más oscuros. La media arrastra ese valor; la mediana lo ignora.
    //
    // Con las dos corregidas la coincidencia es total: 0 vértices distintos de 112.067.
    // Por eso la comparación no admite tolerancia — una tolerancia aquí no absorbe
    // «precisión de coma flotante», absorbe la próxima vez que las dos implementaciones
    // dejen de decir lo mismo, y lo que sale de aquí es lo que alguien lleva a una
    // fresadora.
    let distintos = 0;
    for (let i = 0; i < ref.n; i++) if (medido[i] !== ref.medido[i]) distintos++;
    expect(distintos, `${distintos} vértice(s) discrepan en la bandera \`medido\``).toBe(0);

    let peor = 0;
    const dispares = new Set<number>();
    for (let i = 0; i < ref.n * 3; i++) {
      const d = Math.abs(rgb[i]! - ref.rgb[i]!);
      if (d > peor) peor = d;
      if (d) dispares.add((i / 3) | 0);
    }
    expect(
      dispares.size,
      `${dispares.size} vértice(s) con algún canal distinto, el peor en ${peor}/255`,
    ).toBe(0);
    const referenceStl = REF.replace(/\.ply$/, '.stl');
    if (hay(referenceStl)) {
      const reference = readFileSync(referenceStl);
      const actual = Buffer.from(r.stl);
      expect(actual.length).toBe(reference.length);
      let different = 0;
      for (let t = 0; t < r.triangulos; t++) {
        // Normals may differ in arithmetic precision; carried vertex positions and
        // per-face colour attributes must match exactly.
        const start = 84 + t * 50 + 12;
        if (!actual.subarray(start, start + 38).equals(reference.subarray(start, start + 38))) different++;
      }
      expect(different, 'triangles with different geometry or colour').toBe(0);
    }
  }, 120_000);
});

/**
 * Saca una entrada de un ZIP, con `inflateRawSync` de Node para las comprimidas.
 *
 * Es de usar y tirar y vive en el test a propósito: el visor **lee** `.uos`, que el §3 del
 * spec obliga a guardar sin comprimir, así que su lector no necesita saber desinflar. Aquí
 * hace falta sólo para abrir el `.3mf` de referencia, que sí va comprimido.
 */
function entradaZip(b: Buffer, nombre: string): string {
  const objetivo = Buffer.from(nombre, 'utf8');
  for (let o = 0; o + 30 < b.length; o++) {
    if (b.readUInt32LE(o) !== 0x04034b50) continue;
    const nl = b.readUInt16LE(o + 26);
    if (nl !== objetivo.length || !b.subarray(o + 30, o + 30 + nl).equals(objetivo)) continue;
    const metodo = b.readUInt16LE(o + 8);
    const comp = b.readUInt32LE(o + 18);
    const datos = b.subarray(o + 30 + nl + b.readUInt16LE(o + 28), o + 30 + nl + b.readUInt16LE(o + 28) + comp);
    return (metodo === 8 ? inflateRawSync(datos) : datos).toString('utf8');
  }
  throw new Error(`el ZIP no trae \`${nombre}\``);
}

describe.runIf(hay(CORE) && hay(REF3MF))('el 3MF regenerado por el visor', () => {
  it('es el MISMO modelo que el del pipeline, byte a byte', async () => {
    const uos = await UosLoader.abrir(new NodeFileReader(CORE));
    const r = await regenera(uos, () => {}, calculaAqui);
    const mio = await construye3mf(r.posiciones, r.caras, r.rgb, 'da igual: no se compara');

    // ⚠️ Se compara el MODELO, no el paquete. El ZIP lleva la fecha, el orden de las
    // entradas y el nivel de compresión, que son del que escribe y no dicen nada de la
    // malla; el `3dmodel.model` es el dato. Comparar el ZIP entero haría fallar el test
    // porque `CompressionStream` y `zlib` eligen bloques distintos, que no es un defecto.
    const a = entradaZip(Buffer.from(mio), '3D/3dmodel.model');
    const b = entradaZip(readFileSync(REF3MF), '3D/3dmodel.model');
    // ⚠️ Y desde `<resources>`, porque la descripción de la cabecera la escribe cada uno.
    // Lo que tiene que coincidir es la paleta, los vértices y los triángulos con su índice
    // de color — y coinciden sólo si además del cálculo cuadran dos cosas que no son
    // obvias: `numpy` redondea al par (`np.round` y `f"{x:.4f}"`, no `Math.round` ni
    // `toFixed`) y `np.unique` devuelve la paleta ORDENADA, no en orden de aparición.
    expect(a.slice(a.indexOf('<resources>'))).toBe(b.slice(b.indexOf('<resources>')));
  }, 300_000);
});
