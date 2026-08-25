import { describe, expect, it } from 'vitest';
import { NodeFileReader } from '../src/uos/NodeReader';
import { UosLoader } from '../src/uos/UosLoader';

const CORE = process.env.UOS_CORE ?? '';

/**
 * Lo que el botón «guardar» promete, probado sin navegador.
 *
 * El botón no puede testearse aquí —crea un `<a download>` y lo pulsa—, pero **lo que
 * promete sí**: que el fichero que sale del contenedor es byte a byte el que el manifiesto
 * declara. Eso son dos llamadas, `bytes()` y `verifica()`, y son las que se prueban.
 *
 * Importa porque el caso de uso es alguien llevándose el STL a una impresora 3D. Si lo que
 * sale no es lo que entró, no hay ningún sitio posterior donde se note.
 */
describe.skipIf(!CORE)('sacar un asset del contenedor', () => {
  it('el escaneo sale byte a byte lo que declara el manifiesto', async () => {
    const uos = await UosLoader.abrir(new NodeFileReader(CORE));
    const stl = uos.porPrioridad.find((a) => a.uri.endsWith('.stl'));
    expect(stl, 'el contenedor no trae el escaneo como STL').toBeTruthy();

    const bytes = await uos.bytes(stl!);
    expect(bytes.length).toBe(stl!.bytes);
    expect(await uos.verifica(stl!)).toBe(true);

    // Y que es un STL binario de verdad, no un fichero del tamaño correcto: la cabecera
    // son 80 bytes y luego un uint32 con el número de triángulos, que tiene que cuadrar
    // con el tamaño real (50 bytes por triángulo).
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const triangulos = v.getUint32(80, true);
    expect(84 + triangulos * 50).toBe(bytes.length);
  });

  it('un asset-directorio se niega a salir de golpe, y dice por qué', async () => {
    const uos = await UosLoader.abrir(new NodeFileReader(CORE));
    const dir = uos.porPrioridad.find((a) => a.uri.endsWith('/'));
    if (!dir) return; // un UOS-Core sin volumen no tiene ninguno
    await expect(uos.bytes(dir)).rejects.toThrow(/directorio/);
  });
});
