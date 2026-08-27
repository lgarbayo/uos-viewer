import { describe, expect, it } from 'vitest';
import { aplicaOclusion, leePly, partePorColumna } from '../src/uos/Ply';

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


/**
 * El troceado por columna: una escena por pieza.
 *
 * ⚠️ **Existe porque el rasterizador de splats sólo apaga POR ESCENA.** Con la capa de
 * apariencia cargada de una pieza, seleccionar un diente no encendía ni apagaba nada — no
 * había forma de comprobar si la segmentación acierta. Partiendo el PLY por `region_id`,
 * aislar una pieza es mover un uniform.
 *
 * Lo que estos tests guardan es que el corte sea **de filas crudas**: reconstruir las filas
 * desde columnas `Float32Array` sería más corto y perdería `region_id` (que es `short`), y
 * cambiaría bytes que el `sha256` del manifiesto ya certificó.
 */
describe('partir un PLY por una columna', () => {
  /** Un PLY con `n` filas, x = índice, region_id ciclando 0,11,12. */
  function ply(n: number): Uint8Array {
    const cab =
      'ply\nformat binary_little_endian 1.0\ncomment unidades mm\n' +
      `element vertex ${n}\nproperty float x\nproperty float opacity\n` +
      'property short region_id\nend_header\n';
    const cabBytes = new TextEncoder().encode(cab);
    const paso = 4 + 4 + 2;
    const out = new Uint8Array(cabBytes.length + n * paso);
    out.set(cabBytes, 0);
    const dv = new DataView(out.buffer, cabBytes.length);
    for (let i = 0; i < n; i++) {
      dv.setFloat32(i * paso, i, true);
      dv.setFloat32(i * paso + 4, 0.5, true);
      dv.setInt16(i * paso + 8, [0, 11, 12][i % 3]!, true);
    }
    return out;
  }

  it('cada trozo lleva sólo sus filas y las declara en la cabecera', () => {
    const trozos = partePorColumna(ply(30), 'region_id');
    expect([...trozos.keys()].sort((a, b) => a - b)).toEqual([0, 11, 12]);
    for (const [codigo, bytes] of trozos) {
      const c = leePly(bytes);
      expect(c.n, `el trozo ${codigo} declara mal su recuento`).toBe(10);
      expect([...c.columnas['region_id']!]).toEqual(Array(10).fill(codigo));
    }
  });

  it('conserva el orden original dentro de cada trozo, y no pierde ninguna fila', () => {
    const trozos = partePorColumna(ply(30), 'region_id');
    const todas = [...trozos.values()].flatMap((b) => [...leePly(b).columnas['x']!]);
    expect(todas.sort((a, b) => a - b)).toEqual([...Array(30).keys()]);
    // El 11 le toca a los índices 1, 4, 7… y tienen que salir en ese orden.
    expect([...leePly(trozos.get(11)!).columnas['x']!]).toEqual(
      [...Array(10).keys()].map((k) => k * 3 + 1),
    );
  });

  it('los comentarios de la cabecera viajan con cada trozo', () => {
    // Un trozo suelto tiene que seguir declarando sus unidades y su perfil: si no, deja de
    // poder leerse como lo que es en cuanto sale del visor.
    for (const bytes of partePorColumna(ply(9), 'region_id').values()) {
      expect(leePly(bytes).comentarios['unidades']).toBe('mm');
    }
  });

  it('sin la columna, falla diciendo cuál falta', () => {
    expect(() => partePorColumna(ply(9), 'no_existe')).toThrow(/no_existe/);
  });
});

describe('la oclusión ambiental', () => {
  const C0 = 0.28209479177387814;

  /** Un PLY con las columnas que importan: color, relieve y `ao` entre medias. */
  function plyConAo(aos: number[]): Uint8Array {
    const props = [
      'f_dc_0', 'f_dc_1', 'f_dc_2',
      'f_rest_0', 'ao', 'opacity',
    ];
    const cab =
      ['ply', 'format binary_little_endian 1.0',
       `element vertex ${aos.length}`,
       ...props.map((p) => `property float ${p}`),
       'end_header'].join('\n') + '\n';
    const bytes = new Uint8Array(cab.length + aos.length * props.length * 4);
    bytes.set(new TextEncoder().encode(cab));
    const v = new DataView(bytes.buffer, cab.length);
    aos.forEach((ao, i) => {
      const o = i * props.length * 4;
      v.setFloat32(o + 0, 1.0, true);       // f_dc_0
      v.setFloat32(o + 4, 2.0, true);       // f_dc_1
      v.setFloat32(o + 8, -1.0, true);      // f_dc_2
      v.setFloat32(o + 12, 0.5, true);      // f_rest_0
      v.setFloat32(o + 16, ao, true);       // ao
      v.setFloat32(o + 20, 3.0, true);      // opacity
    });
    return bytes;
  }

  function lee(bytes: Uint8Array) {
    const campo = leePly(bytes);
    return campo;
  }

  it('oscurece el COLOR, no el coeficiente, y respeta el 0,5 del grado 0', () => {
    // ⚠️ `color = f_dc·C0 + 0,5`. Multiplicar el coeficiente por el factor NO multiplica el
    // color: hay que recolocar ese 0,5, o el resultado se va tanto más cuanto más oscuro
    // sea el punto — justo donde la oclusión actúa.
    const salida = aplicaOclusion(plyConAo([0.5]));
    const c = lee(salida);
    const antes = 1.0 * C0 + 0.5;
    const ahora = c.columnas['f_dc_0']![0]! * C0 + 0.5;
    expect(ahora).toBeCloseTo(0.5 * antes, 6);
  });

  it('escala el relieve igual que el color, porque es proporcional al albedo', () => {
    const c = lee(aplicaOclusion(plyConAo([0.5])));
    expect(c.columnas['f_rest_0']![0]!).toBeCloseTo(0.25, 6);
  });

  it('quita la columna `ao` para que el rasterizador vea el perfil que espera', () => {
    // Una propiedad de más le corre el resto del registro y la escena sale como basura.
    const c = lee(aplicaOclusion(plyConAo([0.5, 1.0])));
    expect(Object.keys(c.columnas)).not.toContain('ao');
    expect(Object.keys(c.columnas)).toContain('opacity');
    expect(c.n).toBe(2);
  });

  it('no toca nada donde no hay oclusión', () => {
    const c = lee(aplicaOclusion(plyConAo([1.0])));
    expect(c.columnas['f_dc_1']![0]!).toBeCloseTo(2.0, 6);
    expect(c.columnas['opacity']![0]!).toBeCloseTo(3.0, 6);
  });

  it('un PLY sin `ao` sale intacto', () => {
    // Un contenedor sin malla no pudo calcularla, y no oscurecer es lo correcto.
    const sin = ply(4);
    expect(aplicaOclusion(sin)).toBe(sin);
  });
});
