import { describe, expect, it } from 'vitest';
import { mideEspaciado } from '../src/app/Espaciado';

/** Una rejilla nx × ny × nz con paso (dx, dy, dz), como un CBCT. */
function rejilla(nx: number, ny: number, nz: number, dx: number, dy: number, dz: number) {
  const pos = new Float32Array(nx * ny * nz * 3);
  let k = 0;
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        pos[k++] = x * dx;
        pos[k++] = y * dy;
        pos[k++] = z * dz;
      }
    }
  }
  return { pos, n: nx * ny * nz };
}

describe('mideEspaciado', () => {
  it('en un CBCT de cortes gruesos cubre el eje entre cortes, no el vecino más próximo', () => {
    // La rejilla del caso de agosto: 0,3 × 0,3 mm en el corte y 0,6 mm entre cortes.
    const { pos, n } = rejilla(30, 30, 15, 0.3, 0.3, 0.6);
    const e = mideEspaciado(pos, n);
    expect(e.vecino).toBeCloseTo(0.3, 3);
    expect(e.porEje[0]).toBeCloseTo(0.3, 3);
    expect(e.porEje[1]).toBeCloseTo(0.3, 3);
    expect(e.porEje[2]).toBeCloseTo(0.6, 3);
    expect(e.cobertura).toBeCloseTo(0.6, 3);
  });

  it('en una rejilla isótropa la cobertura es el vecino más próximo', () => {
    const { pos, n } = rejilla(20, 20, 20, 0.3, 0.3, 0.3);
    const e = mideEspaciado(pos, n);
    expect(e.cobertura).toBeCloseTo(e.vecino, 6);
  });

  it('un eje sin vecinos (una lámina) no cuenta, en vez de inflar la cobertura', () => {
    const { pos, n } = rejilla(40, 40, 1, 0.3, 0.3, 1);
    const e = mideEspaciado(pos, n);
    expect(e.porEje[2]).toBeNull();
    expect(e.cobertura).toBeCloseTo(0.3, 3);
  });

  it('con menos de dos puntos no hay espaciado', () => {
    expect(mideEspaciado(new Float32Array([1, 2, 3]), 1).cobertura).toBe(0);
  });
});
