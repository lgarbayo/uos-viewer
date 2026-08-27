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


/**
 * Parte un PLY binario en varios, agrupando las filas por el valor de una columna.
 *
 * ⚠️ **Existe para poder ENCENDER UNA PIEZA en el rasterizador de splats.** El visor de
 * splats compone por profundidad todas las gaussianas juntas y sólo expone visibilidad y
 * opacidad **por escena** (`sceneVisibility`/`sceneOpacity`): no hay forma de decirle
 * «apaga estas ochenta mil gaussianas y deja esas cuatro mil». Cargando una escena por
 * código FDI, aislar una pieza pasa a ser mover un uniform — que es exactamente cómo el
 * otro visor del proyecto hace conmutables sus capas.
 *
 * Se cortan **filas crudas**, sin decodificar ni volver a escribir un solo valor: el
 * cuerpo es de paso fijo, así que un trozo es una copia de bytes y la cabecera se reescribe
 * cambiando el recuento. Reconstruir las filas desde columnas `Float32Array` sería más
 * corto de escribir y perdería precisión en todo lo que no sea `float` — `region_id` es un
 * `short` — y además cambiaría bytes que el `sha256` del manifiesto ya certificó.
 *
 * El orden de los grupos es el de aparición del primer valor, y dentro de cada grupo se
 * conserva el orden original.
 */
export function partePorColumna(
  bytes: Uint8Array,
  columna: string,
): Map<number, Uint8Array> {
  const texto = new TextDecoder('ascii').decode(bytes.subarray(0, Math.min(bytes.length, 65536)));
  const corte = texto.indexOf(FIN);
  if (corte < 0) throw new Error('El PLY no tiene `end_header`: no es un PLY.');
  const cabecera = texto.slice(0, corte).split('\n').map((l) => l.trim());
  const inicio = corte + FIN.length + (texto[corte + FIN.length] === '\r' ? 2 : 1);

  const elemento = cabecera.find((l) => l.startsWith('element vertex '));
  if (!elemento) throw new Error('El PLY no declara `element vertex`.');
  const n = Number(elemento.split(/\s+/)[2]);

  let paso = 0;
  let desplazamiento = -1;
  let leer: ((v: DataView, o: number) => number) | null = null;
  let dentro = false;
  for (const l of cabecera) {
    if (l.startsWith('element ')) {
      dentro = l.startsWith('element vertex ');
      continue;
    }
    if (!dentro || !l.startsWith('property ')) continue;
    const [, tipo, nombre] = l.split(/\s+/);
    const t = TIPOS[tipo ?? ''];
    if (!t) throw new Error(`El PLY trae una propiedad de tipo \`${tipo}\` desconocida.`);
    if (nombre === columna) {
      desplazamiento = paso;
      leer = t.leer;
    }
    paso += t.bytes;
  }
  if (desplazamiento < 0 || !leer) {
    throw new Error(`El PLY no trae la columna \`${columna}\`: no se puede partir por ella.`);
  }
  if (bytes.length < inicio + n * paso) {
    throw new Error(`El PLY declara ${n} vértices de ${paso} bytes y está truncado.`);
  }

  const vista = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const grupos = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const v = leer(vista, inicio + i * paso + desplazamiento);
    let filas = grupos.get(v);
    if (!filas) {
      filas = [];
      grupos.set(v, filas);
    }
    filas.push(i);
  }

  // La cabecera se reescribe con el recuento del grupo y **nada más**: los `comment` que
  // declaran unidades, perfil y procedencia siguen viajando con cada trozo, que es lo que
  // permite que un trozo suelto se siga leyendo como lo que es.
  const cabeceraCruda = texto.slice(0, inicio);
  const fuera = new Map<number, Uint8Array>();
  for (const [valor, filas] of grupos) {
    const cab = new TextEncoder().encode(
      cabeceraCruda.replace(/element vertex \d+/, `element vertex ${filas.length}`),
    );
    const trozo = new Uint8Array(cab.length + filas.length * paso);
    trozo.set(cab, 0);
    let o = cab.length;
    for (const i of filas) {
      trozo.set(bytes.subarray(inicio + i * paso, inicio + (i + 1) * paso), o);
      o += paso;
    }
    fuera.set(valor, trozo);
  }
  return fuera;
}

/** Coeficiente del armónico de grado 0: `color = f_dc · C0 + 0,5`. */
const C0 = 0.28209479177387814;

/**
 * Aplica la oclusión ambiental al color y **quita la columna `ao`** del PLY.
 *
 * ⚠️ **La oclusión viaja aparte del color a propósito, y aquí es donde se juntan.** Un
 * surco está oscuro se mire desde donde se mire, así que no cabe en los armónicos —dentro
 * de ellos sólo podría ir en el grado 0, que *es* el albedo—. Meterla ahí ensuciaría el
 * tono que el contenedor declara en `clinical/observations.json`, y una lectura de color
 * no debe oscurecerse porque la pieza tenga una fisura pegada.
 *
 * Así que el emisor la calcula, la declara como columna propia y **quien dibuja la
 * multiplica**: eso es esta función. El fichero conserva el color medido; la pantalla ve
 * las hendiduras.
 *
 * Se quita la columna después de aplicarla porque el rasterizador espera el perfil INRIA
 * y una propiedad de más le corre el resto del registro. El PLY que sale es exactamente
 * lo que esa biblioteca sabe leer.
 *
 * Si el fichero no trae `ao` se devuelve tal cual: un contenedor sin malla no pudo
 * calcularla, y no oscurecer es la respuesta correcta.
 */
export function aplicaOclusion(bytes: Uint8Array): Uint8Array {
  const texto = new TextDecoder('ascii').decode(bytes.subarray(0, Math.min(bytes.length, 65536)));
  const corte = texto.indexOf(FIN);
  if (corte < 0) throw new Error('El PLY no tiene `end_header`: no es un PLY.');
  const cabecera = texto.slice(0, corte).split('\n').map((l) => l.trim());
  const inicio = corte + FIN.length + (texto[corte + FIN.length] === '\r' ? 2 : 1);

  const elemento = cabecera.find((l) => l.startsWith('element vertex '));
  if (!elemento) throw new Error('El PLY no declara `element vertex`.');
  const n = Number(elemento.split(/\s+/)[2]);

  const campos: { nombre: string; desde: number; bytes: number }[] = [];
  let paso = 0;
  let dentro = false;
  for (const l of cabecera) {
    if (l.startsWith('element ')) {
      dentro = l.startsWith('element vertex ');
      continue;
    }
    if (!dentro || !l.startsWith('property ')) continue;
    const [, tipo, nombre] = l.split(/\s+/);
    const t = TIPOS[tipo ?? ''];
    if (!t) throw new Error(`El PLY trae una propiedad de tipo \`${tipo}\` desconocida.`);
    campos.push({ nombre: nombre ?? '', desde: paso, bytes: t.bytes });
    paso += t.bytes;
  }

  const ao = campos.find((c) => c.nombre === 'ao');
  if (!ao) return bytes;
  if (bytes.length < inicio + n * paso) {
    throw new Error(`El PLY declara ${n} vértices de ${paso} bytes y está truncado.`);
  }

  const escalables = campos.filter(
    (c) => c.nombre.startsWith('f_dc_') || c.nombre.startsWith('f_rest_'),
  );
  const nuevoPaso = paso - ao.bytes;
  const cabNueva = new TextEncoder().encode(
    texto
      .slice(0, inicio)
      .split('\n')
      .filter((l) => l.trim() !== 'property float ao')
      .join('\n'),
  );

  const origen = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const salida = new Uint8Array(cabNueva.length + n * nuevoPaso);
  salida.set(cabNueva, 0);
  const destino = new DataView(salida.buffer, salida.byteOffset, salida.byteLength);

  for (let i = 0; i < n; i++) {
    const desde = inicio + i * paso;
    const hasta = cabNueva.length + i * nuevoPaso;
    // Copiar el registro entero saltándose los cuatro bytes de `ao`.
    salida.set(bytes.subarray(desde, desde + ao.desde), hasta);
    salida.set(
      bytes.subarray(desde + ao.desde + ao.bytes, desde + paso),
      hasta + ao.desde,
    );
    const factor = origen.getFloat32(desde + ao.desde, true);
    if (factor >= 1) continue;
    for (const c of escalables) {
      const o = hasta + (c.desde < ao.desde ? c.desde : c.desde - ao.bytes);
      const v = origen.getFloat32(desde + c.desde, true);
      // El color es `f_dc·C0 + 0,5`, así que multiplicarlo por `factor` no es multiplicar
      // el coeficiente: hay que recolocar el 0,5. El relieve del grado 1 sí es proporcional
      // al albedo, y se escala directo.
      destino.setFloat32(
        o,
        c.nombre.startsWith('f_dc_') ? factor * v + ((factor - 1) * 0.5) / C0 : factor * v,
        true,
      );
    }
  }
  return salida;
}
