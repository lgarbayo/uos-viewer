/**
 * De donde salen los bytes de un `.uos`. Tres orígenes, una sola interfaz.
 *
 * El contenedor es un ZIP sin comprimir con el directorio central al final, y eso es lo
 * que permite lo que el spec §11.1 pide: **bajar un asset suelto sin traerse el caso
 * entero**. Para el CBCT de un caso real eso es la diferencia entre 34 MB y 299.
 *
 * La interfaz es deliberadamente pequeña —tamaño y un rango de bytes— porque es lo único
 * que las tres fuentes tienen en común, y porque así el lector de ZIP no sabe si está
 * hablando con la red, con un fichero local o con un `File` que el usuario arrastró.
 */

export interface Reader {
  /** Bytes totales. Se necesita para localizar el directorio central, que va al final. */
  size(): Promise<number>;
  /** `[inicio, fin)`, en bytes. */
  slice(inicio: number, fin: number): Promise<Uint8Array>;
}

/**
 * Un `.uos` servido por HTTP, leído por rangos.
 *
 * ⚠️ Exige que el servidor honre `Range`. Si responde `200` en vez de `206` está
 * mandando el fichero entero y hay que **fallar**, no seguir: el caller creería estar
 * bajando 4 KB de índice y estaría bajando 299 MB, y sólo se notaría en la factura.
 */
export class HttpRangeReader implements Reader {
  private total: number | null = null;

  constructor(private readonly url: string) {}

  async size(): Promise<number> {
    if (this.total !== null) return this.total;
    const r = await fetch(this.url, { method: 'HEAD' });
    if (!r.ok) throw new Error(`No se pudo leer ${this.url}: HTTP ${r.status}`);
    const largo = r.headers.get('content-length');
    if (largo === null) {
      throw new Error(
        `${this.url} no declara \`content-length\`, así que no se sabe dónde está el ` +
          'directorio central del ZIP. Sin eso no hay lectura por rangos.',
      );
    }
    this.total = Number(largo);
    return this.total;
  }

  async slice(inicio: number, fin: number): Promise<Uint8Array> {
    const r = await fetch(this.url, {
      headers: { Range: `bytes=${inicio}-${fin - 1}` },
    });
    if (r.status !== 206) {
      throw new Error(
        `${this.url} respondió ${r.status} a un \`Range\`: el servidor no soporta ` +
          'rangos y estaría mandando el fichero entero. Se prefiere fallar a bajar ' +
          'cientos de megas sin que nadie lo pida.',
      );
    }
    return new Uint8Array(await r.arrayBuffer());
  }
}

/** Un `File` o `Blob`: el usuario arrastra el `.uos` al navegador. */
export class BlobReader implements Reader {
  constructor(private readonly blob: Blob) {}

  async size(): Promise<number> {
    return this.blob.size;
  }

  async slice(inicio: number, fin: number): Promise<Uint8Array> {
    return new Uint8Array(await this.blob.slice(inicio, fin).arrayBuffer());
  }
}
