import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';

import { colocaEnCanonico } from '../src/app/Marcos';
import type { Manifiesto, Registro } from '../src/uos/Manifest';

/** Una traslación pura, por filas, como la escribe el manifiesto. */
const traslada = (x: number, y: number, z: number): number[] =>
  [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1];

function manifiesto(registros: Partial<Registro>[]): Manifiesto {
  return {
    canonical_frame: { id: 'ios', description: '', units: 'mm', handedness: 'right' },
    registrations: registros.map((r, i) => ({
      id: `reg.${i}`, method: 'icp_surface', transform_4x4_row_major: traslada(0, 0, 0),
      source_frame: '', target_frame: '', ...r,
    })),
  } as unknown as Manifiesto;
}

const lleva = (m: Manifiesto, marco: string, p: [number, number, number]) => {
  const c = colocaEnCanonico(m, marco);
  return c ? new Vector3(...p).applyMatrix4(c.matriz).toArray() : null;
};

describe('colocar un marco en el canónico con las registraciones declaradas', () => {
  it('el canónico se queda donde está', () => {
    expect(lleva(manifiesto([]), 'ios', [1, 2, 3])).toEqual([1, 2, 3]);
  });

  it('aplica la matriz tal cual la escribe el manifiesto, POR FILAS', () => {
    const m = manifiesto([{ source_frame: 'ct', target_frame: 'ios',
      transform_4x4_row_major: traslada(10, 0, -5) }]);
    expect(lleva(m, 'ct', [1, 2, 3])).toEqual([11, 2, -2]);
  });

  it('compone una cadena y recorre al revés una registración invertida', () => {
    // ct.centrado → ct (+100 en x), y la de ct va DECLARADA de ios a ct (+7 en y): para
    // llegar al canónico hay que aplicarla invertida.
    const m = manifiesto([
      { source_frame: 'ct.c', target_frame: 'ct', transform_4x4_row_major: traslada(100, 0, 0) },
      { source_frame: 'ios', target_frame: 'ct', transform_4x4_row_major: traslada(0, 7, 0) },
    ]);
    expect(lleva(m, 'ct.c', [0, 0, 0])).toEqual([100, -7, 0]);
    expect(colocaEnCanonico(m, 'ct.c')!.pasos.map((p) => p.invertido)).toEqual([false, true]);
  });

  it('un marco sin camino al canónico NO se coloca: no se inventa un alineamiento', () => {
    const m = manifiesto([{ source_frame: 'a', target_frame: 'b' }]);
    expect(colocaEnCanonico(m, 'a')).toBeNull();
  });

  it('declara si la cadena es provisional o está sin verificar', () => {
    const sinFirmar = colocaEnCanonico(manifiesto([
      { source_frame: 'ct', target_frame: 'ios', method: 'auto_dl' }]), 'ct')!;
    expect(sinFirmar.provisional).toBe(true);
    expect(sinFirmar.sinVerificar).toBe(true);
    const firmada = colocaEnCanonico(manifiesto([
      { source_frame: 'ct', target_frame: 'ios', verified_by: 'dr' }]), 'ct')!;
    expect(firmada.provisional).toBe(false);
    expect(firmada.sinVerificar).toBe(false);
  });

  it('una matriz que no es 4×4 falla en vez de colocar mal', () => {
    const m = manifiesto([{ source_frame: 'ct', target_frame: 'ios',
      transform_4x4_row_major: [1, 0, 0] }]);
    expect(() => colocaEnCanonico(m, 'ct')).toThrow(/4×4/);
  });
});
