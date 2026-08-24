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
 */

import {
  AmbientLight,
  Box3,
  BufferGeometry,
  BufferAttribute,
  DirectionalLight,
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

  constructor(private readonly lienzo: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas: lienzo, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.camera = new PerspectiveCamera(FOV_GRADOS, 1, 0.1, 5000);
    this.scene.add(new AmbientLight(0xffffff, 1.4));
    // Dos luces opuestas: con `DoubleSide`, la cara interior de la bóveda tiene la normal
    // mirando al lado contrario que la exterior, así que una sola direccional la deja a
    // oscuras y el agujero seguiría pareciendo un agujero.
    for (const d of [
      [1, 1, 1],
      [-1, -1, -1],
    ] as const) {
      const luz = new DirectionalLight(0xffffff, 0.8);
      luz.position.set(d[0], d[1], d[2]);
      this.scene.add(luz);
    }

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
    const color = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const fdi = etiquetas[i]!;
      // Sin etiqueta se queda el gris del material: NO se le inventa un color, porque un
      // vértice sin asignar no es una pieza más.
      const c: [number, number, number] = fdi > 0 ? colorDe(fdi) : [0.85, 0.83, 0.8];
      color[i * 3] = c[0];
      color[i * 3 + 1] = c[1];
      color[i * 3 + 2] = c[2];
    }
    this.malla.geometry.setAttribute('color', new BufferAttribute(color, 3));
  }

  /** Enciende o apaga el falso color de la segmentación. */
  muestraEtiquetas(visible: boolean): void {
    if (!this.malla || !this.etiquetas) return;
    const m = this.malla.material as MeshStandardMaterial;
    m.vertexColors = visible;
    m.needsUpdate = true;
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
