/**
 * PLY binario little-endian → columnas por nombre.
 *
 * Es lo justo para leer un campo gaussiano y **nada más**: no hay soporte de PLY ASCII,
 * ni de listas, ni de big-endian. No es pereza — un lector que acepta de todo acaba
 * adivinando, y aquí lo que llega es un fichero que declara su perfil en la cabecera. Lo
 * que no encaje tiene que fallar diciendo qué no encajó, no abrirse a medias.
 *
 * ⚠️ **Las columnas de un `.ply` de este proyecto NO son las del 3DGS de facto**, aunque
 * compartan nombres. `density` es sigma normalizada y no opacidad, y las escalas van en
 * milímetros lineales y no en logaritmo. Por eso el contenedor trae un `.gs.json` al lado
 * que lo declara, y por eso este lector devuelve columnas crudas en vez de interpretarlas:
 * quién decide qué significa `density` es el sidecar, no el parser.
 */

/** Tipos de propiedad que este lector entiende, con su tamaño en bytes. */
const TIPOS: Record<string, { bytes: number; leer: (v: DataView, o: number) => number }> = {
  float: { bytes: 4, leer: (v, o) => v.getFloat32(o, true) },
  float32: { bytes: 4, leer: (v, o) => v.getFloat32(o, true) },
  double: { bytes: 8, leer: (v, o) => v.getFloat64(o, true) },
  float64: { bytes: 8, leer: (v, o) => v.getFloat64(o, true) },
  uchar: { bytes: 1, leer: (v, o) => v.getUint8(o) },
  uint8: { bytes: 1, leer: (v, o) => v.getUint8(o) },
  char: { bytes: 1, leer: (v, o) => v.getInt8(o) },
  int8: { bytes: 1, leer: (v, o) => v.getInt8(o) },
  short: { bytes: 2, leer: (v, o) => v.getInt16(o, true) },
  int16: { bytes: 2, leer: (v, o) => v.getInt16(o, true) },
  ushort: { bytes: 2, leer: (v, o) => v.getUint16(o, true) },
  uint16: { bytes: 2, leer: (v, o) => v.getUint16(o, true) },
  int: { bytes: 4, leer: (v, o) => v.getInt32(o, true) },
  int32: { bytes: 4, leer: (v, o) => v.getInt32(o, true) },
  uint: { bytes: 4, leer: (v, o) => v.getUint32(o, true) },
  uint32: { bytes: 4, leer: (v, o) => v.getUint32(o, true) },
};

export interface CampoPly {
  readonly n: number;
  /** Cada propiedad como `Float32Array`, en el orden en que venían. */
  readonly columnas: Readonly<Record<string, Float32Array>>;
  /** Las líneas `comment`, indexadas por su primera palabra. Ahí viaja `frame`, `origin`… */
  readonly comentarios: Readonly<Record<string, string>>;
}

const FIN = 'end_header';

export function leePly(bytes: Uint8Array): CampoPly {
  // La cabecera es ASCII y el cuerpo binario, así que se busca el final por bytes y no
  // decodificando el fichero entero: son cientos de megas.
  const texto = new TextDecoder('ascii').decode(bytes.subarray(0, Math.min(bytes.length, 65536)));
  const corte = texto.indexOf(FIN);
  if (corte < 0) {
    throw new Error('El PLY no tiene `end_header` en los primeros 64 kB: no es un PLY.');
  }
  const cabecera = texto.slice(0, corte).split('\n').map((l) => l.trim());
  const inicio = corte + FIN.length + (texto[corte + FIN.length] === '\r' ? 2 : 1);

  if (!cabecera.some((l) => l === 'format binary_little_endian 1.0')) {
    throw new Error(
      'Este lector sólo abre PLY binario little-endian. El fichero declara: ' +
        (cabecera.find((l) => l.startsWith('format')) ?? '(sin línea format)'),
    );
  }

  const comentarios: Record<string, string> = {};
  for (const l of cabecera) {
    if (!l.startsWith('comment ')) continue;
    const resto = l.slice(8).trim();
    const esp = resto.indexOf(' ');
    if (esp > 0) comentarios[resto.slice(0, esp)] = resto.slice(esp + 1);
  }

  const elemento = cabecera.find((l) => l.startsWith('element vertex '));
  if (!elemento) throw new Error('El PLY no declara `element vertex`.');
  const n = Number(elemento.split(/\s+/)[2]);

  const props: { nombre: string; bytes: number; leer: (v: DataView, o: number) => number }[] = [];
  let dentro = false;
  for (const l of cabecera) {
    if (l.startsWith('element ')) {
      dentro = l.startsWith('element vertex ');
      continue;
    }
    if (!dentro || !l.startsWith('property ')) continue;
    const [, tipo, nombre] = l.split(/\s+/);
    const t = TIPOS[tipo ?? ''];
    if (!t) {
      throw new Error(
        `El PLY trae una propiedad de tipo \`${tipo}\` (${nombre}) que este lector no ` +
          'sabe leer. Abrirlo saltándosela desplazaría todas las demás.',
      );
    }
    props.push({ nombre: nombre!, bytes: t.bytes, leer: t.leer });
  }

  const paso = props.reduce((s, p) => s + p.bytes, 0);
  const esperado = inicio + n * paso;
  if (bytes.length < esperado) {
    throw new Error(
      `El PLY declara ${n} vértices de ${paso} bytes (${esperado} en total) y el fichero ` +
        `trae ${bytes.length}: está truncado.`,
    );
  }

  const vista = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const columnas: Record<string, Float32Array> = {};
  for (const p of props) columnas[p.nombre] = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let o = inicio + i * paso;
    for (const p of props) {
      columnas[p.nombre]![i] = p.leer(vista, o);
      o += p.bytes;
    }
  }
  return { n, columnas, comentarios };
}
