import { describe, expect, it } from 'vitest';
import { leePly } from '../src/uos/Ply';

/** Un PLY del perfil del proyecto, escrito a mano para no depender de un fichero real. */
function ply(n: number, comentarios: string[] = []): Uint8Array {
  const props: [string, string][] = [
    ['float', 'x'], ['float', 'y'], ['float', 'z'],
    ['float', 'density'], ['short', 'region_id'],
  ];
  const cabecera =
    ['ply', 'format binary_little_endian 1.0',
     ...comentarios.map((c) => `comment ${c}`),
     `element vertex ${n}`,
     ...props.map(([t, p]) => `property ${t} ${p}`),
     'end_header'].join('\n') + '\n';
  const paso = 4 * 4 + 2;
  const bytes = new Uint8Array(cabecera.length + n * paso);
  bytes.set(new TextEncoder().encode(cabecera));
  const v = new DataView(bytes.buffer, cabecera.length);
  for (let i = 0; i < n; i++) {
    const o = i * paso;
    v.setFloat32(o, i, true);
    v.setFloat32(o + 4, i * 2, true);
    v.setFloat32(o + 8, i * 3, true);
    v.setFloat32(o + 12, 0.5, true);
    v.setInt16(o + 16, 26, true);
  }
  return bytes;
}

describe('leePly', () => {
  it('lee columnas de tipos MEZCLADOS sin desplazarse', () => {
    // El campo real mezcla `float` con `short`: si el lector asumiera un tamaño único,
    // todas las columnas a partir de la primera corta saldrían corridas y la nube
    // aparecería deformada sin que nada protestara.
    const c = leePly(ply(5));
    expect(c.n).toBe(5);
    expect([...c.columnas['x']!]).toEqual([0, 1, 2, 3, 4]);
    expect([...c.columnas['z']!]).toEqual([0, 3, 6, 9, 12]);
    expect([...c.columnas['region_id']!]).toEqual([26, 26, 26, 26, 26]);
  });

  it('recoge los comment, que es donde viaja el marco', () => {
    // `origin` sale de ahí y sin él la nube aparece a ocho centímetros de la arcada.
    const c = leePly(ply(2, ['frame twin', 'origin 1.5 -2.0 3.25']));
    expect(c.comentarios['frame']).toBe('twin');
    expect(c.comentarios['origin']).toBe('1.5 -2.0 3.25');
  });

  it('un PLY truncado se declara, no se abre a medias', () => {
    const entero = ply(50);
    expect(() => leePly(entero.subarray(0, entero.length - 40))).toThrow(/truncado/);
  });

  it('un tipo de propiedad desconocido para el lector para la lectura', () => {
    // Saltárselo desplazaría todas las demás: es el fallo que no se ve.
    const malo = new TextEncoder().encode(
      'ply\nformat binary_little_endian 1.0\nelement vertex 1\nproperty rareza x\nend_header\n',
    );
    expect(() => leePly(malo)).toThrow(/rareza/);
  });

  it('el PLY de texto NO se abre', () => {
    const ascii = new TextEncoder().encode(
      'ply\nformat ascii 1.0\nelement vertex 1\nproperty float x\nend_header\n0.0\n',
    );
    expect(() => leePly(ascii)).toThrow(/binario little-endian/);
  });
});
