import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BRILLO_GRIS, injertaGris, topeEscenas, UNIFORM_GRIS } from '../src/app/Gris';

/** Lo esencial del shader de vértices de la biblioteca con `enableOptionalEffects`. */
const SHADER = `
        uniform highp usampler2D sceneIndexesTexture;
            uniform float sceneOpacity[32];
            uniform int sceneVisibility[32];
        void main () {
            uint sceneIndex = uint(0);
            float splatOpacityFromScene = sceneOpacity[sceneIndex];
            vColor = uintToRGBAVec(sampledCenterColor.r);
                vColor.a *= splatOpacityFromScene;
            gl_Position = quadPos;
        }
`;

describe('injertaGris', () => {
  it('declara un float por escena y desatura después de la opacidad de escena', () => {
    const s = injertaGris(SHADER)!;
    expect(s).toContain(`uniform float ${UNIFORM_GRIS}[32];`);
    const opacidad = s.indexOf('vColor.a *= splatOpacityFromScene;');
    const gris = s.indexOf(`${UNIFORM_GRIS}[sceneIndex]`);
    expect(opacidad).toBeGreaterThan(0);
    expect(gris).toBeGreaterThan(opacidad);
    expect(s).toContain(BRILLO_GRIS.toFixed(3));
  });

  it('no injerta dos veces', () => {
    const una = injertaGris(SHADER)!;
    expect(injertaGris(una)).toBe(una);
  });

  it('sin las anclas devuelve null, para volver a apagar con la opacidad', () => {
    expect(injertaGris('void main () { vColor = vec4(1.0); }')).toBeNull();
    expect(injertaGris(SHADER.replace('vColor.a *= splatOpacityFromScene;', ''))).toBeNull();
  });

  it('lee el tope de escenas de la declaración', () => {
    expect(topeEscenas(SHADER)).toBe(32);
    expect(topeEscenas('nada')).toBeNull();
  });
});

/**
 * El fallo que este test guarda: actualizar la biblioteca y que su shader cambie de forma.
 * El injerto devolvería `null` y la selección volvería en silencio a apagar con la
 * opacidad, que no distingue la pieza. Se comprueba contra el bundle INSTALADO.
 */
describe('las anclas existen en la biblioteca instalada', () => {
  const require = createRequire(import.meta.url);
  const raiz = dirname(require.resolve('@mkkellogg/gaussian-splats-3d/package.json'));
  const fuente = readFileSync(join(raiz, 'build', 'gaussian-splats-3d.module.js'), 'utf8');

  it('declara la opacidad por escena y la aplica una sola vez al color', () => {
    expect(fuente).toContain('uniform float sceneOpacity[${Constants.MaxScenes}];');
    expect(fuente.split('vColor.a *= splatOpacityFromScene;').length).toBe(2);
  });

  it('el índice de escena se llama sceneIndex donde se aplica', () => {
    expect(fuente).toContain('float splatOpacityFromScene = sceneOpacity[sceneIndex];');
  });
});
