import { describe, expect, it } from 'vitest';
import { mideCortes, mideEspaciado } from '../src/app/Espaciado';

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

describe('mideCortes', () => {
  /** Columnas x, y, z de una rejilla 4 × 4 en el corte, en los `zs` dados. */
  function cortes(zs: readonly number[], d = 0.3) {
    const x: number[] = [], y: number[] = [], z: number[] = [];
    for (const zz of zs) for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
      x.push(i * d); y.push(j * d); z.push(zz);
    }
    return [Float32Array.from(x), Float32Array.from(y), Float32Array.from(z), x.length] as const;
  }

  it('una serie completa y regular no está incompleta', () => {
    const c = mideCortes(...cortes([0, 0.6, 1.2, 1.8, 2.4]))!;
    expect(c.eje).toBe(2);
    expect(c.n).toBe(5);
    expect(c.paso).toBeCloseTo(0.6, 6);
    expect(c.hueco).toBeCloseTo(0.6, 6);
    expect(c.esperados).toBe(5);
    expect(c.incompleto).toBe(false);
  });

  it('con cortes que faltan dice cuántos hay, cuántos habría y el mayor hueco', () => {
    // Como el CBCT del caso A de noviembre: paso de 0,3 mm y huecos sueltos de varios mm.
    const c = mideCortes(...cortes([0, 0.3, 0.6, 0.9, 1.2, 3.0, 3.3, 3.6, 9.9]))!;
    expect(c.eje).toBe(2);
    expect(c.n).toBe(9);
    expect(c.paso).toBeCloseTo(0.3, 6);
    expect(c.hueco).toBeCloseTo(6.3, 6);
    expect(c.esperados).toBe(34);
    expect(c.incompleto).toBe(true);
  });

  it('una nube que no está en rejilla no tiene cortes', () => {
    const n = 6000;
    const x = Float32Array.from({ length: n }, (_, i) => Math.sin(i * 12.9898) * 40);
    const y = Float32Array.from({ length: n }, (_, i) => Math.sin(i * 78.233) * 40);
    const z = Float32Array.from({ length: n }, (_, i) => Math.sin(i * 37.719) * 40);
    expect(mideCortes(x, y, z, n)).toBeNull();
  });
});
