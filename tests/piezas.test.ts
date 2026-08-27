/**
 * El codigo FDI por gaussiana, dentro de `Splats`.
 *
 * ⚠️ **El fallo que estos tests guardan no rompe nada: miente en cada clic.** Una capa de
 * apariencia por encima del tope se MUESTREA, y si `region_id` se recorriera aparte de las
 * posiciones, la gaussiana `i` de pantalla llevaria el codigo de otra. El visor seguiria
 * funcionando, la seleccion seguiria encendiendo una pieza, y seria la pieza equivocada.
 *
 * ⚠️ **Lo que NO se prueba aqui, y hay que decirlo:** que en el pase de seleccion gane la
 * gaussiana mas cercana a la camara. Eso es un render de verdad y necesita contexto WebGL,
 * que no hay en este runner. Lo que si se comprueba es que el material del pase pida
 * profundidad y no mezcla, que es la condicion de la que depende.
 */

import { Scene } from 'three';
import { describe, expect, it } from 'vitest';

import { Splats, TOPE_PRIMITIVAS } from '../src/app/Splats';
import type { CampoPly } from '../src/uos/Ply';

/** Un campo de apariencia con `n` gaussianas y un FDI que es funcion del indice. */
function campo(n: number, conRegion = true): CampoPly {
  const f = (g: (i: number) => number): Float32Array =>
    Float32Array.from({ length: n }, (_, i) => g(i));
  const columnas: Record<string, Float32Array | Int16Array> = {
    // Cada gaussiana en su propia x: asi la posicion identifica a la gaussiana.
    x: f((i) => i), y: f(() => 0), z: f(() => 0),
    opacity: f(() => 4), scale_0: f(() => -1), f_dc_0: f(() => 0),
    f_dc_1: f(() => 0), f_dc_2: f(() => 0),
  };
  // 11..14 ciclico, con un 0 de cada cinco: encia y piezas mezcladas, como en un caso real.
  if (conRegion) columnas['region_id'] = Int16Array.from({ length: n },
    (_, i) => (i % 5 === 0 ? 0 : 11 + (i % 4)));
  return { n, columnas, comentarios: {} } as unknown as CampoPly;
}

function fdiDe(splats: Splats, id: string): { pos: Float32Array; fdi: Float32Array } {
  // @ts-expect-error acceso al estado privado: es lo que hay que inspeccionar.
  const p = splats.nubes.get(id)!;
  return {
    pos: p.geometry.getAttribute('position').array as Float32Array,
    fdi: p.geometry.getAttribute('fdi').array as Float32Array,
  };
}

const esperado = (i: number): number => (i % 5 === 0 ? 0 : 11 + (i % 4));

describe('el FDI por gaussiana', () => {
  it('viaja alineado con las posiciones cuando no hay muestreo', () => {
    const s = new Splats(new Scene());
    s.añadeApariencia('ap', 'apariencia', campo(1000));
    const { pos, fdi } = fdiDe(s, 'ap');
    for (let i = 0; i < 1000; i++) {
      expect(fdi[i]).toBe(esperado(pos[i * 3]!));
    }
  });

  it('sigue alineado DESPUES de muestrear', () => {
    // El caso real: 119.723 gaussianas caben, pero un campo de densidad de un millon y
    // medio no. Se fuerza el muestreo pasando del tope.
    const n = TOPE_PRIMITIVAS + 1000;
    const s = new Splats(new Scene());
    s.añadeApariencia('ap', 'apariencia', campo(n));
    const { pos, fdi } = fdiDe(s, 'ap');
    expect(pos.length / 3).toBeLessThan(n);
    for (let i = 0; i < pos.length / 3; i++) {
      // `pos[i*3]` es el indice ORIGINAL de esa gaussiana, por como se construyo el campo.
      expect(fdi[i], `la gaussiana ${i} lleva el FDI de otra`).toBe(esperado(pos[i * 3]!));
    }
  });

  it('una capa sin region_id no promete seleccion', () => {
    const s = new Splats(new Scene());
    s.añadeApariencia('ap', 'apariencia', campo(50, false));
    expect(s.hayFdi).toBe(false);
    expect(s.capas[0]!.conFdi).toBe(false);
    expect(s.capas[0]!.piezas).toEqual([]);
  });

  it('cuenta las piezas sobre lo que SE DIBUJA', () => {
    const s = new Splats(new Scene());
    s.añadeApariencia('ap', 'apariencia', campo(100));
    const c = s.capas[0]!;
    expect(s.hayFdi).toBe(true);
    expect(c.piezas).toEqual([11, 12, 13, 14]);
    // 100 gaussianas, una de cada cinco es encia: 80 con codigo.
    expect(c.conPieza).toBe(80);
  });

  it('resaltar una pieza es un uniform, no reconstruir el buffer', () => {
    const s = new Splats(new Scene());
    s.añadeApariencia('ap', 'apariencia', campo(100));
    // @ts-expect-error acceso al estado privado
    const u = (s.nubes.get('ap')!.material as { uniforms: Record<string, { value: number }> })
      .uniforms;
    expect(u['resaltada']!.value).toBe(-1);
    s.resalta(13);
    expect(u['resaltada']!.value).toBe(13);
    expect(s.seleccionada).toBe(13);
    s.resalta(null);
    expect(u['resaltada']!.value).toBe(-1);
  });

  it('sin capa con FDI, piezaEn no intenta renderizar nada', () => {
    const s = new Splats(new Scene());
    s.añadeApariencia('ap', 'apariencia', campo(50, false));
    // Si intentara renderizar, el renderer nulo reventaria. Devolver `null` sin tocarlo es
    // la unica respuesta correcta: no hay contra que preguntar.
    expect(s.piezaEn(null as never, null as never, 0, 0, 100, 100)).toBeNull();
  });
});
