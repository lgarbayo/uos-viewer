/**
 * Declaraciones para @mkkellogg/gaussian-splats-3d 0.4.7.
 *
 * El paquete no publica tipos (`"types"` ausente en su package.json), asi que
 * se declara aqui la superficie que usamos. Contrastado con su README y con los
 * `export {...}` del bundle ESM, no inventado.
 */
declare module '@mkkellogg/gaussian-splats-3d' {
  import type { Camera, Group, Scene, WebGLRenderer } from 'three';

  export type Vec3 = [number, number, number];
  export type Quat = [number, number, number, number];

  export enum SceneFormat {
    Ply = 0,
    Splat = 1,
    KSplat = 2,
  }

  export enum SceneRevealMode {
    Default = 0,
    Gradual = 1,
    Instant = 2,
  }

  export interface ViewerOptions {
    /** Eje 'arriba' de la escena: el eje sobre el que orbita la camara. */
    cameraUp?: Vec3;
    initialCameraPosition?: Vec3;
    initialCameraLookAt?: Vec3;
    /** Grado de armonicos esfericos a cargar. Nuestro campo es de grado 0. */
    sphericalHarmonicsDegree?: 0 | 1 | 2;
    rootElement?: HTMLElement;
    selfDrivenMode?: boolean;
    useBuiltInControls?: boolean;
    /**
     * Usa SharedArrayBuffer para hablar con el worker de ordenacion. Exige que
     * la pagina este cross-origin isolated (cabeceras COOP/COEP). Por defecto true.
     */
    sharedMemoryForWorkers?: boolean;
    /** Recomendado solo si `sharedMemoryForWorkers` es true. */
    gpuAcceleratedSort?: boolean;
    sceneRevealMode?: SceneRevealMode;
    antialiased?: boolean;
    /**
     * Habilita los uniforms opcionales por escena (`sceneOpacity`,
     * `sceneVisibility`). SIN esto, poner `visible = false` en una escena no
     * tiene efecto: el bundle solo copia esos uniforms si esta activo
     * (`updateUniforms`, guardado tras `if (this.enableOptionalEffects)`).
     */
    enableOptionalEffects?: boolean;
    camera?: Camera;
    renderer?: WebGLRenderer;
    threeScene?: Scene;
  }

  export interface SplatSceneOptions {
    format?: SceneFormat;
    /** Descarta splats con alfa por debajo del umbral (0-255). */
    splatAlphaRemovalThreshold?: number;
    showLoadingUI?: boolean;
    position?: Vec3;
    rotation?: Quat;
    scale?: Vec3;
    progressiveLoad?: boolean;
    onProgress?: (percent: number, message: string, stage: unknown) => void;
  }

  /** Una escena cargada dentro del visor: una capa, en nuestro uso. */
  export interface SplatScene {
    visible: boolean;
    opacity: number;
  }

  /**
   * La malla que agrupa TODAS las gaussianas de todas las escenas.
   *
   * Se llega a ella para las teclas del visor de referencia, que en modo drop-in la
   * biblioteca desactiva: su manejador las guarda tras `!usingExternalCamera`, y en
   * drop-in eso es siempre falso porque la camara la pone el anfitrion.
   */
  export interface SplatMesh {
    /** Dibuja cada gaussiana como un punto en vez de como un splat. */
    setPointCloudModeEnabled(enabled: boolean): void;
    getPointCloudModeEnabled(): boolean;
    /** Multiplica el tamano de todos los splats. 1 = el declarado. */
    setSplatScale(scale: number): void;
    getSplatScale(): number;
  }

  export class Viewer {
    constructor(options?: ViewerOptions);
    addSplatScene(path: string, options?: SplatSceneOptions): Promise<void>;
    start(): void;
    stop(): void;
    dispose(): Promise<void>;
    getSplatCount?(): number;
    getSceneCount(): number;
    getSplatScene(sceneIndex: number): SplatScene;
    readonly splatMesh: SplatMesh | null;
    camera: Camera;
    /**
     * Pixeles fisicos por pixel CSS que la biblioteca usa para el FOCAL del shader,
     * leido en vivo en cada fotograma. ⚠️ NO se debe cambiar despues de cargar escenas:
     * el `SplatMesh` cachea su propio valor al construirse y con el calcula el
     * `viewport`, asi que cambiarlo aqui desincroniza focal y viewport y los splats
     * salen al doble (o a la mitad) de su tamano. Este visor no hace supersampling de
     * display (medido: sin efecto visible para este contenido); el valor se queda en
     * `window.devicePixelRatio`.
     */
    devicePixelRatio: number;
  }

  /**
   * El visor envuelto en un `THREE.Group`, para colgarlo de una escena propia.
   *
   * ⚠️ Es lo que permite que la CAMARA siga siendo nuestra. El `Viewer` completo se adueña
   * del lienzo, de la camara y del bucle de render; aqui la camara la pone `Escena`, que
   * es quien aplica las vistas guardadas del §7 con su `up` medido. `DropInViewer` fuerza
   * `selfDrivenMode: false` y `useBuiltInControls: false` y se dibuja en nuestro bucle a
   * traves de un `onBeforeRender` sobre una malla de callback.
   *
   * Expone `viewer` porque encender y apagar capas se hace sobre el `Viewer` de dentro
   * (`getSplatScene(i).visible`), y el envoltorio no lo reexporta.
   */
  export class DropInViewer extends Group {
    constructor(options?: ViewerOptions);
    addSplatScene(path: string, options?: SplatSceneOptions): Promise<void>;
    addSplatScenes(scenes: (SplatSceneOptions & { path: string })[], showLoadingUI?: boolean): Promise<void>;
    dispose(): Promise<void>;
    readonly viewer: Viewer;
  }
}
