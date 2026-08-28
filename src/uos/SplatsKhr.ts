/**
 * La capa `KHR_gaussian_splatting` del glTF → lo que consumen los dos rasterizadores.
 *
 * ⚠️ **El contenedor ya no necesita llevar el `.ply` de apariencia.** La capa viaja dentro
 * de `scene.glb` como primitiva estándar, así que un visor glTF conforme la dibuja sin
 * saber nada de UOS — que es la razón de que el formato exista. Este módulo es lo que
 * permite que el NUESTRO también la dibuje: lee la primitiva y produce las columnas en
 * convención INRIA, que es lo que esperan `Splats` y el rasterizador de `Apariencia`.
 *
 * ⚠️ **Es un adaptador, y hay que llamarlo por su nombre.** La biblioteca que dibuja los
 * splats (`@mkkellogg/gaussian-splats-3d`) lee PLY, no glTF con la extensión. Lo que se
 * hace aquí es traducir; lo que se ha ganado está en el CONTENEDOR, que ahora declara la
 * capa en un estándar y no en una convención nuestra. Decir que «el visor lee la
 * extensión» sería cierto sólo a medias, y esa media es la que importa.
 *
 * Las tres conversiones son las inversas exactas de las que hace el emisor:
 *
 * | | extensión | PLY INRIA |
 * |---|---|---|
 * | opacidad | lineal `[0,1]` | logit |
 * | escala | lineal, no negativa | logaritmo |
 * | cuaternión | `(x,y,z,w)` | `(w,x,y,z)` |
 */

import type { SplatsGlb } from './Glb';
import type { CampoPly } from './Ply';

/** Lo mínimo que una gaussiana necesita para no reventar el logaritmo ni el logit. */
const MINIMO = 1e-8;

/**
 * Las columnas en convención INRIA, tal y como saldrían de un `appearance.ply`.
 *
 * ⚠️ **`opacity` vuelve a logit y `scale_*` a logaritmo porque es lo que el consumidor
 * espera, no porque sea mejor.** El shader de `Splats` aplica `sigmoid(opacity)` y la
 * biblioteca de splats exponencia las escalas: entregarles los valores ya lineales daría
 * una arcada casi transparente con las elipses del tamaño de un píxel. Traducir a la
 * convención de quien lee es el trabajo de un adaptador; cambiar al consumidor para que
 * acepte las dos sería repartir la ambigüedad por todo el visor.
 */
export function campoDesdeSplats(gs: SplatsGlb): CampoPly {
  const n = gs.n;
  const col: Record<string, Float32Array> = {};
  for (const k of ['x', 'y', 'z', 'opacity', 'scale_0', 'scale_1', 'scale_2',
                   'f_dc_0', 'f_dc_1', 'f_dc_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3']) {
    col[k] = new Float32Array(n);
  }
  if (gs.regionId) col['region_id'] = new Float32Array(n);
  if (gs.ao) col['ao'] = new Float32Array(n);
  if (gs.normales) for (const k of ['nx', 'ny', 'nz']) col[k] = new Float32Array(n);
  for (let k = 0; k < gs.sh1.length * 3; k++) col[`f_rest_${k}`] = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    col['x']![i] = gs.posiciones[i * 3]!;
    col['y']![i] = gs.posiciones[i * 3 + 1]!;
    col['z']![i] = gs.posiciones[i * 3 + 2]!;

    // Lineal → logit. Se acota antes de la división: una opacidad de exactamente 0 o 1
    // daría ±Infinity, y un `Infinity` en el buffer no revienta — hace desaparecer la
    // gaussiana sin decir nada.
    const a = Math.min(1 - MINIMO, Math.max(MINIMO, gs.opacidad[i]!));
    col['opacity']![i] = Math.log(a / (1 - a));

    for (let k = 0; k < 3; k++) {
      col[`scale_${k}`]![i] = Math.log(Math.max(MINIMO, gs.escala[i * 3 + k]!));
      col[`f_dc_${k}`]![i] = gs.sh0[i * 3 + k]!;
    }

    // `(x,y,z,w)` → `(w,x,y,z)`. Es un reordenamiento, no un cambio de valor, y hacerlo
    // mal no revienta: coloca cada elipse girada.
    col['rot_0']![i] = gs.rotacion[i * 4 + 3]!;
    col['rot_1']![i] = gs.rotacion[i * 4]!;
    col['rot_2']![i] = gs.rotacion[i * 4 + 1]!;
    col['rot_3']![i] = gs.rotacion[i * 4 + 2]!;

    if (gs.regionId) col['region_id']![i] = gs.regionId[i]!;
    // ⚠️ La oclusión pasa TAL CUAL: es el factor que `aplicaOclusion` multiplica sobre el
    // color antes de partir por pieza. Sin esta línea la arcada sale plana.
    if (gs.ao) col['ao']![i] = gs.ao[i]!;
    if (gs.normales) {
      col['nx']![i] = gs.normales[i * 3]!;
      col['ny']![i] = gs.normales[i * 3 + 1]!;
      col['nz']![i] = gs.normales[i * 3 + 2]!;
    }
    // El PLY guarda el grado 1 por CANAL —los tres de rojo, los tres de verde, los tres de
    // azul— y la extensión por COEFICIENTE. No es recortar: es trasponer.
    for (let c = 0; c < gs.sh1.length; c++) {
      for (let ch = 0; ch < 3; ch++) {
        col[`f_rest_${ch * 3 + c}`]![i] = gs.sh1[c]![i * 3 + ch]!;
      }
    }
  }

  return {
    n,
    columnas: col,
    // El marco y el origen los declara el manifiesto, no la primitiva: aquí no se inventa
    // ninguno. `Splats` trata la ausencia de `origin` como desplazamiento cero, que es lo
    // correcto — la capa se entrenó en el marco canónico.
    comentarios: {
      generado: 'uos-viewer desde la primitiva KHR_gaussian_splatting de scene.glb',
      kernel: gs.kernel,
      colorSpace: gs.colorSpace,
    },
  };
}

/**
 * Las mismas columnas, serializadas como PLY INRIA para el rasterizador de splats.
 *
 * ⚠️ El orden de las propiedades **importa**: la biblioteca reconstruye cada registro
 * leyendo la cabecera, y el `f_rest_*` va entre el color y la opacidad como en el fichero
 * que escribe el emisor. Cambiarlo no rompería a nuestra biblioteca —lee la cabecera— pero
 * sí a cualquier lector que asuma el orden de facto de INRIA, y ese es justo el lector
 * para el que existe este formato.
 */
export function plyDesdeCampo(campo: CampoPly): Uint8Array {
  const n = campo.n;
  const orden = [
    'x', 'y', 'z',
    'nx', 'ny', 'nz',
    'f_dc_0', 'f_dc_1', 'f_dc_2',
    ...Object.keys(campo.columnas).filter((k) => k.startsWith('f_rest_'))
      .sort((a, b) => Number(a.slice(7)) - Number(b.slice(7))),
    'ao',
    'opacity', 'scale_0', 'scale_1', 'scale_2',
    'rot_0', 'rot_1', 'rot_2', 'rot_3',
  ].filter((k) => campo.columnas[k]);
  const conRegion = campo.columnas['region_id'] !== undefined;

  const cabecera =
    'ply\nformat binary_little_endian 1.0\n' +
    'comment reconstruido por uos-viewer desde la primitiva KHR_gaussian_splatting\n' +
    'comment scale en logaritmo y opacity en logit (convencion INRIA), NO como los\n' +
    'comment declara la extension: es lo que espera el rasterizador que los dibuja\n' +
    'comment rot es cuaternion (w,x,y,z)\n' +
    'comment unidades mm\n' +
    `element vertex ${n}\n` +
    orden.map((k) => `property float ${k}\n`).join('') +
    (conRegion ? 'property short region_id\n' : '') +
    'end_header\n';
  const cab = new TextEncoder().encode(cabecera);
  const paso = orden.length * 4 + (conRegion ? 2 : 0);
  const fuera = new Uint8Array(cab.length + n * paso);
  fuera.set(cab);
  const v = new DataView(fuera.buffer);
  let o = cab.length;
  for (let i = 0; i < n; i++) {
    for (const k of orden) {
      v.setFloat32(o, campo.columnas[k]![i]!, true);
      o += 4;
    }
    if (conRegion) {
      v.setInt16(o, campo.columnas['region_id']![i]!, true);
      o += 2;
    }
  }
  return fuera;
}
