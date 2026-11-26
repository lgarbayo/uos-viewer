/**
 * Pasa a gris lo que no es la pieza seleccionada, dentro del shader del rasterizador.
 *
 * ⚠️ **Por qué gris y no sólo más transparente, medido sobre el caso de noviembre.** Antes
 * el resto se apagaba bajando la opacidad de su escena a 0,18. Pero la opacidad de escena
 * multiplica el alfa de CADA gaussiana, y una corona son miles de ellas superpuestas: la
 * transmitancia de N capas con alfa 0,18·a sigue cayendo a casi cero. Resultado: las
 * vecinas se veían prácticamente igual que la pieza pulsada, sólo algo borrosas, y no se
 * distinguía cuál estaba seleccionada. El color sí lo cambia todo: la pieza pulsada
 * conserva su apariencia y las demás salen grises y más oscuras.
 *
 * Sigue siendo **apagar el resto y no rodear la pieza con un borde**: el contorno de un
 * diente cae en el margen gingival, que es la frontera clínica que interesa mirar.
 *
 * La biblioteca sólo expone visibilidad y opacidad por escena, así que el desaturado se
 * injerta en su shader de vértices. Va en un módulo sin `three` para poder probar el
 * injerto contra el fuente real de la biblioteca (ver `tests/gris.test.ts`).
 */

/**
 * Brillo del gris respecto a la luminancia original, por defecto. El que se usa lo pone
 * cada tema (`TEMA_3D.brilloGris` en `Visor.ts`) a través del uniform `UNIFORM_BRILLO`.
 */
export const BRILLO_GRIS = 0.55;

/** Nombre del uniform con el brillo del gris: uno para todas las escenas. */
export const UNIFORM_BRILLO = 'grisBrillo';

/** La declaración de la que se cuelga el uniform nuevo, con el tope de escenas. */
const ANCLA_UNIFORM = /uniform float sceneOpacity\[(\d+)\];/;

/**
 * La línea tras la que se desatura: cuando ya está sumado el color de los armónicos
 * (`vColor.rgb`) y la opacidad de la escena. Sólo existe con `enableOptionalEffects`.
 */
const ANCLA_COLOR = 'vColor.a *= splatOpacityFromScene;';

/** Nombre del uniform: un float por escena, 0 = su color, 1 = gris. */
export const UNIFORM_GRIS = 'sceneGris';

/**
 * El shader de vértices con el desaturado por escena, o `null` si no se reconocen las
 * anclas — una versión de la biblioteca que cambió su shader. Entonces el llamante vuelve a
 * apagar con la opacidad, que es peor pero no rompe nada.
 */
export function injertaGris(shader: string): string | null {
  const m = ANCLA_UNIFORM.exec(shader);
  if (!m || shader.split(ANCLA_COLOR).length !== 2) return null;
  if (shader.includes(UNIFORM_GRIS)) return shader;
  return shader
    .replace(ANCLA_UNIFORM, `${m[0]}\n            uniform float ${UNIFORM_GRIS}[${m[1]}];` +
      `\n            uniform float ${UNIFORM_BRILLO};`)
    .replace(
      ANCLA_COLOR,
      `${ANCLA_COLOR}
                float grisDeEscena = ${UNIFORM_GRIS}[sceneIndex];
                if (grisDeEscena > 0.0) {
                    float luz = dot(vColor.rgb, vec3(0.2126, 0.7152, 0.0722));
                    vColor.rgb = mix(vColor.rgb, vec3(luz * ${UNIFORM_BRILLO}), grisDeEscena);
                }`,
    );
}

/** Cuántas escenas admite el shader, leído de su declaración. `null` si no se reconoce. */
export function topeEscenas(shader: string): number | null {
  const m = ANCLA_UNIFORM.exec(shader);
  return m ? Number(m[1]) : null;
}
