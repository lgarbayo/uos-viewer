/**
 * Escritor de ZIP mínimo, para los ficheros que el visor GENERA.
 *
 * ⚠️ **No tiene nada que ver con `ZipReader`, y no debe mezclarse con él.** Aquel LEE un
 * `.uos` por rangos y exige `STORE` porque el §3 del spec lo exige — un contenedor
 * comprimido no se puede leer por rangos. Esto escribe un paquete OPC (un `.3mf`) que sale
 * del visor hacia el disco de quien lo pide: no lo va a leer nadie por rangos, y ahí sí
 * interesa comprimir, porque el XML de una arcada son veinticinco megas de texto.
 *
 * ⚠️ **Y no arrastra ninguna biblioteca.** El DEFLATE lo hace `CompressionStream`, que está
 * en el navegador desde hace años y produce exactamente el flujo crudo que el método 8 del
 * ZIP espera. Donde no exista, cada entrada se guarda sin comprimir (`STORE`, método 0):
 * el fichero es más grande y **igual de válido**, que es mejor que fallar o que meter una
 * dependencia de 40 kB para un caso que casi no ocurre.
 */

/** Una entrada del paquete: su ruta dentro del ZIP y sus bytes. */
export interface EntradaZip {
  readonly nombre: string;
  readonly datos: Uint8Array;
}

// CRC-32 (IEEE 802.3), la que el ZIP exige por entrada. Tabla construida una vez.
const TABLA = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = TABLA[(c ^ b[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function desinfla(b: Uint8Array): Promise<{ datos: Uint8Array; metodo: number }> {
  const CS = (globalThis as { CompressionStream?: typeof CompressionStream }).CompressionStream;
  if (!CS) return { datos: b, metodo: 0 };
  try {
    const flujo = new Blob([b as BlobPart]).stream().pipeThrough(new CS('deflate-raw'));
    const comprimido = new Uint8Array(await new Response(flujo).arrayBuffer());
    // Si comprimir no ayuda —datos ya comprimidos, entradas diminutas— se guarda crudo.
    return comprimido.length < b.length
      ? { datos: comprimido, metodo: 8 }
      : { datos: b, metodo: 0 };
  } catch {
    return { datos: b, metodo: 0 };
  }
}

/**
 * El ZIP entero en memoria.
 *
 * Sin ZIP64 y sin `data descriptor`: los tamaños se conocen antes de escribir, así que van
 * en la cabecera local, que es lo que espera cualquier lector. Un `.3mf` de una arcada son
 * unos pocos megas — muy lejos del límite de 4 GB donde ZIP64 haría falta.
 */
export async function escribeZip(entradas: readonly EntradaZip[]): Promise<Uint8Array> {
  const trozos: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const e of entradas) {
    const nombre = new TextEncoder().encode(e.nombre);
    const { datos, metodo } = await desinfla(e.datos);
    const crc = crc32(e.datos);

    const local = new Uint8Array(30 + nombre.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); // firma
    lv.setUint16(4, 20, true); // versión necesaria
    lv.setUint16(6, 0, true); // banderas
    lv.setUint16(8, metodo, true);
    lv.setUint16(10, 0, true); // hora
    lv.setUint16(12, 0x21, true); // fecha: 1980-01-01, fija y sin dato personal
    lv.setUint32(14, crc, true);
    lv.setUint32(18, datos.length, true);
    lv.setUint32(22, e.datos.length, true);
    lv.setUint16(26, nombre.length, true);
    lv.setUint16(28, 0, true); // extra
    local.set(nombre, 30);
    trozos.push(local, datos);

    const dir = new Uint8Array(46 + nombre.length);
    const dv = new DataView(dir.buffer);
    dv.setUint32(0, 0x02014b50, true);
    dv.setUint16(4, 20, true); // versión del que escribió
    dv.setUint16(6, 20, true); // versión necesaria
    dv.setUint16(8, 0, true);
    dv.setUint16(10, metodo, true);
    dv.setUint16(12, 0, true);
    dv.setUint16(14, 0x21, true);
    dv.setUint32(16, crc, true);
    dv.setUint32(20, datos.length, true);
    dv.setUint32(24, e.datos.length, true);
    dv.setUint16(28, nombre.length, true);
    dv.setUint32(42, offset, true);
    dir.set(nombre, 46);
    central.push(dir);

    offset += local.length + datos.length;
  }

  const dirLargo = central.reduce((n, c) => n + c.length, 0);
  const fin = new Uint8Array(22);
  const fv = new DataView(fin.buffer);
  fv.setUint32(0, 0x06054b50, true);
  fv.setUint16(8, entradas.length, true);
  fv.setUint16(10, entradas.length, true);
  fv.setUint32(12, dirLargo, true);
  fv.setUint32(16, offset, true);

  const todo = [...trozos, ...central, fin];
  const total = todo.reduce((n, t) => n + t.length, 0);
  const fuera = new Uint8Array(total);
  let o = 0;
  for (const t of todo) { fuera.set(t, o); o += t.length; }
  return fuera;
}
