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
  it('un asset que SÍ viaja sale byte a byte lo que declara el manifiesto', async () => {
    const uos = await UosLoader.abrir(new NodeFileReader(CORE));
    const dentro = uos.porPrioridad.find(
      (a) => !a.external && !a.uri.endsWith('/') && a.bytes > 0,
    );
    expect(dentro, 'el contenedor no trae ningún asset dentro').toBeTruthy();

    const bytes = await uos.bytes(dentro!);
    expect(bytes.length).toBe(dentro!.bytes);
    expect(await uos.verifica(dentro!)).toBe(true);
  });

  /**
   * ⚠️ **El perfil de solo gaussianas.** El escaneo original y las fotos NO viajan: el
   * contenedor lleva el campo gaussiano y el manifiesto, y de lo demás declara el hash.
   *
   * El lector bajaba a buscar `sha256:33a8f5…` como si fuera una entrada del ZIP, y el
   * error decía «el contenedor no lleva `sha256:33a8f5…`» — que suena a fichero corrupto
   * cuando lo que pasa es que el perfil no lo lleva A PROPÓSITO. La diferencia importa:
   * una es un `.uos` roto y la otra es un `.uos` haciendo lo que promete.
   */
  it('un asset EXTERNO se niega a salir, y dice que no está en vez de fallar', async () => {
    const uos = await UosLoader.abrir(new NodeFileReader(CORE));
    const fuera = uos.porPrioridad.find((a) => a.external);
    if (!fuera) return; // un contenedor completo no tiene ninguno
    // La `uri` es la dirección de contenido, y es su propio sha256: un fichero que no
    // viaja no tiene ruta, y una ruta local sacaría el directorio del paciente del `.uos`.
    expect(fuera.uri).toBe(`sha256:${fuera.sha256}`);
    await expect(uos.bytes(fuera)).rejects.toThrow(/no viaja dentro/);
  });

  it('un asset-directorio se niega a salir de golpe, y dice por qué', async () => {
    const uos = await UosLoader.abrir(new NodeFileReader(CORE));
    const dir = uos.porPrioridad.find((a) => a.uri.endsWith('/'));
    if (!dir) return; // un UOS-Core sin volumen no tiene ninguno
    await expect(uos.bytes(dir)).rejects.toThrow(/directorio/);
  });
});
