/**
 * Cuánto separa una nube sus gaussianas: lo que decide de qué tamaño se dibujan.
 *
 * Va en un módulo aparte, sin `three`, para poder probarlo sin rasterizador.
 */

/** Cuántos puntos se muestrean para medir el espaciado. Bastan pocos: es una mediana. */
const MUESTRA_ESPACIADO = 1500;

/**
 * Cuánto tiene que apuntar un vecino a lo largo de un eje para contar como «vecino en ese
 * eje»: el coseno del ángulo entre el desplazamiento y el eje. 0,9 son unos 25°.
 */
const COSENO_EJE = 0.9;

/**
 * Qué fracción de las muestras tiene que encontrar vecino en un eje para que ese eje
 * cuente. En una cáscara fina (una corona) casi nadie tiene vecino a través de ella, y esas
 * pocas distancias no dicen nada de la rejilla.
 */
const FRACCION_EJE = 0.25;

export interface Espaciado {
  /**
   * Distancia mediana al vecino más próximo, en cualquier dirección. El sigma natural de
   * la nube.
   */
  readonly vecino: number;
  /**
   * La mediana, eje a eje (x, y, z del marco del campo), de la distancia al vecino más
   * próximo que cae en ese eje. `null` si en ese eje no hay vecinos bastantes.
   */
  readonly porEje: readonly [number | null, number | null, number | null];
  /**
   * El espaciado que hay que cubrir para que no queden huecos: el mayor de los anteriores.
   *
   * ⚠️ **Existe porque un CBCT no es isótropo.** En los dos casos de prueba la rejilla es
   * 0,3 × 0,3 mm en el corte y 0,45 o 0,6 mm entre cortes. El vecino más próximo cae
   * siempre en el corte —0,3 mm— y unos splats de ese tamaño dejan entre corte y corte una
   * franja vacía: el hueso salía rayado en horizontal, como una persiana.
   */
  readonly cobertura: number;
}

/**
 * Mide el espaciado de una nube. Ver `Espaciado`.
 *
 * ⚠️ **Se consulta contra TODOS los puntos, no contra una muestra**, y la diferencia no es
 * un matiz: la primera versión medía 1.500 puntos repartidos por toda la mandíbula y
 * calculaba la distancia **entre ellos**, o sea el espaciado de la muestra. Daba 2,22 mm
 * donde el real es 0,47 —casi cinco veces— y con eso los splats salían del tamaño de un
 * diente.
 *
 * Se indexan los puntos en una rejilla uniforme y cada consulta mira su celda y las 26 de
 * alrededor. Construirla es lineal y las consultas son constantes; un KD-tree daría lo
 * mismo con más código que mantener.
 */
export function mideEspaciado(pos: Float32Array, n: number): Espaciado {
  const nada: Espaciado = { vecino: 0, porEje: [null, null, null], cobertura: 0 };
  if (n < 2) return nada;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3]!, y = pos[i * 3 + 1]!, z = pos[i * 3 + 2]!;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const diagonal = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ);
  if (!(diagonal > 0)) return nada;
  // Celda del orden del espaciado esperado para una nube volumétrica. No hace falta
  // acertar: sólo que caigan unos pocos puntos por celda.
  const celda = Math.max(diagonal / Math.cbrt(n), 1e-6) * 2;
  const clave = (x: number, y: number, z: number): number =>
    (Math.floor((x - minX) / celda) * 73856093) ^
    (Math.floor((y - minY) / celda) * 19349663) ^
    (Math.floor((z - minZ) / celda) * 83492791);

  const rejilla = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const k = clave(pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!);
    const c = rejilla.get(k);
    if (c) c.push(i);
    else rejilla.set(k, [i]);
  }

  const m = Math.min(MUESTRA_ESPACIADO, n);
  const paso = n / m;
  const d: number[] = [];
  const ejes: [number[], number[], number[]] = [[], [], []];
  const c2 = COSENO_EJE * COSENO_EJE;
  for (let q = 0; q < m; q++) {
    const i = Math.floor(q * paso);
    const x = pos[i * 3]!, y = pos[i * 3 + 1]!, z = pos[i * 3 + 2]!;
    let mejor = Infinity;
    const mejorEje = [Infinity, Infinity, Infinity];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const c = rejilla.get(clave(x + dx * celda, y + dy * celda, z + dz * celda));
          if (!c) continue;
          for (const j of c) {
            if (j === i) continue;
            const a = pos[j * 3]! - x;
            const b = pos[j * 3 + 1]! - y;
            const e = pos[j * 3 + 2]! - z;
            const r = a * a + b * b + e * e;
            if (r === 0) continue;
            if (r < mejor) mejor = r;
            // Vecino «en el eje k» si el desplazamiento apunta casi entero a lo largo de k.
            if (a * a >= c2 * r && r < mejorEje[0]!) mejorEje[0] = r;
            if (b * b >= c2 * r && r < mejorEje[1]!) mejorEje[1] = r;
            if (e * e >= c2 * r && r < mejorEje[2]!) mejorEje[2] = r;
          }
        }
      }
    }
    if (Number.isFinite(mejor)) d.push(Math.sqrt(mejor));
    for (let k = 0; k < 3; k++) {
      if (Number.isFinite(mejorEje[k]!)) ejes[k]!.push(Math.sqrt(mejorEje[k]!));
    }
  }
  if (!d.length) return nada;
  const vecino = mediana(d);
  const porEje = ejes.map((e) => (e.length >= FRACCION_EJE * m ? mediana(e) : null)) as
    unknown as [number | null, number | null, number | null];
  const cobertura = Math.max(vecino, ...porEje.map((e) => e ?? 0));
  return { vecino, porEje, cobertura };
}

function mediana(v: number[]): number {
  v.sort((x, y) => x - y);
  return v[Math.floor(v.length / 2)]!;
}
