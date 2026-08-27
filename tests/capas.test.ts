import { describe, expect, it } from 'vitest';
import { NodeFileReader } from '../src/uos/NodeReader';
import { UosLoader } from '../src/uos/UosLoader';

const CORE = process.env.UOS_CORE ?? '';

/** Los perfiles de gaussianas que este formato emite hoy. */
const PERFILES = ['ash-twin/1.0', 'ash-twin-ajustado/1.0', 'ash-gs-apariencia/1.0'];

/**
 * El fallo que este test guarda: elegir un asset por un `media_type` inventado.
 *
 * `ponCapas` filtraba por `application/x-ply`, que no existe —un `.ply` no tiene tipo MIME
 * registrado y el manifiesto declara `application/octet-stream`—, así que no entraba
 * ninguna capa y el panel salía sin la sección entera **sin decir por qué**. La autoridad
 * sobre qué es cada asset es su sidecar `.gs.json`, que declara el perfil.
 */
describe.skipIf(!CORE)('las capas del campo se eligen por su SIDECAR', () => {
  it('los .ply del campo declaran perfil y no un media_type inventado', async () => {
    const uos = await UosLoader.abrir(new NodeFileReader(CORE));
    const capas = uos.de('mesh_gs_scene').filter((a) => a.sidecar_uri);
    expect(capas.length, 'el contenedor no trae capas de campo').toBeGreaterThan(0);

    for (const a of capas) {
      expect(a.media_type, `${a.id} usa un media_type de PLY que no existe`).not.toBe(
        'application/x-ply',
      );
      const d = await uos.sidecar<{ profile?: string; measured?: boolean }>(a);
      // ⚠️ El perfil se COMPRUEBA contra una lista, no contra uno solo: un contenedor
      // trae hoy densidad medida (`ash-twin/1.0`), su ajuste (`ash-twin-ajustado/1.0`) y
      // apariencia entrenada (`ash-gs-apariencia/1.0`), y las tres son legítimas. Lo que
      // no puede pasar es que una capa no declare ninguno: sus columnas se llaman igual
      // que las del 3DGS de facto y significan otra cosa.
      expect(
        PERFILES, `${a.id} declara el perfil desconocido \`${d?.profile}\``,
      ).toContain(d?.profile);
      // `measured` es lo que separa una capa medida de una de apariencia, y el panel lo
      // enseña: si no viajara, el visor tendría que adivinarlo.
      expect(typeof d?.measured).toBe('boolean');
    }
  });
});


/**
 * El FDI por gaussiana, y de donde dice que sale.
 *
 * ⚠️ **Es lo que sustituye a `derived/seg_teeth` en un contenedor de solo gaussianas.**
 * Esa capa indexa los vertices de `scene.glb`, que ya no viaja, asi que el codigo de pieza
 * tiene que ir EN el campo — y tiene que ir DECLARADO. El sidecar de la apariencia
 * enumeraba catorce columnas mientras el PLY escribia dieciocho: `region_id` viajaba en los
 * bytes y no en el descriptor, o sea que para un lector ajeno no existia.
 */
describe.skipIf(!CORE)('la apariencia declara el codigo FDI por gaussiana', () => {
  it('region_id viaja en el sidecar, no solo en los bytes', async () => {
    const uos = await UosLoader.abrir(new NodeFileReader(CORE));
    const capas = uos.de('mesh_gs_scene').filter((a) => a.sidecar_uri);
    const conPerfil = await Promise.all(
      capas.map(async (a) => ({
        a,
        d: await uos.sidecar<{
          profile?: string;
          columns?: { name?: string; measured?: boolean; vocabulary?: string | null }[];
        }>(a),
      })),
    );
    const ap = conPerfil.find((x) => x.d?.profile === 'ash-gs-apariencia/1.0');
    expect(ap, 'el contenedor no trae capa de apariencia').toBeTruthy();

    const region = ap!.d?.columns?.find((c) => c.name === 'region_id');
    expect(region, 'la apariencia no declara `region_id`: sin eso no hay seleccion').toBeTruthy();
    // Y tiene que declararse como lo que es. Unas etiquetas de inferencia sin decirlo se
    // leen como si fueran medidas, que es justo lo que este formato existe para impedir.
    expect(region!.measured).toBe(false);
    expect(region!.vocabulary).toBe('ISO-3950');
  });
});
