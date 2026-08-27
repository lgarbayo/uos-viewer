/**
 * El Worker: sólo el sobre. El cálculo vive en `ColorMalla.ts` para poder probarlo.
 *
 * ⚠️ Va en un Worker por una razón medible, no por higiene: son 112.067 vértices contra
 * 113.218 gaussianas, y en el hilo principal la página se queda congelada varios segundos
 * — sin poder ni dibujar la barra de progreso que diría que sigue viva.
 */

import { apagaSinDeclarar, colorDesdeGaussianas, rellenaHuecos } from '../uos/ColorMalla';
import type { Peticion, Respuesta } from '../uos/ColorMalla';

self.onmessage = (ev: MessageEvent<Peticion>) => {
  try {
    const p = ev.data;
    const { rgb, medido } = colorDesdeGaussianas(p, (frac) =>
      (self as unknown as Worker).postMessage({ progreso: frac }),
    );
    // El orden importa: apagar las piezas sin color declarado ANTES de rellenar, o esos
    // vértices heredarían color de sus vecinos y volverían a salir como si fueran medidos.
    apagaSinDeclarar(p.fdiVertice, rgb, medido, p.conColor);
    const rellenados = rellenaHuecos(p.indices, p.fdiVertice, rgb, medido);
    let medidos = 0;
    for (let i = 0; i < medido.length; i++) medidos += medido[i]!;
    const fuera: Respuesta = { rgb, medido, medidos, rellenados };
    (self as unknown as Worker).postMessage(fuera, [rgb.buffer, medido.buffer]);
  } catch (e) {
    (self as unknown as Worker).postMessage({
      error: e instanceof Error ? e.message : String(e),
    });
  }
};
