import { describe, expect, it } from 'vitest';
import { NodeFileReader } from '../src/uos/NodeReader';
import { UosLoader } from '../src/uos/UosLoader';

const CORE = process.env.UOS_CORE ?? '';

/**
 * El fallo que estos tests guardan, y que doce pruebas verdes no vieron.
 *
 * Un `scene.glb` de este formato viene partido en **un primitive por diente**, con su
 * `extras.uos_fdi`, que es como el §5.1 define el picking semántico. El lector del visor
 * se quedaba con la primera malla y tiraba las demás: sobre un contenedor de quince piezas
 * eso dejaba en pantalla el 32 % de la superficie, desgarrada. Nada fallaba —ni el
 * `sha256`, ni el manifiesto, ni el tipo— porque el fichero estaba perfecto; lo que se
 * perdía era geometría **después** de leerlo.
 */
describe.skipIf(!CORE)('la escena glTF entra ENTERA', () => {
  it('cada primitive del glb es un diente y ninguno se queda fuera', async () => {
    const uos = await UosLoader.abrir(new NodeFileReader(CORE));
    const glb = uos
      .de('mesh_gs_scene')
      .find((a) => a.media_type === 'model/gltf-binary');
    expect(glb, 'el contenedor no trae escena glTF').toBeTruthy();

    const b = await uos.bytes(glb!);
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const jlen = v.getUint32(12, true);
    const json = JSON.parse(
      new TextDecoder().decode(b.subarray(20, 20 + jlen)),
    ) as {
      meshes: { primitives: { indices: number; attributes: Record<string, number>;
                              extras?: { uos_fdi?: string } }[] }[];
      accessors: { count: number }[];
    };

    const prims = json.meshes[0]!.primitives;
    // Todos comparten el buffer de posiciones: es lo que permite unirlos concatenando
    // índices, sin duplicar un vértice y sin romper el cruce con `derived/`.
    const pos = new Set(prims.map((p) => p.attributes['POSITION']));
    expect(pos.size, 'los primitives no comparten POSITION').toBe(1);

    const caras = prims.reduce((s, p) => s + json.accessors[p.indices]!.count / 3, 0);
    const primera = json.accessors[prims[0]!.indices]!.count / 3;
    if (prims.length > 1) {
      expect(primera).toBeLessThan(caras * 0.9);
    }
    // Y si viene partido, los trozos llevan código FDI: si no, la partición no significa
    // nada y sería sólo una forma cara de escribir la misma malla.
    if (prims.length > 1) {
      const conFdi = prims.filter((p) => p.extras?.uos_fdi).length;
      expect(conFdi).toBe(prims.length - 1); // el primero es lo NO etiquetado (encía)
    }
  });
});

/**
 * El otro fallo de la misma familia: elegir un asset por un `media_type` inventado.
 *
 * `ponCapas` filtraba por `application/x-ply`, que no existe —un `.ply` no tiene tipo MIME
 * registrado y el manifiesto declara `application/octet-stream`—, así que no entraba
 * ninguna capa y el panel salía sin la sección entera **sin decir por qué**. La autoridad
 * sobre qué es cada asset es su sidecar `.gs.json`, que declara el perfil.
 */
describe.skipIf(!CORE)('las capas del campo se eligen por su SIDECAR', () => {
  it('los .ply del campo declaran perfil y no un media_type inventado', async () => {
    const uos = await UosLoader.abrir(new NodeFileReader(CORE));
    const capas = uos
      .de('mesh_gs_scene')
      .filter((a) => a.media_type !== 'model/gltf-binary');
    expect(capas.length, 'el contenedor no trae capas de campo').toBeGreaterThan(0);

    for (const a of capas) {
      expect(a.media_type, `${a.id} usa un media_type de PLY que no existe`).not.toBe(
        'application/x-ply',
      );
      const d = await uos.sidecar<{ profile?: string; measured?: boolean }>(a);
      expect(d?.profile, `${a.id} no declara perfil en su sidecar`).toBe('ash-twin/1.0');
      // `measured` es lo que separa una capa medida de una de apariencia, y el panel lo
      // enseña: si no viajara, el visor tendría que adivinarlo.
      expect(typeof d?.measured).toBe('boolean');
    }
  });
});
