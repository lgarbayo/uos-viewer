/**
 * Un `.uos` en el disco local. Sólo para Node: los tests y las herramientas de línea.
 *
 * No vive en `Reader.ts` con los otros dos porque importa `node:fs`, y meter eso en el
 * módulo que carga el navegador obligaría al bundler a resolverlo o a fingir que existe.
 */

import { open, stat } from 'node:fs/promises';

import type { Reader } from './Reader';

export class NodeFileReader implements Reader {
  constructor(private readonly ruta: string) {}

  async size(): Promise<number> {
    return (await stat(this.ruta)).size;
  }

  async slice(inicio: number, fin: number): Promise<Uint8Array> {
    const fh = await open(this.ruta, 'r');
    try {
      const buf = new Uint8Array(fin - inicio);
      await fh.read(buf, 0, buf.length, inicio);
      return buf;
    } finally {
      await fh.close();
    }
  }
}
