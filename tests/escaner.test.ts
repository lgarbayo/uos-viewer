import { Matrix4, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';

import {
  ESCALA_POR_ESPACIADO, MARFIL, OPACIDAD_ESCANER, RELIEVE, campoDelEscaner, cuentaConPieza,
  espaciadoMediano,
  indicesDelEscaner, motivoSinNormales, posicionesEnCanonico,
} from '../src/app/Escaner';
import type { CampoPly } from '../src/uos/Ply';

const C0 = 0.28209479177387814;
const C1 = 0.4886025119029199;

/** Un compuesto de juguete: dos gaussianas de CBCT y dos de escáner, como las escribe el emisor. */
function compuesto(): CampoPly {
  const f = (v: number[]) => Float32Array.from(v);
  return {
    n: 4,
    columnas: {
      x: f([9, 1, 9, 2]), y: f([9, 0, 9, 0]), z: f([9, 0, 9, 0]),
      scale_0: f([0.1, 0.066, 0.1, 0.066]), scale_1: f([0.1, 0.066, 0.1, 0.066]),
      scale_2: f([0.1, 0.066, 0.1, 0.066]),
      rot_0: f([1, 1, 1, 1]), rot_1: f([0, 0, 0, 0]), rot_2: f([0, 0, 0, 0]), rot_3: f([0, 0, 0, 0]),
      // El escáner NO mide atenuación: su densidad es 0.
      density: f([0.8, 0, 0.7, 0]),
      source_modality: f([0, 1, 0, 1]),
      region_id: f([0, 11, 0, 21]),
    },
    comentarios: {},
  };
}

describe('las gaussianas del escáner dentro del compuesto', () => {
  it('se eligen por source_modality = 1, no por la densidad', () => {
    expect(Array.from(indicesDelEscaner(compuesto()))).toEqual([1, 3]);
  });

  it('se colocan con la registración y llevan su FDI', () => {
    const c = compuesto();
    const m = new Matrix4().makeTranslation(10, 0, 0);
    const { campo: e } = campoDelEscaner(c, indicesDelEscaner(c), m, null);
    expect(Array.from(e.columnas['x']!)).toEqual([11, 12]);
    expect(Array.from(e.columnas['region_id']!)).toEqual([11, 21]);
  });

  it('se dibujan al menos del espaciado MEDIDO de la nube, y lo cuentan', () => {
    // Las dos del escáner están a 1 mm y declaran σ = 0,066: con eso no se tocan nunca.
    const c = compuesto();
    const r = campoDelEscaner(c, indicesDelEscaner(c), new Matrix4(), null);
    expect(r.espaciado).toBeCloseTo(1, 5);
    expect(r.sigmaMinima).toBeCloseTo(ESCALA_POR_ESPACIADO, 5);
    expect(r.infladas).toBe(2);
    expect(r.campo.columnas['scale_0']![0]).toBeCloseTo(Math.log(ESCALA_POR_ESPACIADO), 5);
  });

  it('una nube que ya se cubre conserva su escala declarada', () => {
    const c = compuesto();
    const s = c.columnas['scale_0']!; s[1] = 2; s[3] = 2;
    c.columnas['scale_1']!.set([0.1, 2, 0.1, 2]); c.columnas['scale_2']!.set([0.1, 2, 0.1, 2]);
    const r = campoDelEscaner(c, indicesDelEscaner(c), new Matrix4(), null);
    expect(r.infladas).toBe(0);
    expect(r.campo.columnas['scale_0']![0]).toBeCloseTo(Math.log(2), 5);
  });

  it('mide el espaciado como la mediana del vecino más cercano', () => {
    const pos = new Float32Array(30);
    for (let i = 0; i < 10; i++) pos[i * 3] = i * 0.13;
    expect(espaciadoMediano(pos)).toBeCloseTo(0.13, 5);
  });

  it('pinta marfil con opacidad de visualización y NO lee density como opacidad', () => {
    const c = compuesto();
    const { campo: e } = campoDelEscaner(c, indicesDelEscaner(c), new Matrix4(), null);
    const alfa = 1 / (1 + Math.exp(-e.columnas['opacity']![0]!));
    expect(alfa).toBeCloseTo(OPACIDAD_ESCANER, 5);
    expect(e.columnas['f_dc_0']![0]! * C0 + 0.5).toBeCloseTo(MARFIL[0], 5);
    expect(e.columnas['density']).toBeUndefined();
  });

  it('gira el cuaternión con la registración', () => {
    const c = compuesto();
    const giro = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2);
    const { campo: e } = campoDelEscaner(c, indicesDelEscaner(c),
      new Matrix4().makeRotationFromQuaternion(giro), null);
    expect(e.columnas['rot_0']![0]).toBeCloseTo(giro.w, 5);
    expect(e.columnas['rot_3']![0]).toBeCloseTo(giro.z, 5);
  });

  it('el relieve es k·(n·v) en el grado 1 y no satura: de frente, marfil exacto', () => {
    const c = compuesto();
    const n = Float32Array.from([0, 0, 1, 0, 0, 1]);
    const { campo: e } = campoDelEscaner(c, indicesDelEscaner(c), new Matrix4(), n);
    // Lo que evalúa el rasterizador, con la dirección cámara→gaussiana.
    const color = (x: number, y: number, z: number): number => C0 * e.columnas['f_dc_0']![0]! + 0.5
      + C1 * (-y * e.columnas['f_rest_0']![0]! + z * e.columnas['f_rest_1']![0]!
        - x * e.columnas['f_rest_2']![0]!);
    expect(color(0, 0, -1)).toBeCloseTo(MARFIL[0], 5);              // de frente
    expect(color(1, 0, 0)).toBeCloseTo(MARFIL[0] * (1 - RELIEVE), 5); // rasante
  });

  it('cuenta la numeración por modalidad: una que sólo numera el CBCT deja 0 en el escáner', () => {
    const c = compuesto();
    // Como el caso de agosto: el `derived_seg` del compuesto numera el CBCT y no el escáner.
    const region = Float32Array.from([31, 0, 41, 0]);
    expect(cuentaConPieza(region, indicesDelEscaner(c))).toBe(0);
    expect(cuentaConPieza(region)).toBe(2);
    expect(cuentaConPieza(c.columnas['region_id']!, indicesDelEscaner(c))).toBe(2);
  });

  it('las normales de la malla sólo valen si sus vértices son estas gaussianas', () => {
    const c = compuesto();
    const idx = indicesDelEscaner(c);
    const pos = posicionesEnCanonico(c, idx, new Matrix4());
    const n = new Float32Array(6);
    expect(motivoSinNormales(pos, Float32Array.from(pos), n)).toBeNull();
    expect(motivoSinNormales(pos, Float32Array.from([1, 0, 0, 2.1, 0, 0]), n)).toMatch(/no caen/);
    expect(motivoSinNormales(pos, Float32Array.from([1, 0, 0]), n)).toMatch(/uno a uno/);
    expect(motivoSinNormales(pos, pos, null)).toMatch(/no declara normales/);
  });
});
