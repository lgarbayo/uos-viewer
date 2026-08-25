/**
 * El paso de SPLATS del §11.2: el campo gaussiano, encendido por capas.
 *
 * **Por qué esto no es un rasterizador de 3DGS, y por qué no hace falta que lo sea.** El
 * 3DGS de facto pinta apariencia: color con armónicos esféricos, opacidad aprendida, y
 * una mezcla alfa que **exige ordenar cada gaussiana por profundidad en cada fotograma**.
 * Lo que este contenedor trae es otra cosa y lo declara en su sidecar: `density` es sigma
 * —atenuación medida por el CBCT— y no hay color en ninguna parte.
 *
 * Un campo de densidad se compone **sumando**, que es lo que hace un rayo al atravesarlo
 * (Beer-Lambert). Y sumar es conmutativo: **no hay que ordenar nada**. Esa es la razón de
 * que este paso quepa en un fichero en vez de en una biblioteca — no es una simplificación
 * que se pague en calidad, es que la física del dato es más simple que la de una foto.
 *
 * ⚠️ **El color de cada capa es FALSO COLOR.** El campo no trae ninguno. El tono sirve
 * para distinguir capas encendidas a la vez y no significa tejido, ni densidad, ni nada
 * que se pueda medir encima. Va escrito en el panel al lado del interruptor.
 *
 * ⚠️ **Y la opacidad es sigma reescalada, no opacidad medida.** Se aplica una ganancia de
 * visualización porque una sigma normalizada cae casi entera bajo el suelo de 1/255 del
 * rasterizador: sin ella la capa se ve negra y parece vacía. La ganancia es de display y
 * no viaja al artefacto — el mismo criterio que el paquete del visor del otro repositorio.
 */

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Points,
  ShaderMaterial,
  type Scene,
} from 'three';

import type { CampoPly } from '../uos/Ply';

/**
 * Cuánto se amplifica sigma para que la capa se vea. Ver el aviso de arriba.
 *
 * ⚠️ Es BAJA, y tiene que serlo: con los splats cubriendo la nube, un rayo atraviesa del
 * orden de ochenta gaussianas y la mezcla aditiva las suma todas. La primera versión usaba
 * 14 porque los splats salían de UN píxel y no acumulaban nada — compensaba un error de
 * escala con otro, y el resultado era polvo brillante en vez de un volumen.
 */
export const GANANCIA_DISPLAY = 0.15;
/**
 * Tope de tamaño en píxeles. Un splat muy cerca no puede llenar la pantalla él solo.
 *
 * ⚠️ **El tamaño de un splat es la proyección de verdad, no una constante a ojo.** Había
 * un 260 puesto a mano, y con él una gaussiana de 0,3 mm vista a 100 mm salía en 0,78 px
 * —o sea recortada a UNO—: el campo entero se veía como polvo brillante en vez de como un
 * volumen, porque los splats no llegaban a solaparse y solaparse es justo lo que hace que
 * una nube de densidad se lea como materia. La escala correcta la pone `sincroniza`.
 */
const TAMANO_MAXIMO = 48.0;
/** Tope de primitivas por capa. Por encima, se muestrea. Ver `_muestrea`. */
export const TOPE_PRIMITIVAS = 600_000;

/**
 * Qué fracción del espaciado de la nube mide el radio con que se DIBUJA cada gaussiana.
 *
 * ⚠️ **Y sí, se dibuja más grande de lo que dice el fichero. Es ganancia de display, como
 * la de la opacidad, y por eso está aquí y no viaja al artefacto.** Medido sobre un campo
 * real: `scale_0` vale 0,075 mm en TODAS las gaussianas y la separación entre vecinas es
 * 0,26 mm tras muestrear — tres veces mayor. O sea que a su tamaño declarado las
 * gaussianas **no pueden solaparse nunca**, y una nube de densidad que no se solapa no se
 * lee como materia sino como polvo.
 *
 * ⚠️ **Y el valor va un pelo POR ENCIMA de 1, no en 0,5, porque `gl_PointSize` es el LADO
 * del sprite y no un radio.** Con 0,55 los sprites salían de medio espaciado de lado y
 * seguían dejando hueco entre ellos: el error de bulto anterior arreglado a medias.
 *
 * El espaciado se MIDE de la propia nube al cargarla, no se supone: un campo de otro CBCT
 * con otro vóxel tendría otro, y una constante en milímetros lo dibujaría mal.
 */
const TAMANO_POR_ESPACIADO = 1.1;
/** Cuántos puntos se muestrean para medir el espaciado. Bastan pocos: es una mediana. */
const MUESTRA_ESPACIADO = 1500;

const VERTEX = /* glsl */ `
  attribute float sigma;
  attribute float radio;
  varying float vAlfa;
  uniform float ganancia;
  uniform float escala;
  uniform float tope;
  void main() {
    vAlfa = clamp(sigma * ganancia, 0.0, 1.0);
    vec4 vista = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * vista;
    // El tamaño es la proyección de VERDAD y no una constante a ojo: un radio r a
    // distancia d ocupa r * altura / (2 * tan(fov/2)) / d pixeles. Ver el comentario de
    // TAMANO_MAXIMO, que es donde se explica por que esto importaba tanto.
    gl_PointSize = clamp(escala * radio / -vista.z, 1.0, tope);
  }
`;

const FRAGMENT = /* glsl */ `
  precision mediump float;
  varying float vAlfa;
  uniform vec3 tono;
  void main() {
    // Perfil gaussiano dentro del punto: sin esto el splat es un cuadrado y el campo
    // entero se ve como una malla de píxeles.
    vec2 d = gl_PointCoord - vec2(0.5);
    float r2 = dot(d, d) * 4.0;
    if (r2 > 1.0) discard;
    gl_FragColor = vec4(tono * vAlfa * exp(-2.5 * r2), 1.0);
  }
`;

export interface Capa {
  readonly id: string;
  readonly nombre: string;
  readonly n: number;
  /** Cuántas se dibujan de verdad. Menor que `n` si hubo que muestrear. */
  readonly dibujadas: number;
  readonly medida: boolean;
  readonly nota: string;
  encendida: boolean;
}

/**
 * Muestreo determinista cuando la capa no cabe.
 *
 * ⚠️ Uniforme y con semilla fija, **no** «las más densas primero». Quedarse con las de
 * mayor sigma parece mejor y cambia lo que el campo dice: la atenuación que se ve dejaría
 * de ser proporcional a la que se midió, y encender dos capas ya no sumaría bien. Un
 * muestreo uniforme escala la suma entera por un factor conocido.
 */
/**
 * Distancia mediana al vecino más próximo. El sigma natural de la nube.
 *
 * ⚠️ **Se consulta contra TODOS los puntos, no contra una muestra**, y la diferencia no es
 * un matiz: la primera versión medía 1.500 puntos repartidos por toda la mandíbula y
 * calculaba la distancia **entre ellos**, o sea el espaciado de la muestra. Daba 2,22 mm
 * donde el real es 0,47 — casi cinco veces— y con eso los splats salían del tamaño de un
 * diente.
 *
 * Se indexan los puntos en una rejilla uniforme y cada consulta mira su celda y las 26 de
 * alrededor. Construirla es lineal y las consultas son constantes; un KD-tree daría lo
 * mismo con más código que mantener.
 */
function _espaciado(pos: Float32Array, n: number): number {
  if (n < 2) return 0;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3]!, y = pos[i * 3 + 1]!, z = pos[i * 3 + 2]!;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const diagonal = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ);
  if (!(diagonal > 0)) return 0;
  // Celda del orden del espaciado esperado para una nube volumétrica. No hace falta
  // acertar: sólo que caigan unos pocos puntos por celda.
  const celda = Math.max(diagonal / Math.cbrt(n) , 1e-6) * 2;
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
  for (let q = 0; q < m; q++) {
    const i = Math.floor(q * paso);
    const x = pos[i * 3]!, y = pos[i * 3 + 1]!, z = pos[i * 3 + 2]!;
    let mejor = Infinity;
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
            if (r < mejor) mejor = r;
          }
        }
      }
    }
    if (Number.isFinite(mejor)) d.push(Math.sqrt(mejor));
  }
  if (!d.length) return 0;
  d.sort((x, y) => x - y);
  return d[Math.floor(d.length / 2)]!;
}

function _muestrea(n: number, tope: number): Int32Array | null {
  if (n <= tope) return null;
  const paso = n / tope;
  const idx = new Int32Array(tope);
  for (let i = 0; i < tope; i++) idx[i] = Math.floor(i * paso);
  return idx;
}

export class Splats {
  private readonly nubes = new Map<string, Points>();
  readonly capas: Capa[] = [];

  constructor(private readonly scene: Scene) {}

  /**
   * Añade una capa desde un campo ya leído. `tono` es falso color de visualización.
   *
   * `origen` desplaza el campo al marco de la escena: el PLY sale centrado en su propio
   * centroide y la malla está en coordenadas del twin. Sin esto la nube aparece a ochenta
   * milímetros de la arcada, que es un error que se ve pero no se entiende.
   */
  añade(
    id: string,
    nombre: string,
    campo: CampoPly,
    tono: [number, number, number],
    opciones: {
      origen?: [number, number, number];
      medida?: boolean;
      nota?: string;
    } = {},
  ): void {
    const { origen, medida = false, nota = '' } = opciones;
    const { x, y, z, density } = campo.columnas;
    if (!x || !y || !z || !density) {
      throw new Error(
        `La capa \`${id}\` no trae x/y/z/density: no es un campo de este perfil.`,
      );
    }
    const idx = _muestrea(campo.n, TOPE_PRIMITIVAS);
    const m = idx ? idx.length : campo.n;
    const pos = new Float32Array(m * 3);
    const sigma = new Float32Array(m);
    const radio = new Float32Array(m);
    const s0 = campo.columnas['scale_0'];
    const [ox, oy, oz] = origen ?? [0, 0, 0];
    for (let i = 0; i < m; i++) {
      const j = idx ? idx[i]! : i;
      pos[i * 3] = x[j]! + ox;
      pos[i * 3 + 1] = y[j]! + oy;
      pos[i * 3 + 2] = z[j]! + oz;
      sigma[i] = density[j]!;
      radio[i] = s0 ? s0[j]! : 0;
    }
    // El tamaño DE DIBUJO: el mayor entre el declarado y el espaciado de la nube. Ver
    // `TAMANO_POR_ESPACIADO` — con el declarado a secas no se solapa nada y se ve como
    // polvo. Se mide DESPUÉS de muestrear, sobre lo que de verdad se va a dibujar:
    // muestrear separa las gaussianas y el espaciado del original ya no valdría.
    const minimo = _espaciado(pos, m) * TAMANO_POR_ESPACIADO;
    for (let i = 0; i < m; i++) radio[i] = Math.max(radio[i]!, minimo);

    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('sigma', new BufferAttribute(sigma, 1));
    g.setAttribute('radio', new BufferAttribute(radio, 1));
    const puntos = new Points(
      g,
      new ShaderMaterial({
        uniforms: {
          tono: { value: tono },
          ganancia: { value: GANANCIA_DISPLAY },
          // Lo pone `sincroniza` en cada fotograma: depende del alto del lienzo y del
          // `fov`, y los dos cambian —al redimensionar y al aplicar una vista guardada—.
          escala: { value: 1000.0 },
          tope: { value: TAMANO_MAXIMO },
        },
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        transparent: true,
        // Aditivo: es como se compone un campo de densidad, y de paso hace que el orden
        // de dibujado no importe. Sin escribir depth, porque un splat no ocluye.
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    puntos.visible = false;
    puntos.frustumCulled = false;
    this.scene.add(puntos);
    this.nubes.set(id, puntos);
    this.capas.push({
      id,
      nombre,
      n: campo.n,
      dibujadas: m,
      medida,
      nota,
      encendida: false,
    });
  }

  enciende(id: string, visible: boolean): void {
    const p = this.nubes.get(id);
    if (!p) return;
    p.visible = visible;
    const c = this.capas.find((x) => x.id === id);
    if (c) c.encendida = visible;
  }

  /**
   * Actualiza la escala de proyección. Se llama en cada fotograma.
   *
   * No se puede calcular una vez en el constructor: el `fov` lo cambia cada vista
   * guardada del §7 y el alto del lienzo cambia al redimensionar la ventana. Con una
   * escala congelada, los splats quedarían del tamaño de otra cámara.
   */
  sincroniza(alturaPx: number, fovGrados: number): void {
    const escala = alturaPx / (2 * Math.tan((fovGrados / 2) * (Math.PI / 180)));
    for (const p of this.nubes.values()) {
      (p.material as ShaderMaterial).uniforms['escala']!.value = escala;
    }
  }

  ponGanancia(g: number): void {
    for (const p of this.nubes.values()) {
      (p.material as ShaderMaterial).uniforms['ganancia']!.value = g;
    }
  }

  /** Quita todas las capas. Se llama al abrir otro contenedor. */
  limpia(): void {
    for (const p of this.nubes.values()) {
      this.scene.remove(p);
      p.geometry.dispose();
      (p.material as ShaderMaterial).dispose();
    }
    this.nubes.clear();
    this.capas.length = 0;
  }
}
