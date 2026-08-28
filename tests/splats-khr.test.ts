/**
 * La apariencia leída del glTF, contra la misma leída del `.ply`.
 *
 * ⚠️ **Es lo único que autoriza a quitar el `.ply` del contenedor.** El emisor escribe la
 * capa dos veces —como primitiva `KHR_gaussian_splatting` dentro de `scene.glb` y como
 * `appearance.ply` suelto— y el visor ya prefiere la primera. Quitar la segunda sólo es
 * seguro si las dos llevan los mismos números, y «los mismos» aquí atraviesa tres
 * conversiones de ida y tres de vuelta: logit → lineal → logit, log → lineal → log, y el
 * cuaternión reordenado dos veces.
 *
 * Cualquiera de las seis mal puesta produce un fichero que se abre, se dibuja y está mal:
 * la arcada casi transparente, las elipses del tamaño de un píxel, o cada una girada.
 *
 * El contenedor es dato clínico y no se versiona, así que el test se salta si no está:
 *
 *     UOS_CORE=…/another_patient.uos npx vitest run
 */

import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { leeGlb } from '../src/uos/Glb';
import { leePly } from '../src/uos/Ply';
import { NodeFileReader } from '../src/uos/NodeReader';
import { campoDesdeSplats } from '../src/uos/SplatsKhr';
import { UosLoader } from '../src/uos/UosLoader';

const CORE = process.env['UOS_CORE'] ?? '';

describe.runIf(CORE !== '' && existsSync(CORE))('la apariencia dentro del glTF', () => {
  it('lleva los MISMOS números que el `.ply` que viaja al lado', async () => {
    const uos = await UosLoader.abrir(new NodeFileReader(CORE));

    const escena = uos.de('mesh_gs_scene').find((a) => a.media_type === 'model/gltf-binary');
    expect(escena, 'el contenedor no lleva `scene.glb`').toBeDefined();
    const malla = leeGlb(await uos.bytes(escena!));
    expect(malla.splats, 'la escena no trae la primitiva KHR_gaussian_splatting').not.toBeNull();

    // El contrato de la extensión, sobre el dato real y no sobre un fixture.
    expect(malla.splats!.kernel).toBe('ellipse');
    expect(malla.splats!.colorSpace).toBe('srgb_rec709_display');
    // ⚠️ Recorrido y no `Math.min(...arr)`: son 113.226 gaussianas, y el operador de
    // propagación las pasa como argumentos — `RangeError: Maximum call stack size`.
    const rango = (a: Float32Array): [number, number] => {
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < a.length; i++) { if (a[i]! < lo) lo = a[i]!; if (a[i]! > hi) hi = a[i]!; }
      return [lo, hi];
    };
    const [opLo, opHi] = rango(malla.splats!.opacidad);
    expect(opLo).toBeGreaterThanOrEqual(0);
    expect(opHi).toBeLessThanOrEqual(1);
    expect(rango(malla.splats!.escala)[0]).toBeGreaterThanOrEqual(0);

    let ply = null;
    for (const a of uos.de('mesh_gs_scene')) {
      if (a.external || a.media_type === 'model/gltf-binary') continue;
      const d = await uos.sidecar<{ profile?: string }>(a);
      if (d?.profile === 'ash-gs-apariencia/1.0') { ply = a; break; }
    }
    if (!ply) return; // contenedor ya sin el `.ply`: no hay contra qué comparar

    const ref = leePly(await uos.bytes(ply));
    const mio = campoDesdeSplats(malla.splats!);
    expect(mio.n).toBe(ref.n);

    // ⚠️ La tolerancia es de ida y vuelta en `float32`, no de criterio: el emisor escribió
    // `exp(scale)` en el GLB desde el `log(scale)` del PLY, y aquí se vuelve a tomar el
    // logaritmo. Cada paso redondea a 24 bits de mantisa. Lo que NO se admite es una
    // diferencia estructural — un orden de cuaternión cambiado da errores de orden 1.
    const columnas = ['x', 'y', 'z', 'f_dc_0', 'f_dc_1', 'f_dc_2',
                      'opacity', 'scale_0', 'scale_1', 'scale_2',
                      'rot_0', 'rot_1', 'rot_2', 'rot_3'];
    for (const k of columnas) {
      const a = ref.columnas[k]!;
      const b = mio.columnas[k]!;
      expect(b, `falta la columna ${k}`).toBeDefined();
      let peor = 0;
      for (let i = 0; i < ref.n; i++) {
        const d = Math.abs(a[i]! - b[i]!) / Math.max(1, Math.abs(a[i]!));
        if (d > peor) peor = d;
      }
      // ⚠️ **`opacity` admite diez veces más, y está medido.** El logit no está acotado y
      // la sigmoide satura: la gaussiana más opaca de este caso tiene logit 9,689, o sea
      // 0,999938 en lineal. En `float32` esa cifra conserva siete dígitos, así que
      // `1 − 0,999938` se queda con tres — cancelación catastrófica — y al volver al logit
      // el error relativo sube a 2,9e-5. No es un fallo de conversión: es el precio de
      // guardar en lineal algo que se usa en logit, y a 0,999938 contra 0,999966 no hay
      // diferencia visible. Las trece columnas restantes sí quedan por debajo de 1e-5.
      const tope = k === 'opacity' ? 1e-4 : 1e-5;
      expect(peor, `la columna ${k} se desvía ${peor.toExponential(2)} relativo`)
        .toBeLessThan(tope);
    }

    // El FDI por gaussiana, exacto: es un código, no una medida. Un `region_id` aproximado
    // sería un diente aproximado.
    const rr = ref.columnas['region_id'];
    if (rr) {
      let distintos = 0;
      for (let i = 0; i < ref.n; i++) if (rr[i] !== mio.columnas['region_id']![i]) distintos++;
      expect(distintos, `${distintos} código(s) FDI distintos`).toBe(0);
    }
  }, 120_000);
});
