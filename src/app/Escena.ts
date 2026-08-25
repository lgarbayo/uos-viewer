/**
 * El paso de MALLA del §11.2: geometría opaca, material clínico neutro, escribe depth.
 *
 * Es el primero de los cuatro pasos que el spec describe, y a propósito el único que hay
 * hoy. Los otros tres —volumen por raycast, splats, overlays MPR— dependen de él: el paso
 * de volumen tiene que leer *su* depth buffer para terminar los rayos en las superficies,
 * así que sin malla no hay contra qué componer.
 *
 * ⚠️ **Material neutro, no bonito.** Un material con color propio o con reflejos fuertes
 * inventa relieve donde no lo hay: en una malla de escáner intraoral, un especular mal
 * puesto se lee como una fisura. Gris mate, luz difusa y el color de verdad —cuando lo
 * haya— llegará por la capa de apariencia.
 *
 * ⚠️ **Y el color anatómico —diente hueso, encía rosa— NO es color medido.** Sale de las
 * etiquetas de `derived/`, que son inferencia (Layer 3). Es el modo más peligroso de los
 * tres justamente porque es el que MEJOR se ve: un falso color chillón se lee como lo que
 * es, y un rosa creíble se lee como si el escáner lo hubiera medido. Un escáner intraoral
 * sí puede medir color —el caso Bite2Text del otro visor lo hace, muestreando las fotos
 * intraorales— pero un STL no lo lleva, y este contenedor viene de un STL. Por eso el modo
 * se declara en el panel y no se presenta como si viniera del paciente.
 */

import {
  AmbientLight,
  Box3,
  BufferGeometry,
  BufferAttribute,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  DoubleSide,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  Vector3,
  Raycaster,
  Vector2,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import { colorDe } from '../uos/Derivados';

/**
 * Cómo se pinta la malla.
 *
 * - `neutro`: el gris del material. Lo único que no afirma nada, y lo que queda cuando el
 *   contenedor no trae `derived/` — que es legal y frecuente: la capa es strippable.
 * - `anatomico`: la arcada entera en marfil, sin distinguir encía. Ver `COLOR_MARFIL`.
 * - `segmentacion`: un tono por código FDI. Feo a propósito: es falso color y lo parece.
 */
export type ModoColor = 'neutro' | 'anatomico' | 'segmentacion';

/**
 * Marfil: hueso cálido, no blanco. Un diente blanco puro sólo existe blanqueado.
 *
 * ⚠️ **Y la encía va del mismo color a propósito.** Había un coral para la encía, y
 * pintar dos colores es afirmar que se sabe dónde acaba uno y empieza el otro. Hoy no se
 * sabe: medido sobre un caso real, 11 de las 14 piezas se pasan de su caja anatómica
 * porque la corona se come el margen gingival, así que el rosa no dibujaba la encía —
 * dibujaba el error de la segmentación, y al revés (la encía comida salía color diente).
 * Ver `docs/research/segmentacion-fdi-escaner.md` del monorepo.
 *
 * Un solo tono no afirma ninguna frontera. Cuando la frontera esté medida —del color de
 * la fotografía clínica, no de la geometría— volverá el segundo color, y entonces
 * significará algo. El modo `segmentacion` sigue enseñando la verdad sin maquillar.
 */
const COLOR_MARFIL: [number, number, number] = [0.925, 0.894, 0.824];
/** Lo que la segmentación no asignó. Ni diente ni encía: se queda neutro y se nota. */
const COLOR_SIN_ASIGNAR: [number, number, number] = [0.85, 0.83, 0.8];
/**
 * Cuánto se apaga lo que no es la pieza resaltada.
 *
 * ⚠️ Estaba en 0,34 y era demasiado: la arcada entera se iba a un gris plano y dejaba de
 * leerse como anatomía, hasta el punto de parecer un fallo de iluminación. Lo que hace
 * falta es que la pieza destaque, no que el resto desaparezca — el clínico mira una pieza
 * EN una boca, y el contexto es la mitad de la información.
 */
const APAGADO = 0.62;

/** El del spec (§7) y el de la distancia que declaran las vistas. */
export const FOV_GRADOS = 35;

export class Escena {
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  private readonly renderer: WebGLRenderer;
  private readonly controles: OrbitControls;
  private readonly rayo = new Raycaster();
  private malla: Mesh | null = null;
  private etiquetas: Int16Array | null = null;
  private modo: ModoColor = 'anatomico';
  private resaltada: number | null = null;

  constructor(private readonly lienzo: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas: lienzo, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.camera = new PerspectiveCamera(FOV_GRADOS, 1, 0.1, 5000);
    // ⚠️ **Las luces van pegadas a la CÁMARA, no al mundo.** Antes había dos
    // direccionales en `(1,1,1)` y `(-1,-1,-1)`, que son opuestas y por tanto **el mismo
    // eje**: todo lo que tuviera la normal perpendicular a él —o sea un anillo entero de
    // orientaciones— no recibía luz de ninguna y se quedaba con el ambiente a secas. En
    // una arcada eso es casi todo: los incisivos centrales miraban por casualidad hacia
    // ese eje y salían blancos, y los premolares y molares salían gris oscuro. Se leía
    // como que el color no distinguía diente de encía, y lo que no había era luz.
    //
    // Con la luz solidaria a la cámara, lo que miras está iluminado se mire desde donde
    // se mire. Y con `DoubleSide` vale también para la cara interior de la bóveda, porque
    // three invierte la normal al sombrear una cara trasera.
    this.scene.add(new AmbientLight(0xffffff, 0.55));
    // Cielo/suelo: da una caída suave que un ambiente plano no da, y evita que las caras
    // que miran hacia abajo queden del mismo tono exacto que las que miran hacia arriba.
    this.scene.add(new HemisphereLight(0xdfe7f2, 0x4a4038, 0.75));
    // Principal ligeramente descentrada: puesta justo en el eje de la cámara aplanaría el
    // relieve, que en una superficie oclusal es justo lo que hay que ver.
    const principal = new DirectionalLight(0xffffff, 1.05);
    principal.position.set(-0.45, 0.7, 1);
    this.camera.add(principal);
    const relleno = new DirectionalLight(0xffffff, 0.35);
    relleno.position.set(0.8, -0.4, 0.6);
    this.camera.add(relleno);
    // La cámara tiene que estar EN la escena o sus hijas no se recorren al renderizar.
    this.scene.add(this.camera);

    // ⚠️ La orbita gira alrededor de `camera.up`, y ese vector lo pone cada VISTA: las del
    // `.uos` traen el eje superior medido de las etiquetas FDI. Sin esto se orbitaria
    // alrededor del eje del mundo, y en una arcada cuyo eje oclusal no coincida con el, la
    // camara no da la vuelta: la vuelca.
    this.controles = new OrbitControls(this.camera, lienzo);
    this.controles.enableDamping = true;
    this.controles.dampingFactor = 0.08;
    // Sin esto el zoom depende de a que distancia estuviera la camara, y en una arcada de
    // 90 mm mirada desde 95 cada rueda salta demasiado.
    this.controles.zoomToCursor = true;
    this.controles.panSpeed = 0.8;

    this.redimensiona();
    addEventListener('resize', () => this.redimensiona());
  }

  /** Pone la malla en escena. Sustituye a la anterior: un caso, una geometría. */
  ponMalla(geometria: BufferGeometry): void {
    if (this.malla) {
      this.scene.remove(this.malla);
      this.malla.geometry.dispose();
    }
    // Sólo si no vienen: el glTF las trae y recalcularlas las sustituiría por las de
    // caras, que en una malla de escáner suaviza detalle real.
    if (!geometria.getAttribute('normal')) geometria.computeVertexNormals();
    this.etiquetas = null;
    // ⚠️ `DoubleSide`, y no es cosmética. Una malla de escáner intraoral es una CÁSCARA
    // abierta, no un sólido cerrado: mirando un maxilar desde oclusal se ve la cara
    // interior de la bóveda palatina, y con el `FrontSide` que trae `three` por defecto
    // esas caras se descartan. El resultado es un agujero negro justo en el centro de la
    // arcada, que parece «el paladar no está en el fichero» cuando sí está — medido, 7.585
    // vértices. Un fallo de render que se lee como un fallo de dato es de los caros.
    this.malla = new Mesh(
      geometria,
      new MeshStandardMaterial({
        color: 0xd8d4cc,
        roughness: 0.85,
        metalness: 0.0,
        side: DoubleSide,
      }),
    );
    this.scene.add(this.malla);
  }

  /**
   * Aplica una vista guardada (§7). `position`, `target` y `up` vienen en el marco
   * canónico y en milímetros, así que se usan tal cual: convertirlos sería la ocasión de
   * equivocarse de marco.
   */
  aplicaVista(v: {
    position: readonly number[];
    target: readonly number[];
    up: readonly number[];
    fov?: number;
  }): void {
    this.camera.position.set(v.position[0]!, v.position[1]!, v.position[2]!);
    this.camera.up.set(v.up[0]!, v.up[1]!, v.up[2]!);
    this.camera.lookAt(new Vector3(v.target[0]!, v.target[1]!, v.target[2]!));
    if (v.fov) {
      this.camera.fov = v.fov;
      this.camera.updateProjectionMatrix();
    }
    // El pivote de la orbita pasa a ser lo que la vista mira. Si no, seguir orbitando
    // despues de saltar a una pieza giraria alrededor del centro de la arcada y la pieza
    // se escaparia de cuadro al primer arrastre.
    this.controles.target.set(v.target[0]!, v.target[1]!, v.target[2]!);
    this.controles.update();
  }

  /** Encuadre de emergencia cuando el contenedor no trae vistas. */
  encuadraTodo(): void {
    if (!this.malla) return;
    const caja = new Box3().setFromObject(this.malla);
    const centro = caja.getCenter(new Vector3());
    const radio = caja.getSize(new Vector3()).length() / 2;
    const d = radio / Math.tan((this.camera.fov / 2) * (Math.PI / 180));
    this.camera.position.copy(centro).add(new Vector3(0, 0, d * 1.2));
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(centro);
    this.controles.target.copy(centro);
    this.controles.update();
  }

  /**
   * Cuelga la segmentación de `derived/` sobre la escena, por índice de vértice.
   *
   * ⚠️ **Apagada por defecto** (§5.5). Se guarda el array pero no se pinta hasta que
   * alguien lo pida: una segmentación encima de la anatomía sin decir que es inferencia se
   * lee como si fuera medida.
   */
  ponEtiquetas(etiquetas: Int16Array): void {
    if (!this.malla) return;
    const n = this.malla.geometry.getAttribute('position').count;
    if (etiquetas.length !== n) {
      throw new Error(
        `La segmentación trae ${etiquetas.length} códigos y la escena ${n} vértices: ` +
          'no se pueden cruzar por índice.',
      );
    }
    this.etiquetas = etiquetas;
    this.repinta();
  }

  /** Cambia el modo de color. `neutro` vuelve al gris del material. */
  ponModo(modo: ModoColor): void {
    this.modo = modo;
    this.repinta();
  }

  /**
   * Enciende una pieza y apaga el resto. `null` las devuelve todas.
   *
   * ⚠️ Apagar en vez de rodear con un borde es una decisión, no una preferencia estética:
   * el contorno de un diente sobre una malla de escáner cae en el margen gingival, que es
   * justo la frontera clínica que interesa mirar. Un borde dibujado encima la tapa; bajar
   * el brillo de lo demás la deja intacta.
   */
  resalta(fdi: number | null): void {
    this.resaltada = fdi;
    this.repinta();
  }

  private repinta(): void {
    if (!this.malla) return;
    const material = this.malla.material as MeshStandardMaterial;
    const etq = this.etiquetas;
    if (!etq || this.modo === 'neutro') {
      material.vertexColors = false;
      material.needsUpdate = true;
      return;
    }
    const n = this.malla.geometry.getAttribute('position').count;
    const color = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const fdi = etq[i]!;
      // Sin etiqueta NO se inventa nada: un vértice sin asignar no es una pieza más, y en
      // modo anatómico tampoco es encía — la encía es lo que la segmentación llama encía.
      let c: [number, number, number] =
        this.modo === 'anatomico'
          ? COLOR_MARFIL
          : fdi > 0
            ? colorDe(fdi)
            : COLOR_SIN_ASIGNAR;
      if (this.resaltada !== null && fdi !== this.resaltada) {
        c = [c[0] * APAGADO, c[1] * APAGADO, c[2] * APAGADO];
      }
      color[i * 3] = c[0];
      color[i * 3 + 1] = c[1];
      color[i * 3 + 2] = c[2];
    }
    this.malla.geometry.setAttribute('color', new BufferAttribute(color, 3));
    material.vertexColors = true;
    material.needsUpdate = true;
  }

  /**
   * Qué pieza hay bajo el cursor, o `null`. Raycast contra la malla, que es lo que el
   * §11.3 pide: el picking se resuelve sobre la GEOMETRÍA, no sobre una lista de
   * centroides proyectados.
   */
  pieza(x: number, y: number): number | null {
    if (!this.malla || !this.etiquetas) return null;
    const rect = this.lienzo.getBoundingClientRect();
    this.rayo.setFromCamera(
      new Vector2(((x - rect.left) / rect.width) * 2 - 1,
                  -((y - rect.top) / rect.height) * 2 + 1),
      this.camera,
    );
    const golpe = this.rayo.intersectObject(this.malla, false)[0];
    if (!golpe || golpe.face === undefined || golpe.face === null) return null;
    const fdi = this.etiquetas[golpe.face.a];
    return fdi !== undefined && fdi > 0 ? fdi : null;
  }

  dibuja(): void {
    this.controles.update();
    this.renderer.render(this.scene, this.camera);
  }

  private redimensiona(): void {
    const { clientWidth: w, clientHeight: h } = this.lienzo;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(h, 1);
    this.camera.updateProjectionMatrix();
  }
}
