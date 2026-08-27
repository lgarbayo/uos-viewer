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
  Box3,
  BufferAttribute,
  BufferGeometry,
  NormalBlending,
  Points,
  ShaderMaterial,
  WebGLRenderTarget,
  type OrthographicCamera,
  type PerspectiveCamera,
  type Scene,
  type WebGLRenderer,
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
 * Cuanto se apaga lo que no es la pieza resaltada. El mismo criterio que tenia la malla:
 * **apagar el resto en vez de rodear la pieza con un borde**, porque el contorno de un
 * diente cae justo en el margen gingival — que es la frontera clinica que interesa mirar,
 * y ademas la que este proyecto tiene medido que no sabe determinar. Un borde dibujado
 * encima la tapa; bajar el brillo de lo demas la deja intacta.
 */
const APAGADO = 0.22;
/**
 * Alfa por debajo del cual una gaussiana no captura el clic.
 *
 * Sin esto, el pase de seleccion escribe profundidad por CUALQUIER gaussiana que cubra el
 * pixel, incluidas las casi invisibles: se seleccionarian piezas que no se ven. El umbral
 * es el mismo criterio que el ojo — si no esta pintada, no se pincha.
 */
const ALFA_MINIMA_PICK = 0.05;
/**
 * Alfa por debajo del cual un splat de APARIENCIA no se dibuja. Es display, no dato.
 *
 * ⚠️ **La "neblina" de baja opacidad es un resultado del entrenamiento, no un defecto del
 * fichero.** El 3DGS reparte la imagen entre unas pocas gaussianas opacas y decenas de
 * miles casi transparentes; el rasterizador de referencia las compone ORDENADAS por
 * profundidad y sale una superficie. Este paso dibuja sprites SIN ordenar, y entonces la
 * neblina que esta detras de una gaussiana opaca la multiplica por (1-alfa) igual que si
 * estuviera delante: la superficie se borra a si misma y queda polvo.
 *
 * Medido sobre este campo: mediana de alfa 0,0197 (5/255), y a 32/255 sobrevive el 17,9 %.
 * Es el mismo numero que documenta el otro visor del proyecto —"el 17 % opaco ya sostiene
 * toda la superficie"— donde se encontro renderizando, no razonando.
 *
 * ⚠️ **Desde que la apariencia la rasteriza `Apariencia`, esto gobierna sobre todo el PASE
 * DE SELECCION**, y ahi sigue haciendo falta por una razon distinta: si el pase de picking
 * dibujara la neblina, una gaussiana casi transparente delante ganaria la profundidad y
 * devolveria SU codigo — se seleccionaria una pieza que no se esta viendo. El corte tiene
 * que ser el mismo que el `splatAlphaRemovalThreshold` con el que se cargo el campo.
 */
export const UMBRAL_ALFA = 8 / 255;

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
  // 1 = perspectiva (el tamano cae con la distancia), 0 = ortografica (no cae).
  uniform float perspectiva;
  void main() {
    vAlfa = clamp(sigma * ganancia, 0.0, 1.0);
    vec4 vista = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * vista;
    // El tamaño es la proyección de VERDAD y no una constante a ojo: un radio r a
    // distancia d ocupa r * altura / (2 * tan(fov/2)) / d pixeles. Ver el comentario de
    // TAMANO_MAXIMO, que es donde se explica por que esto importaba tanto.
    // En ortografica el tamano NO cae con la distancia: dividir por -z encogeria lo que
    // esta lejos, que es justo la fuga de perspectiva que la proyeccion quita.
    gl_PointSize = clamp(escala * radio / mix(1.0, -vista.z, perspectiva), 1.0, tope);
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

// --- Shaders de APARIENCIA: color real (f_dc) + opacidad aprendida ---

const VERT_AP = /* glsl */ `
  attribute vec3 colorSH;
  attribute float opacity;
  attribute float radio;
  // El codigo FDI de la gaussiana. Va como atributo y no como uniform porque cada
  // gaussiana lleva el suyo: es la columna region_id del PLY, tal cual.
  attribute float fdi;
  varying float vAlfa;
  varying vec3 vColor;
  varying float vFdi;
  uniform float escala;
  uniform float tope;
  uniform float perspectiva;
  void main() {
    // sigmoid(opacity) → alpha, con clamp para evitar explosiones
    vAlfa = clamp(1.0 / (1.0 + exp(-opacity)), 0.0, 1.0);
    vColor = colorSH;
    vFdi = fdi;
    vec4 vista = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * vista;
    gl_PointSize = clamp(escala * radio / mix(1.0, -vista.z, perspectiva), 1.0, tope);
  }
`;

const FRAG_AP = /* glsl */ `
  precision mediump float;
  varying float vAlfa;
  varying vec3 vColor;
  varying float vFdi;
  uniform float resaltada;
  uniform float apagado;
  uniform float umbral;
  void main() {
    vec2 d = gl_PointCoord - vec2(0.5);
    float r2 = dot(d, d) * 4.0;
    // El corte va sobre el alfa DEL SPLAT, antes de la caida gaussiana: es lo que hace un
    // splatAlphaRemovalThreshold, y es lo que separa la neblina de la superficie.
    if (r2 > 1.0 || vAlfa < umbral) discard;
    // Gaussian falloff ponderado por alpha; premultiplied alpha para blending correcto
    float w = vAlfa * exp(-2.5 * r2);
    // resaltada < 0 = ninguna pieza seleccionada, y entonces no se toca nada. Con una
    // seleccionada, el resto se apaga — ver APAGADO.
    float k = (resaltada >= 0.0 && abs(vFdi - resaltada) > 0.5) ? apagado : 1.0;
    gl_FragColor = vec4(vColor * w * k, w * k);
  }
`;

/**
 * Pase de SELECCION: el codigo FDI escrito como color, con profundidad de verdad.
 *
 * ⚠️ **Y no es una proyeccion de centroides.** Coger la gaussiana cuyo centro cae mas
 * cerca del cursor devuelve las que estan DETRAS de la superficie que se esta mirando: en
 * una nube volumetrica el centro mas cercano en pantalla casi nunca es el que se ve. Aqui
 * se dibuja el mismo sprite gaussiano que se ve, con `depthTest` y `depthWrite`
 * encendidos y sin mezcla, asi que gana la gaussiana **mas cercana a la camara** — que es
 * exactamente la que hay bajo el cursor.
 *
 * El FDI va en el canal rojo sin escalar: los codigos ISO-3950 llegan a 48 y el 0 es «sin
 * asignar», que coincide con el negro del fondo. Un pixel vacio y una gaussiana de encia
 * dan lo mismo, y las dos significan «aqui no hay pieza».
 */
const FRAG_PICK = /* glsl */ `
  precision mediump float;
  varying float vAlfa;
  varying float vFdi;
  uniform float umbral;
  void main() {
    vec2 d = gl_PointCoord - vec2(0.5);
    float r2 = dot(d, d) * 4.0;
    // ⚠️ **El mismo umbral que el pase visible.** Si el pase de seleccion dibujara la
    // neblina que la pantalla descarta, se seleccionaria una pieza que no se esta viendo:
    // una gaussiana casi transparente delante ganaria la profundidad y devolveria su FDI.
    if (r2 > 1.0 || vAlfa < max(umbral, ${ALFA_MINIMA_PICK})) discard;
    gl_FragColor = vec4(vFdi / 255.0, 0.0, 0.0, 1.0);
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
  /** Apariencia (color real, perfil INRIA) frente a campo de densidad. */
  readonly apariencia: boolean;
  /** La dibuja el rasterizador; esta geometria solo encuadra y resuelve el picking. */
  readonly soloSeleccion: boolean;
  /** Si la capa trae `region_id`: el codigo FDI por gaussiana. Sin el no hay seleccion. */
  readonly conFdi: boolean;
  /** Los codigos FDI presentes, ordenados. Vacio si la capa no trae `region_id`. */
  readonly piezas: readonly number[];
  /** Cuantas de las dibujadas llevan un codigo distinto de 0. El resto es encia. */
  readonly conPieza: number;
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
  /** Destino de 1x1 del pase de seleccion. Se crea una vez y se reutiliza. */
  private objetivo: WebGLRenderTarget | null = null;
  private readonly pixel = new Uint8Array(4);
  private resaltada: number | null = null;
  private umbral = UMBRAL_ALFA;

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
          perspectiva: { value: 1.0 },
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
      apariencia: false,
      soloSeleccion: false,
      conFdi: false,
      piezas: [],
      conPieza: 0,
      encendida: false,
    });
  }

  /**
   * Añade una capa de APARIENCIA: color real (f_dc_*) + opacidad aprendida.
   *
   * Diferente de `añade`: usa alpha blending (no aditivo) con premultiplied alpha,
   * y el color sale de los armónicos esféricos en vez de un falso color uniforme.
   */
  añadeApariencia(
    id: string,
    nombre: string,
    campo: CampoPly,
    opciones: {
      origen?: [number, number, number];
      medida?: boolean;
      nota?: string;
      /**
       * La capa NO se dibuja aquí: existe para el encuadre y para el pase de selección.
       *
       * ⚠️ Quien la dibuja es el rasterizador de `Apariencia`, que es lo que el spec pide
       * (§11.2, paso 3). Pero ese rasterizador **reordena las gaussianas por dentro** para
       * componer por profundidad, así que un índice suyo no es un índice nuestro y no hay
       * forma de preguntarle «qué FDI hay bajo el cursor». Esta geometría, con los mismos
       * centros y la columna `region_id`, es la que contesta.
       */
      soloSeleccion?: boolean;
    } = {},
  ): void {
    const { origen, medida = false, nota = '', soloSeleccion = false } = opciones;
    const { x, y, z, opacity } = campo.columnas;
    const fdc0 = campo.columnas['f_dc_0'];
    const fdc1 = campo.columnas['f_dc_1'];
    const fdc2 = campo.columnas['f_dc_2'];
    if (!x || !y || !z || !opacity || !fdc0 || !fdc1 || !fdc2) {
      throw new Error(
        `La capa \`${id}\` no trae x/y/z/opacity/f_dc_*: no es un perfil de apariencia.`,
      );
    }
    // ⚠️ **El FDI por gaussiana, si el fichero lo trae.** Es lo que permite seleccionar una
    // pieza SIN malla delante: el picking del spec esta definido sobre los vertices de un
    // `scene.glb`, y un contenedor de solo gaussianas no lo lleva. La columna es
    // `region_id` — el codigo ISO-3950 de la corona mas cercana, no una etiqueta aprendida,
    // segun declara el propio sidecar.
    const region = campo.columnas['region_id'];
    const idx = _muestrea(campo.n, TOPE_PRIMITIVAS);
    const m = idx ? idx.length : campo.n;
    const pos = new Float32Array(m * 3);
    const colorArr = new Float32Array(m * 3);
    const opArr = new Float32Array(m);
    const radio = new Float32Array(m);
    // ⚠️ Se muestrea con EL MISMO `idx` que las posiciones. Con dos recorridos distintos el
    // codigo de la gaussiana i seria el de otra, y el clic devolveria una pieza que no es
    // la que esta debajo — un fallo que no rompe nada y miente en cada clic.
    const fdiArr = region ? new Float32Array(m) : null;
    const s0 = campo.columnas['scale_0'];
    const [ox, oy, oz] = origen ?? [0, 0, 0];
    for (let i = 0; i < m; i++) {
      const j = idx ? idx[i]! : i;
      pos[i * 3] = x[j]! + ox;
      pos[i * 3 + 1] = y[j]! + oy;
      pos[i * 3 + 2] = z[j]! + oz;
      colorArr[i * 3] = fdc0[j]!;
      colorArr[i * 3 + 1] = fdc1[j]!;
      colorArr[i * 3 + 2] = fdc2[j]!;
      opArr[i] = opacity[j]!;
      if (fdiArr) fdiArr[i] = region![j]!;
      // ⚠️ scale_0 viene en logaritmo (convención INRIA): exp para obtener mm lineales.
      radio[i] = s0 ? Math.exp(s0[j]!) : 0;
    }
    const minimo = _espaciado(pos, m) * TAMANO_POR_ESPACIADO;
    for (let i = 0; i < m; i++) radio[i] = Math.max(radio[i]!, minimo);

    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('colorSH', new BufferAttribute(colorArr, 3));
    g.setAttribute('opacity', new BufferAttribute(opArr, 1));
    g.setAttribute('radio', new BufferAttribute(radio, 1));
    // Siempre se declara, traiga o no la columna: el shader lee `fdi` y un atributo que
    // falta deja el valor sin definir en vez de fallar. Sin columna van todos a 0, que en
    // el vocabulario ISO-3950 es «sin asignar» — o sea, la verdad.
    g.setAttribute('fdi', new BufferAttribute(fdiArr ?? new Float32Array(m), 1));
    const puntos = new Points(
      g,
      new ShaderMaterial({
        uniforms: {
          escala: { value: 1000.0 },
          tope: { value: TAMANO_MAXIMO },
          perspectiva: { value: 1.0 },
          resaltada: { value: -1.0 },
          apagado: { value: APAGADO },
          umbral: { value: this.umbral },
        },
        vertexShader: VERT_AP,
        fragmentShader: FRAG_AP,
        transparent: true,
        blending: NormalBlending,
        // ⚠️ **Y `premultipliedAlpha: true`, que es lo que faltaba.** El fragment devuelve
        // el color YA multiplicado por alfa (`vColor * w`), y este flag es lo unico que le
        // dice a three que use `ONE / ONE_MINUS_SRC_ALPHA`. Sin el —el defecto es `false`—
        // `NormalBlending` usa `SRC_ALPHA / ONE_MINUS_SRC_ALPHA` y **el color se multiplica
        // por alfa DOS VECES**.
        //
        // Medido sobre el campo real: la mediana de `sigmoid(opacity)` es 0,020, y al
        // cuadrado es 0,0004 — cincuenta veces mas oscuro. Solo sobrevivian las del
        // percentil 95 (0,64² = 0,41), asi que la arcada se veia como motas brillantes
        // sobre negro y parecia que las gaussianas no se solapaban. Se solapan: el radio
        // mediano es 0,87 mm y el espaciado 0,17, casi cinco veces. Lo que faltaba era luz.
        premultipliedAlpha: true,
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
      apariencia: true,
      soloSeleccion,
      conFdi: fdiArr !== null,
      // Se cuenta sobre lo que SE DIBUJA, no sobre el fichero: si la capa se muestreo, el
      // panel tiene que decir lo que hay en pantalla, que es lo que se puede pinchar.
      piezas: fdiArr ? [...new Set(fdiArr)].filter((v) => v > 0).sort((a, b) => a - b) : [],
      conPieza: fdiArr ? fdiArr.reduce((n, v) => n + (v > 0 ? 1 : 0), 0) : 0,
      // ⚠️ **Encendida de salida.** El gemelo es el campo gaussiano: un contenedor que trae
      // apariencia y la enseña apagada esconde su propio modelo. «Encendida» es lo que el
      // panel dice y lo que el rasterizador obedece; el `visible` de ESTA geometria es
      // otra cosa y va a `false` cuando solo sirve para seleccionar.
      encendida: true,
    });
    puntos.visible = !soloSeleccion;
  }

  /**
   * Caja del contenido de una capa, en el marco de la escena.
   *
   * Hace falta porque **el visor tiene que poder encuadrar un caso sin malla**: si el
   * contenedor solo trae gaussianas, no hay `Box3.setFromObject` de una malla que mirar.
   * Se calcula del atributo `position`, que es el que de verdad se dibuja.
   */
  caja(id: string): Box3 | null {
    const p = this.nubes.get(id);
    if (!p) return null;
    const caja = new Box3().setFromBufferAttribute(
      p.geometry.getAttribute('position') as BufferAttribute,
    );
    return caja.isEmpty() ? null : caja;
  }

  /** La primera capa que sea APARIENCIA, que es la que se enseña por defecto. */
  get apariencia(): Capa | undefined {
    return this.capas.find((c) => c.apariencia);
  }

  /** Si alguna capa trae el codigo FDI por gaussiana. Sin esto no hay seleccion posible. */
  get hayFdi(): boolean {
    return this.capas.some((c) => c.conFdi);
  }

  /**
   * Enciende una pieza y apaga el resto. `null` las devuelve todas.
   *
   * Se hace en el shader y no reconstruyendo el buffer de color: son ciento veinte mil
   * gaussianas y un uniform es un numero.
   */
  resalta(fdi: number | null): void {
    this.resaltada = fdi;
    for (const p of this.nubes.values()) {
      const u = (p.material as ShaderMaterial).uniforms['resaltada'];
      if (u) u.value = fdi ?? -1.0;
    }
  }

  /** La pieza resaltada ahora mismo, o `null`. */
  get seleccionada(): number | null {
    return this.resaltada;
  }

  /**
   * Que pieza hay bajo el cursor, o `null`. Selección por PASE, no por proyección.
   *
   * ⚠️ **Esta es la mitad semantica del visor en un contenedor de solo gaussianas.** El
   * spec resuelve el picking con un raycast contra los vertices de `scene.glb`; aqui no
   * hay malla —es la decision del formato— asi que la pregunta se le hace a lo que de
   * verdad esta pintado: se redibuja el pixel del cursor con el codigo FDI como color, con
   * profundidad encendida, y gana la gaussiana mas cercana a la camara.
   *
   * Se usa `setViewOffset` para que ese unico pixel ocupe todo el viewport de un destino
   * de 1x1: es una camara con la misma proyeccion, recortada. Asi se dibuja un pixel y no
   * una pantalla entera por clic.
   *
   * Devuelve `null` tanto si no habia nada como si la gaussiana es de encia (FDI 0): las
   * dos cosas significan «aqui no hay pieza», y distinguirlas seria inventar precision.
   */
  piezaEn(
    renderer: WebGLRenderer,
    camara: PerspectiveCamera | OrthographicCamera,
    px: number,
    py: number,
    ancho: number,
    alto: number,
  ): number | null {
    const conFdi = this.capas.filter((c) => c.conFdi && c.encendida);
    if (conFdi.length === 0) return null;
    this.objetivo ??= new WebGLRenderTarget(1, 1);

    // Se apaga TODO lo que no lleva FDI. Si no, una capa de densidad se dibuja con su
    // material normal encima y el pixel leido es su falso color, no un codigo de pieza.
    const visibles = new Map<string, boolean>();
    const materiales = new Map<string, ShaderMaterial>();
    for (const [id, p] of this.nubes) {
      visibles.set(id, p.visible);
      const c = this.capas.find((x) => x.id === id);
      // Se mira `encendida` y no `p.visible`: la capa de apariencia esta encendida en el
      // panel y su geometria es invisible a proposito, porque la dibuja el rasterizador.
      if (!c?.conFdi || !c.encendida) { p.visible = false; continue; }
      p.visible = true;
      const m = p.material as ShaderMaterial;
      materiales.set(id, m);
      p.material = new ShaderMaterial({
        uniforms: {
          escala: { value: m.uniforms['escala']!.value },
          tope: { value: m.uniforms['tope']!.value },
          perspectiva: { value: m.uniforms['perspectiva']!.value },
          umbral: { value: this.umbral },
        },
        vertexShader: VERT_AP,
        fragmentShader: FRAG_PICK,
        // Sin mezcla y CON profundidad: es lo que hace que gane la de delante.
        transparent: false,
        depthTest: true,
        depthWrite: true,
      });
    }

    const antes = renderer.getRenderTarget();
    let leido = 0;
    try {
      camara.setViewOffset(ancho, alto, px, py, 1, 1);
      renderer.setRenderTarget(this.objetivo);
      renderer.setClearColor(0x000000, 1);
      renderer.clear();
      renderer.render(this.scene, camara);
      renderer.readRenderTargetPixels(this.objetivo, 0, 0, 1, 1, this.pixel);
      leido = this.pixel[0] ?? 0;
    } finally {
      camara.clearViewOffset();
      renderer.setRenderTarget(antes);
      for (const [id, p] of this.nubes) {
        const m = materiales.get(id);
        if (m) {
          (p.material as ShaderMaterial).dispose();
          p.material = m;
        }
        p.visible = visibles.get(id) ?? p.visible;
      }
    }
    return leido > 0 ? leido : null;
  }

  enciende(id: string, visible: boolean): void {
    const p = this.nubes.get(id);
    if (!p) return;
    const c = this.capas.find((x) => x.id === id);
    if (c) c.encendida = visible;
    // Una capa de solo-seleccion NO se hace visible nunca: encenderla aqui la dibujaria
    // como sprites ENCIMA de la version bien rasterizada, que es peor que no dibujarla.
    p.visible = visible && !(c?.soloSeleccion ?? false);
  }

  /**
   * Actualiza la escala de proyección. Se llama en cada fotograma.
   *
   * No se puede calcular una vez en el constructor: el `fov` lo cambia cada vista
   * guardada del §7 y el alto del lienzo cambia al redimensionar la ventana. Con una
   * escala congelada, los splats quedarían del tamaño de otra cámara.
   */
  sincroniza(alturaPx: number, camara: PerspectiveCamera | OrthographicCamera): void {
    // ⚠️ **`alturaPx` es del BUFFER DE DIBUJO, no del CSS.** `gl_PointSize` va en pixeles
    // de dispositivo: pasando el alto en pixeles CSS, en una pantalla HiDPI los splats
    // salian a la mitad de su tamano.
    const orto = (camara as OrthographicCamera).isOrthographicCamera === true;
    // En perspectiva, un radio r a distancia d ocupa `escala * r / d` pixeles. En
    // ortografica no hay distancia: el frustum entero mide `top - bottom` en unidades de
    // mundo y se reparte en `alturaPx`, asi que la escala es constante.
    const escala = orto
      ? (alturaPx * (camara as OrthographicCamera).zoom)
        / ((camara as OrthographicCamera).top - (camara as OrthographicCamera).bottom)
      : alturaPx / (2 * Math.tan(((camara as PerspectiveCamera).fov / 2) * (Math.PI / 180)));
    for (const p of this.nubes.values()) {
      const u = (p.material as ShaderMaterial).uniforms;
      u['escala']!.value = escala;
      if (u['perspectiva']) u['perspectiva'].value = orto ? 0.0 : 1.0;
    }
  }

  /**
   * El corte de neblina de las capas de apariencia. Display, no dato: no viaja al `.uos`.
   *
   * Se expone porque el valor bueno se encuentra MIRANDO, que es como se encontro en el
   * otro visor del proyecto. Un numero fijo aqui seria el de este caso y de ningun otro.
   */
  ponUmbralAlfa(u: number): void {
    this.umbral = u;
    for (const p of this.nubes.values()) {
      const uni = (p.material as ShaderMaterial).uniforms['umbral'];
      if (uni) uni.value = u;
    }
  }

  get umbralAlfa(): number {
    return this.umbral;
  }

  /**
   * La ganancia de visualizacion del campo de DENSIDAD. Ver `GANANCIA_DISPLAY`.
   *
   * ⚠️ El `!` que habia aqui reventaba —«cannot set properties of undefined»— en cuanto el
   * contenedor traia una capa de apariencia: su material no tiene `ganancia`, porque su
   * alfa es opacidad aprendida y no una sigma que haya que amplificar para verla. Bastaba
   * mover el deslizador con un `.uos` con apariencia abierto.
   */
  ponGanancia(g: number): void {
    for (const p of this.nubes.values()) {
      const u = (p.material as ShaderMaterial).uniforms['ganancia'];
      if (u) u.value = g;
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
    this.resaltada = null;
  }
}
