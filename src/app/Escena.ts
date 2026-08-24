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
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';

/** El del spec (§7) y el de la distancia que declaran las vistas. */
export const FOV_GRADOS = 35;

export class Escena {
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  private readonly renderer: WebGLRenderer;
  private malla: Mesh | null = null;

  constructor(private readonly lienzo: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas: lienzo, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.camera = new PerspectiveCamera(FOV_GRADOS, 1, 0.1, 5000);
    this.scene.add(new AmbientLight(0xffffff, 1.4));
    const luz = new DirectionalLight(0xffffff, 1.1);
    luz.position.set(1, 1, 1);
    this.scene.add(luz);
    this.redimensiona();
    addEventListener('resize', () => this.redimensiona());
  }

  /** Pone la malla en escena. Sustituye a la anterior: un caso, una geometría. */
  ponMalla(geometria: BufferGeometry): void {
    if (this.malla) {
      this.scene.remove(this.malla);
      this.malla.geometry.dispose();
    }
    geometria.computeVertexNormals();
    this.malla = new Mesh(
      geometria,
      new MeshStandardMaterial({ color: 0xd8d4cc, roughness: 0.85, metalness: 0.0 }),
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
  }

  dibuja(): void {
    this.renderer.render(this.scene, this.camera);
  }

  private redimensiona(): void {
    const { clientWidth: w, clientHeight: h } = this.lienzo;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(h, 1);
    this.camera.updateProjectionMatrix();
  }
}
