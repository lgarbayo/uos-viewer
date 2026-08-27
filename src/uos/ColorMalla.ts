/**
 * El color de cada vértice a partir del campo de gaussianas. Aritmética pura.
 *
 * ⚠️ **Vive aparte del Worker para poder PROBARLO.** El cálculo es la reversibilidad del
 * proyecto —de aquí sale el STL mejorado— y un `postMessage` no se puede comparar contra la
 * salida de referencia del emisor. Separado, el test abre el `.uos` de verdad, calcula, y
 * compara vértice a vértice con el PLY que produjo el pipeline en Python.
 */

/** Coeficiente del armónico de grado 0: `color = f_dc · C0 + 0,5`. */
const C0 = 0.28209479177387814;
/** Cuántas gaussianas vecinas entran en la mezcla. Mismo valor que el emisor. */
const VECINOS_COLOR = 32;
/**
 * El alcance de una gaussiana, en sigmas de ELLA MISMA.
 *
 * ⚠️ No es un radio en milímetros. Lo fue —un valor a ojo de 1 mm— y dejaba manchas grises
 * en mitad de coronas medidas: aquellos vértices tenían gaussianas a 1,08 mm, o sea a 1,81
 * sigmas de la suya, y estaban perfectamente cubiertos. La pregunta que hace el
 * rasterizador es si el punto cae dentro del soporte de alguna gaussiana, y el soporte se
 * mide en sigmas.
 */
const ALCANCE_SIGMAS = 3.0;
/** El gris de «aquí no llegó el campo». No es un color de nadie, y por eso es neutro. */
const NEUTRO: readonly [number, number, number] = [160, 160, 160];
/** Cuántos saltos por aristas se admite para rellenar un hueco suelto. */
const SALTOS_RELLENO = 3;

export interface Peticion {
  readonly posiciones: Float32Array;
  /** Índices concatenados de todas las primitivas, de tres en tres. */
  readonly indices: Uint32Array;
  /** El FDI de cada vértice, 0 donde no consta. */
  readonly fdiVertice: Int16Array;
  /** Centros de las gaussianas, `xyz` seguidos. */
  readonly centros: Float32Array;
  /** `f_dc_0..2` por gaussiana. */
  readonly fdc: Float32Array;
  /** Opacidad ya en lineal (el logit deshecho por quien lee el sidecar). */
  readonly opacidad: Float32Array;
  /** Sigma media por gaussiana, en mm (el logaritmo ya deshecho). */
  readonly sigma: Float32Array;
  /** Los códigos FDI que el contenedor declara CON color medido. Ver `apagaSinDeclarar`. */
  readonly conColor: readonly number[];
}

export interface Respuesta {
  readonly rgb: Uint8Array;
  readonly medido: Uint8Array;
  readonly medidos: number;
  readonly rellenados: number;
}

/**
 * Rejilla uniforme sobre los centros. Sustituye al `cKDTree` de `scipy`.
 *
 * ⚠️ **La celda mide lo mismo que el alcance máximo, y eso es lo que hace correcta la
 * búsqueda en 27 celdas.** Con celdas más pequeñas habría que mirar más vecindario; con
 * celdas más grandes, cada consulta arrastraría gaussianas que ya se sabe que no llegan.
 */
function rejilla(centros: Float32Array, paso: number) {
  const n = centros.length / 3;
  let x0 = Infinity, y0 = Infinity, z0 = Infinity;
  let x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = centros[i * 3]!, y = centros[i * 3 + 1]!, z = centros[i * 3 + 2]!;
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
    if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  const nx = Math.max(1, Math.ceil((x1 - x0) / paso) + 1);
  const ny = Math.max(1, Math.ceil((y1 - y0) / paso) + 1);
  const nz = Math.max(1, Math.ceil((z1 - z0) / paso) + 1);
  const celda = (x: number, y: number, z: number) =>
    (Math.min(nz - 1, Math.max(0, ((z - z0) / paso) | 0)) * ny +
      Math.min(ny - 1, Math.max(0, ((y - y0) / paso) | 0))) * nx +
    Math.min(nx - 1, Math.max(0, ((x - x0) / paso) | 0));

  // Conteo y prefijo: dos pasadas y un solo array, en vez de un array por celda.
  const cuentas = new Uint32Array(nx * ny * nz + 1);
  for (let i = 0; i < n; i++) {
    cuentas[celda(centros[i * 3]!, centros[i * 3 + 1]!, centros[i * 3 + 2]!) + 1]!++;
  }
  for (let c = 0; c < cuentas.length - 1; c++) cuentas[c + 1]! += cuentas[c]!;
  const orden = new Uint32Array(n);
  const cursor = cuentas.slice();
  for (let i = 0; i < n; i++) {
    orden[cursor[celda(centros[i * 3]!, centros[i * 3 + 1]!, centros[i * 3 + 2]!)]!++] = i;
  }
  return { x0, y0, z0, nx, ny, nz, paso, cuentas, orden };
}

/**
 * `(rgb, medido)` por vértice, mezclando como mezcla el rasterizador.
 *
 * Media ponderada por `opacidad × caída gaussiana` sobre los `VECINOS_COLOR` vecinos más
 * próximos dentro del alcance: el color que se VE en ese punto, no el del centro más
 * cercano.
 *
 * ⚠️ **La oclusión ambiental NO se aplica.** El PLY la trae como columna `ao` y es un
 * factor de visualización; meterla aquí oscurecería una corona porque tenga una fisura al
 * lado, dentro de un fichero que alguien puede imprimir o medir encima.
 */
export function colorDesdeGaussianas(p: Peticion, avisa: (frac: number) => void) {
  const nv = p.posiciones.length / 3;
  const ng = p.sigma.length;

  // El tope de búsqueda: el alcance de las gaussianas más grandes. Igual que el emisor,
  // que usa el percentil 99 para no dejar que una sola gaussiana enorme infle la rejilla.
  // ⚠️ **El percentil se calcula como lo calcula `numpy`, interpolando.** Tomar el índice
  // truncado —`orden[floor(n·0,99)]`— da un tope de búsqueda ligeramente distinto, y ese
  // tope decide qué gaussianas entran en la mezcla de los vértices del margen. No es
  // pedantería: dos implementaciones del mismo cálculo que discrepan en el borde producen
  // dos ficheros distintos para el mismo caso, y el fichero es lo que alguien se lleva.
  const orden = Float32Array.from(p.sigma).sort();
  const pos99 = (ng - 1) * 0.99;
  const bajo = Math.floor(pos99);
  const alto = Math.min(ng - 1, bajo + 1);
  const p99 = orden[bajo]! + (orden[alto]! - orden[bajo]!) * (pos99 - bajo);
  const tope = ALCANCE_SIGMAS * p99;
  const g = rejilla(p.centros, Math.max(tope, 1e-3));

  const rgb = new Uint8Array(nv * 3);
  const medido = new Uint8Array(nv);
  // Los `VECINOS_COLOR` mejores de este vértice, como dos arrays paralelos ordenados por
  // distancia. Se reservan una vez y se reutilizan: 112.067 asignaciones serían basura.
  const dMejor = new Float64Array(VECINOS_COLOR);
  const iMejor = new Int32Array(VECINOS_COLOR);
  const tope2 = tope * tope;

  for (let v = 0; v < nv; v++) {
    if ((v & 8191) === 0) avisa(v / nv);
    const px = p.posiciones[v * 3]!, py = p.posiciones[v * 3 + 1]!, pz = p.posiciones[v * 3 + 2]!;
    let k = 0; // cuántos vecinos hay en la lista
    const cx = Math.min(g.nx - 1, Math.max(0, ((px - g.x0) / g.paso) | 0));
    const cy = Math.min(g.ny - 1, Math.max(0, ((py - g.y0) / g.paso) | 0));
    const cz = Math.min(g.nz - 1, Math.max(0, ((pz - g.z0) / g.paso) | 0));
    for (let dz = -1; dz <= 1; dz++) {
      const z = cz + dz; if (z < 0 || z >= g.nz) continue;
      for (let dy = -1; dy <= 1; dy++) {
        const y = cy + dy; if (y < 0 || y >= g.ny) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const x = cx + dx; if (x < 0 || x >= g.nx) continue;
          const c = (z * g.ny + y) * g.nx + x;
          for (let s = g.cuentas[c]!; s < g.cuentas[c + 1]!; s++) {
            const i = g.orden[s]!;
            const ex = p.centros[i * 3]! - px;
            const ey = p.centros[i * 3 + 1]! - py;
            const ez = p.centros[i * 3 + 2]! - pz;
            const d2 = ex * ex + ey * ey + ez * ez;
            if (d2 > tope2) continue;
            // Inserción ordenada en una lista de 32: más barato que ordenar al final,
            // porque la inmensa mayoría de candidatos se descarta en la primera prueba.
            if (k === VECINOS_COLOR && d2 >= dMejor[k - 1]!) continue;
            let j = Math.min(k, VECINOS_COLOR - 1);
            while (j > 0 && dMejor[j - 1]! > d2) {
              dMejor[j] = dMejor[j - 1]!; iMejor[j] = iMejor[j - 1]!; j--;
            }
            dMejor[j] = d2; iMejor[j] = i;
            if (k < VECINOS_COLOR) k++;
          }
        }
      }
    }
    if (k === 0) {
      rgb[v * 3] = NEUTRO[0]; rgb[v * 3 + 1] = NEUTRO[1]; rgb[v * 3 + 2] = NEUTRO[2];
      continue;
    }
    let total = 0, r = 0, vd = 0, b = 0;
    // ⚠️ **La cobertura la decide el CONJUNTO, no la vecina más próxima.** Preguntar sólo
    // por la más cercana falla en los dos extremos: en una cara lisa esa vecina está a 1,8
    // sigmas y el punto sí está cubierto —eran las manchas grises sobre los incisivos—, y
    // en un surco la más cercana es diminuta y su soporte no llega, aunque haya treinta
    // gaussianas encima. Medido por el emisor, ese segundo caso bajaba la cobertura del
    // 97,6 % al 96,6 %.
    let cubierto = false;
    for (let j = 0; j < k; j++) {
      const i = iMejor[j]!;
      const d = Math.sqrt(dMejor[j]!);
      const s = Math.max(p.sigma[i]!, 1e-3);
      if (d <= ALCANCE_SIGMAS * s) cubierto = true;
      const w = p.opacidad[i]! * Math.exp(-0.5 * ((d / s) ** 2));
      total += w;
      r += w * Math.min(1, Math.max(0, p.fdc[i * 3]! * C0 + 0.5));
      vd += w * Math.min(1, Math.max(0, p.fdc[i * 3 + 1]! * C0 + 0.5));
      b += w * Math.min(1, Math.max(0, p.fdc[i * 3 + 2]! * C0 + 0.5));
    }
    if (total > 1e-6 && cubierto) {
      medido[v] = 1;
      // ⚠️ **Se TRUNCA, no se redondea, y no es un detalle de estilo.** El emisor escribe
      // `(clip(color,0,1) * 255).astype(np.uint8)`, que trunca. Redondeando aquí, el color
      // salía medio paso por encima de media en TODOS los canales —0,48 sobre 255— y el
      // 13 % de las caras del STL caían en el escalón de al lado al cuantizar a cinco bits.
      // Dos ficheros que dicen ser la misma arcada tienen que serlo.
      rgb[v * 3] = (Math.min(1, Math.max(0, r / total)) * 255) | 0;
      rgb[v * 3 + 1] = (Math.min(1, Math.max(0, vd / total)) * 255) | 0;
      rgb[v * 3 + 2] = (Math.min(1, Math.max(0, b / total)) * 255) | 0;
    } else {
      rgb[v * 3] = NEUTRO[0]; rgb[v * 3 + 1] = NEUTRO[1]; rgb[v * 3 + 2] = NEUTRO[2];
    }
  }
  return { rgb, medido };
}

/**
 * Da color a los huecos sueltos desde sus vecinos MEDIDOS de la misma pieza.
 *
 * ⚠️ **Rellenar es de VISUALIZACIÓN, y por eso `medido` no cambia.** Un puñado de vértices
 * que ninguna gaussiana cubre salen en gris neutro en mitad de una corona medida, y en
 * pantalla eso es una mota: quien la ve la lee como un fallo del color, no como «aquí no
 * llegó el campo». Se les pone el color de sus vecinos y se deja la bandera a 0, que es lo
 * que el fichero afirma.
 *
 * ⚠️ **Y sólo entre vecinos de la MISMA pieza.** Sin esa condición, una pieza entera sin
 * color medido —el FDI 17, que ninguna foto ve— se rellenaría desde sus vecinas y saldría
 * con un color que no es de nadie. Con ella, sus vértices no tienen ni un vecino medido de
 * su propio código a ningún número de saltos, así que se quedan en gris, que es lo correcto.
 */
export function rellenaHuecos(
  indices: Uint32Array, fdiVertice: Int16Array, rgb: Uint8Array, medido: Uint8Array,
): number {
  const nv = medido.length;
  // Adyacencia por aristas, en formato comprimido: contar, prefijo, llenar.
  const grado = new Uint32Array(nv + 1);
  for (let t = 0; t < indices.length; t += 3) {
    for (let a = 0; a < 3; a++) {
      grado[indices[t + a]! + 1]! += 2;
    }
  }
  for (let i = 0; i < nv; i++) grado[i + 1]! += grado[i]!;
  const vecinos = new Uint32Array(grado[nv]!);
  const cursor = grado.slice();
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t]!, b = indices[t + 1]!, c = indices[t + 2]!;
    vecinos[cursor[a]!++] = b; vecinos[cursor[a]!++] = c;
    vecinos[cursor[b]!++] = a; vecinos[cursor[b]!++] = c;
    vecinos[cursor[c]!++] = a; vecinos[cursor[c]!++] = b;
  }

  const fuente = Uint8Array.from(medido);
  // Se reutilizan: un vértice tiene seis vecinos de media y reservar tres arrays por
  // vértice serían 336.000 asignaciones que el recolector tendría que barrer.
  const canal: [number[], number[], number[]] = [[], [], []];
  let rellenados = 0;
  for (let salto = 0; salto < SALTOS_RELLENO; salto++) {
    const nuevos: number[] = [];
    for (let v = 0; v < nv; v++) {
      if (fuente[v]) continue;
      // ⚠️ **MEDIANA por canal, no media.** El emisor usa `np.median`, y la diferencia no
      // es de gusto: un hueco suele estar en el borde de una corona, rodeado de vecinos de
      // los que uno o dos pueden ser mucho más oscuros —una fisura, una sombra—. La media
      // arrastra ese valor al hueco; la mediana lo ignora. Con media, este puerto pintaba
      // los huecos de un color que el emisor nunca produce.
      canal[0].length = 0; canal[1].length = 0; canal[2].length = 0;
      for (let s = grado[v]!; s < grado[v + 1]!; s++) {
        const u = vecinos[s]!;
        if (!fuente[u] || fdiVertice[u] !== fdiVertice[v]) continue;
        canal[0].push(rgb[u * 3]!); canal[1].push(rgb[u * 3 + 1]!); canal[2].push(rgb[u * 3 + 2]!);
      }
      if (!canal[0].length) continue;
      for (let c = 0; c < 3; c++) rgb[v * 3 + c] = mediana(canal[c]!);
      nuevos.push(v);
    }
    if (!nuevos.length) break;
    for (const v of nuevos) fuente[v] = 1;
    rellenados += nuevos.length;
  }
  return rellenados;
}


/**
 * La mediana de una lista corta, truncada a byte igual que la escribe el emisor.
 *
 * Con un número par de vecinos, `np.median` promedia los dos centrales y el `.astype(uint8)`
 * de después trunca. Se replica tal cual: redondear aquí movería un canal en los huecos.
 */
function mediana(v: number[]): number {
  v.sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m]! : ((v[m - 1]! + v[m]!) / 2) | 0;
}

/**
 * Apaga `medido` en las piezas que el contenedor NO declara con color.
 *
 * ⚠️ **Sin esto el fichero afirma un color inventado, y la prueba de cobertura no lo puede
 * detectar.** El campo gaussiano pinta TODA la arcada: a una pieza sin color declarado la
 * cubre igual, con el degradado de respaldo, y sus gaussianas la envuelven perfectamente
 * —así que `cubierto` sale a `true` y el peso total es alto—. El resultado es una corona
 * con un color plausible marcado como medido del paciente cuando ninguna foto la vio.
 *
 * Sobre el caso real son los 3.035 vértices del FDI 17, el segundo molar: ninguna de las
 * fotos aportadas lo ve con su eje cuello-borde, y el gate del emisor ya lo dice con esas
 * palabras. **Quien manda es lo declarado**, no lo que el campo sea capaz de pintar.
 *
 * Va DESPUÉS del color y ANTES de rellenar huecos: si se rellenara primero, esos vértices
 * heredarían color de sus vecinos y volverían a salir con un color que no es de nadie.
 */
export function apagaSinDeclarar(
  fdiVertice: Int16Array, rgb: Uint8Array, medido: Uint8Array,
  conColor: readonly number[],
): number {
  const declarado = new Set(conColor);
  let apagados = 0;
  for (let v = 0; v < medido.length; v++) {
    const f = fdiVertice[v]!;
    if (f <= 0 || declarado.has(f)) continue;
    rgb[v * 3] = NEUTRO[0]; rgb[v * 3 + 1] = NEUTRO[1]; rgb[v * 3 + 2] = NEUTRO[2];
    if (medido[v]) apagados++;
    medido[v] = 0;
  }
  return apagados;
}
