/**
 * La CAMARA de la escena: proyeccion, orbita y encuadre. Nada mas.
 *
 * ⚠️ **Aqui ya no hay malla, y es una decision del formato, no una simplificacion.** El
 * spec describe cuatro pasos que empiezan por geometria opaca, y este visor los hacia asi:
 * `scene.glb` primero, gaussianas encima. Pero el contenedor de este proyecto lleva
 * **solo el campo gaussiano y el manifiesto** — el escaneo original y la malla convertida
 * viajan fuera, como assets externos nombrados por su sha256. Ensenar una malla que el
 * `.uos` no lleva era ensenar otra cosa distinta del modelo.
 *
 * La consecuencia esta asumida: un `.uos` que traiga `scene.glb` se abre igual, pero se ve
 * lo que traiga en gaussianas y no su malla.
 *
 * ⚠️ **Y la seleccion de piezas se mudo con ella.** Vivia aqui como un raycast contra los
 * triangulos; ahora vive en `Splats` como un pase de seleccion sobre las propias
 * gaussianas, contra la columna `region_id`. Ver `Splats.piezaEn`.
 */

import {
  Box3,
  OrthographicCamera,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';


/** El del spec (§7) y el de la distancia que declaran las vistas. */
export const FOV_GRADOS = 35;

export class Escena {
  readonly scene = new Scene();
  readonly renderer: WebGLRenderer;
  private readonly perspectiva: PerspectiveCamera;
  /**
   * La misma vista sin fuga de perspectiva.
   *
   * ⚠️ **No es cosmética: en perspectiva, dos dientes del mismo tamaño se dibujan
   * distintos según lo lejos que estén**, y comparar tamaños a ojo sobre una arcada es
   * justo lo que un clínico hace. El rasterizador de splats la soporta —lee
   * `camera.isOrthographicCamera` de la cámara que le pasamos cada fotograma— así que
   * cambiarla aquí basta para que los splats se proyecten bien.
   */
  private readonly ortografica: OrthographicCamera;
  private activa: PerspectiveCamera | OrthographicCamera;
  private controles: OrbitControls;
  /** Medio alto del frustum ortográfico, en mm. Lo fija `encuadraCaja`. */
  private medioAlto = 50;

  /** La cámara que se está usando. Cambia con `ponOrtografica`. */
  get camera(): PerspectiveCamera | OrthographicCamera {
    return this.activa;
  }

  get esOrtografica(): boolean {
    return this.activa === this.ortografica;
  }

  constructor(private readonly lienzo: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas: lienzo, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.perspectiva = new PerspectiveCamera(FOV_GRADOS, 1, 0.1, 5000);
    this.ortografica = new OrthographicCamera(-1, 1, 1, -1, 0.1, 5000);
    this.activa = this.perspectiva;
    // ⚠️ **Aqui ya no hay luces, y no es un descuido.** Habia tres —ambiente, hemisferio
    // y dos direccionales pegadas a la camara— y existian para la malla, que se sombreaba
    // con un `MeshStandardMaterial`. Sin malla no queda nada que iluminar: los splats
    // llevan su propio color y su propia opacidad, y un `ShaderMaterial` no lee luces.
    // Dejarlas seria pagar su coste cada fotograma para no cambiar un pixel.

    // ⚠️ La orbita gira alrededor de `camera.up`, y ese vector lo pone cada VISTA: las del
    // `.uos` traen el eje superior medido de las etiquetas FDI. Sin esto se orbitaria
    // alrededor del eje del mundo, y en una arcada cuyo eje oclusal no coincida con el, la
    // camara no da la vuelta: la vuelca.
    this.controles = this.creaControles();
    // Sin esto el zoom depende de a que distancia estuviera la camara, y en una arcada de
    // 90 mm mirada desde 95 cada rueda salta demasiado.

    this.redimensiona();
    addEventListener('resize', () => this.redimensiona());
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
    // El `fov` de una vista guardada es de la cámara en perspectiva; en ortográfica no
    // existe, pero se guarda para que volver a perspectiva lo recupere.
    if (v.fov) {
      this.perspectiva.fov = v.fov;
      this.perspectiva.updateProjectionMatrix();
      this.redimensiona();
    }
    // El pivote de la orbita pasa a ser lo que la vista mira. Si no, seguir orbitando
    // despues de saltar a una pieza giraria alrededor del centro de la arcada y la pieza
    // se escaparia de cuadro al primer arrastre.
    this.controles.target.set(v.target[0]!, v.target[1]!, v.target[2]!);
    this.controles.update();
  }

  /**
   * Encuadra la cámara sobre una caja cualquiera.
   *
   * Es el unico encuadre que hay: lo que se encuadra es la nube de gaussianas, porque
   * es lo unico que el contenedor lleva.
   */
  encuadraCaja(caja: Box3): void {
    const centro = caja.getCenter(new Vector3());
    const radio = caja.getSize(new Vector3()).length() / 2;
    // La distancia se calcula SIEMPRE con el fov de la perspectiva: en ortográfica la
    // cámara no se acerca ni se aleja —el encuadre lo da el frustum— pero conviene dejarla
    // a la misma distancia para que alternar entre las dos no dé un salto.
    const d = radio / Math.tan((this.perspectiva.fov / 2) * (Math.PI / 180));
    this.medioAlto = radio * 1.15;
    this.camera.position.copy(centro).add(new Vector3(0, 0, d * 1.2));
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(centro);
    this.controles.target.copy(centro);
    this.controles.update();
  }

  dibuja(): void {
    this.controles.update();
    this.renderer.render(this.scene, this.camera);
  }

  private redimensiona(): void {
    const { clientWidth: w, clientHeight: h } = this.lienzo;
    this.renderer.setSize(w, h, false);
    const aspecto = w / Math.max(h, 1);
    this.perspectiva.aspect = aspecto;
    this.perspectiva.updateProjectionMatrix();
    // El frustum ortográfico se deriva del encuadre: `medioAlto` lo fija `encuadraCaja`,
    // que es lo único que sabe de qué tamaño es lo que hay delante.
    this.ortografica.top = this.medioAlto;
    this.ortografica.bottom = -this.medioAlto;
    this.ortografica.left = -this.medioAlto * aspecto;
    this.ortografica.right = this.medioAlto * aspecto;
    this.ortografica.updateProjectionMatrix();
  }

  /** Los controles se atan a UNA cámara: cambiarla obliga a rehacerlos, conservando el pivote. */
  private creaControles(): OrbitControls {
    const c = new OrbitControls(this.activa, this.lienzo);
    c.enableDamping = true;
    c.dampingFactor = 0.08;
    c.zoomToCursor = true;
    c.panSpeed = 0.8;
    return c;
  }

  /**
   * Cambia entre perspectiva y ortográfica conservando de dónde se mira y hacia dónde.
   *
   * ⚠️ El rasterizador de splats lee `isOrthographicCamera` de la cámara que le llega en
   * cada `onBeforeRender`, así que no hay que avisarle: cambiar la cámara aquí basta.
   */
  ponOrtografica(si: boolean): void {
    const destino = si ? this.ortografica : this.perspectiva;
    if (destino === this.activa) return;
    destino.position.copy(this.activa.position);
    destino.quaternion.copy(this.activa.quaternion);
    destino.up.copy(this.activa.up);
    const pivote = this.controles.target.clone();
    this.activa = destino;
    this.controles.dispose();
    this.controles = this.creaControles();
    this.controles.target.copy(pivote);
    this.redimensiona();
    this.controles.update();
  }
}
