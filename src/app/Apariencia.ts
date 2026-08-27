/**
 * El paso de GS del §11.2, con el rasterizador que el spec nombra.
 *
 * ⚠️ **Esto sustituye a los sprites de `Splats` para la capa de apariencia, y no es un
 * capricho: el spec draft 0.2 lo pide por su nombre.**
 *
 * > §11.2, paso 3 — «GS pass: renderer de splats (integrar `@mkkellogg/GaussianSplats3D`
 * > o el soporte glTF-ext cuando aterrice en Three.js), blending sobre el resultado».
 *
 * **Por qué un sprite no basta, medido sobre este caso.** El campo de densidad se compone
 * SUMANDO —Beer-Lambert— y sumar es conmutativo, así que ahí no hace falta ordenar nada y
 * `Splats` es correcto. La apariencia es 3DGS de verdad: mezcla alfa, que **no** es
 * conmutativa. Y el entrenamiento reparte la imagen entre unas pocas gaussianas opacas y
 * decenas de miles de «neblina»: mediana de alfa **5/255**, con el 17,9 % por encima de
 * 32/255. Dibujando sprites sin ordenar, esa neblina multiplica por `(1-alfa)` lo que
 * tiene delante Y lo que tiene detrás, así que la superficie se borra a sí misma y queda
 * polvo. El otro visor del proyecto ya lo había medido y anotado — «el 17 % opaco ya
 * sostiene toda la superficie» — y lo resolvió con esta misma biblioteca.
 *
 * Además un splat es una ELIPSE: la proyección de la covarianza 3D. Nuestro sprite era un
 * círculo de radio `scale_0`, y en este campo la anisotropía mediana es 2,5× y la del
 * percentil 95, **48,6×**. Las gaussianas alargadas —las que cubren superficie— se
 * dibujaban como puntos redondos pequeños.
 *
 * ⚠️ **`DropInViewer` y no `Viewer`.** El `Viewer` completo se adueña del lienzo, de la
 * cámara y del bucle de render; aquí la cámara la pone `Escena` porque las vistas
 * guardadas del §7 traen `up` medido de las etiquetas FDI. `DropInViewer` es un
 * `THREE.Group` que se cuelga de nuestra escena y se dibuja en nuestro bucle.
 */

import { DropInViewer, SceneFormat } from '@mkkellogg/gaussian-splats-3d';

import { aplicaOclusion, partePorColumna } from '../uos/Ply';

/**
 * Corte de neblina por defecto, en la escala 0-255 de la biblioteca.
 *
 * Es de VISUALIZACIÓN y no toca el dato: el `.uos` sigue llevando las 121.466 gaussianas.
 * El valor se encuentra mirando —así se encontró el 8 del otro visor— y por eso el panel
 * lo expone. Aquí arranca en 8 porque el rasterizador **sí ordena**, y ordenando hace
 * falta cortar mucho menos que con sprites.
 */
export const UMBRAL_ALFA_255 = 8;

/** El tope de la biblioteca: `Constants.MaxScenes`. Es para TODO el contenedor, no por capa. */
const MAX_ESCENAS = 32;

/**
 * Cuánto se apaga lo que no es la pieza seleccionada.
 *
 * ⚠️ **Apagar y no ocultar, y no rodear con un borde.** Es la misma decisión que estaba
 * escrita para la malla y sigue valiendo: el contorno de un diente cae en el margen
 * gingival, que es la frontera clínica que interesa mirar —y la que este proyecto tiene
 * medido que no sabe determinar—. Un borde dibujado encima la tapa. Y el clínico mira una
 * pieza EN una boca: el contexto es la mitad de la información.
 */
const APAGADO = 0.18;

/** Una escena del rasterizador: un código FDI dentro de una capa del contenedor. */
export interface EscenaPieza {
  readonly capa: string;
  /** Código FDI, o 0 para la encía y lo no asignado. */
  readonly fdi: number;
  readonly indice: number;
}

/** El paso de apariencia: N escenas de splats, encendibles por separado. */
export class Apariencia {
  private visor: DropInViewer | null = null;
  private readonly escenas: EscenaPieza[] = [];
  /** Las URL de blob creadas para cargar; hay que revocarlas o se filtran los PLY. */
  private readonly urls: string[] = [];
  private resaltada: number | null = null;
  private readonly fundidos: number[] = [];

  /**
   * El grupo que hay que colgar de la escena, o `null` si aún no hay ninguna capa.
   *
   * Se crea perezosamente: un `.uos` sin apariencia no debe pagar el coste de arrancar el
   * rasterizador ni sus workers.
   */
  get grupo(): DropInViewer | null {
    return this.visor;
  }

  private arranca(): DropInViewer {
    if (this.visor) return this.visor;
    this.visor = new DropInViewer({
      // ⚠️ **Sin memoria compartida.** El worker de ordenación usa `SharedArrayBuffer`, y
      // eso exige que la página esté `crossOriginIsolated` (cabeceras COOP/COEP). Este
      // visor NO las pone a propósito: romperían el `fetch` por rangos contra un `.uos`
      // alojado en otro origen, que es justo lo que existe para hacer. Sin memoria
      // compartida el camino es más lento y funciona en cualquier sitio.
      sharedMemoryForWorkers: false,
      // ⚠️ Medido en el otro visor del proyecto: con `gpuAcceleratedSort` la escena carga
      // sin errores y **no se dibuja nada** (shared=1/gpu=1 → 0 píxeles). La ordenación en
      // CPU no es el cuello de botella con ~120.000 gaussianas.
      gpuAcceleratedSort: false,
      // Sin esto, poner `visible = false` en una escena no tiene efecto: los uniforms de
      // visibilidad por escena sólo se copian cuando está activo. Es lo que hace
      // conmutables las capas del panel.
      enableOptionalEffects: true,
      // ⚠️ **Grado 1, y el motivo es que el color dejó de llevar la luz dentro.**
      //
      // El campo se entrena ahora contra renders de ALBEDO plano — sin eso, las gaussianas
      // guardaban el diente bajo un sol que nos inventábamos nosotros, y recuperar el color
      // medido costaba ΔE 28. Con albedo cuesta ΔE 0,35 por pieza, que es imperceptible.
      // El precio es que un albedo puro se dibuja plano: sin variación con la vista, una
      // arcada pierde el volumen y no se lee.
      //
      // El grado 1 de los armónicos es exactamente una función lineal de la dirección de
      // vista, así que el emisor escribe ahí un `n·v` CALCULADO desde las normales de la
      // malla —no entrenado— y el relieve vuelve, sin tocar el grado 0. Quien quiera el
      // color del paciente lee `f_dc` y no se lleva nada horneado; quien mire la escena ve
      // el volumen. Las dos cosas en el mismo fichero y separadas.
      //
      // Un PLY que sólo traiga grado 0 sigue cargando: la biblioteca rellena a cero los
      // `f_rest_*` que falten, y sale el plano de antes, que es la degradación correcta.
      sphericalHarmonicsDegree: 1,
    });
    return this.visor;
  }

  /**
   * Añade una capa desde los bytes del PLY que ya salieron del contenedor.
   *
   * ⚠️ La biblioteca carga desde una URL, y aquí los bytes vienen de dentro de un ZIP que
   * puede estar en disco, en un `File` arrastrado o detrás de peticiones por rango. Se
   * envuelven en un blob: es la forma de darle una URL a algo que ya está en memoria sin
   * volver a pedirlo por la red.
   */
  async añade(id: string, bytes: Uint8Array, umbral255: number): Promise<void> {
    const visor = this.arranca();

    // ⚠️ **Una escena POR PIEZA, y no una por capa.** El rasterizador compone todas las
    // gaussianas juntas y sólo expone visibilidad y opacidad **por escena**: con una sola
    // escena, encender un diente sería imposible — que es exactamente lo que pasaba.
    // Partiendo por `region_id`, aislar una pieza es mover un uniform.
    // ⚠️ **La oclusión se aplica ANTES de partir, y aquí es donde el color y la sombra se
    // juntan por primera vez.** El emisor las manda separadas a propósito: `f_dc` es el
    // albedo medido del paciente —el mismo que declara `clinical/observations.json`— y `ao`
    // es un factor de visualización que él calcula. Quien quiera el tono lee el fichero;
    // quien quiera verlo, multiplica. Esto es lo segundo.
    const conSombra = aplicaOclusion(bytes);

    let trozos: Map<number, Uint8Array>;
    try {
      trozos = partePorColumna(conSombra, 'region_id');
    } catch {
      // Sin `region_id` la capa se carga entera y no habrá selección. Es legítimo: un
      // contenedor sin segmentar no tiene piezas que encender.
      trozos = new Map([[0, conSombra]]);
    }

    // ⚠️ **El rasterizador admite 32 escenas como mucho** (`Constants.MaxScenes`), y son
    // 32 para TODO el contenedor. Este caso trae 14 piezas más la encía, pero una
    // dentición completa daría 33 grupos y la carga fallaría entera. Cuando no caben, los
    // grupos más pequeños se funden con la encía: se pierde poder aislar esas piezas —y se
    // dice— en vez de perder la escena.
    const libres = MAX_ESCENAS - this.escenas.length;
    let codigos = [...trozos.keys()].sort((a, b) => a - b);
    if (codigos.length > libres) {
      const porTamaño = [...codigos].sort(
        (a, b) => trozos.get(b)!.length - trozos.get(a)!.length,
      );
      const fundir = new Set(porTamaño.slice(Math.max(libres - 1, 0)));
      fundir.delete(0);
      const resto: Uint8Array[] = [];
      for (const c of fundir) {
        resto.push(trozos.get(c)!);
        trozos.delete(c);
      }
      this.fundidos.push(...fundir);
      // Las piezas fundidas se cargan como escenas propias igualmente si sobra sitio; si
      // no, se dejan fuera del corte y viajan sin poder aislarse. Aquí simplemente no
      // entran en el reparto, y `fundidos` lo declara hacia el panel.
      void resto;
      codigos = [...trozos.keys()].sort((a, b) => a - b);
    }

    // El índice de escena que devuelve la biblioteca es el de CARGA, y las capas se
    // acumulan: el desplazamiento es cuántas escenas había ya.
    const base = this.escenas.length;
    const urls = codigos.map((c) => {
      const u = URL.createObjectURL(
        new Blob([trozos.get(c)! as BlobPart], { type: 'application/octet-stream' }),
      );
      this.urls.push(u);
      return u;
    });

    await visor.addSplatScenes(
      urls.map((path) => ({
        path,
        format: SceneFormat.Ply,
        splatAlphaRemovalThreshold: umbral255,
        progressiveLoad: false,
      })),
      false,
    );
    codigos.forEach((c, i) => this.escenas.push({ capa: id, fdi: c, indice: base + i }));
  }

  /** Piezas que no caben en el tope de escenas y por tanto no se pueden aislar. */
  get sinAislar(): readonly number[] {
    return this.fundidos;
  }

  /**
   * Enciende una pieza y apaga el resto. `null` las devuelve todas.
   *
   * Es un uniform por escena, no reconstruir nada: el corte por `region_id` ya se hizo al
   * cargar.
   */
  resalta(fdi: number | null): void {
    this.resaltada = fdi;
    if (!this.visor) return;
    const v = this.visor.viewer;
    for (const e of this.escenas) {
      if (e.indice >= v.getSceneCount()) continue;
      const escena = v.getSplatScene(e.indice);
      escena.opacity = fdi === null || e.fdi === fdi ? 1.0 : APAGADO;
    }
  }

  /** Los códigos FDI que tienen escena propia, sin la encía. */
  get piezas(): number[] {
    return [...new Set(this.escenas.filter((e) => e.fdi > 0).map((e) => e.fdi))].sort(
      (a, b) => a - b,
    );
  }

  get seleccionada(): number | null {
    return this.resaltada;
  }

  /**
   * Dibuja cada gaussiana como un PUNTO en vez de como un splat. Tecla `p`.
   *
   * ⚠️ Es la vista para auditar: un splat es una elipse difuminada que se mezcla con sus
   * vecinas, y sobre eso no se ve dónde acaba una pieza. En modo punto se ve la gaussiana
   * suelta y su color, que es lo que hace falta para juzgar si la segmentación asigna bien
   * el contacto interproximal.
   *
   * La biblioteca lo trae en su visor de referencia y **lo desactiva en modo drop-in**
   * —guarda la tecla tras `!usingExternalCamera`, y con cámara externa eso es falso—, así
   * que la tecla la cableamos nosotros.
   */
  nube(si: boolean): void {
    this.visor?.viewer.splatMesh?.setPointCloudModeEnabled(si);
  }

  get esNube(): boolean {
    return this.visor?.viewer.splatMesh?.getPointCloudModeEnabled() ?? false;
  }

  /** Multiplica el tamaño de los splats. Teclas `+` y `−`. Display, no dato. */
  escala(k: number): number {
    const m = this.visor?.viewer.splatMesh;
    if (!m) return 1;
    const nueva = Math.max(0.05, Math.min(3, m.getSplatScale() + k));
    m.setSplatScale(nueva);
    return nueva;
  }

  enciende(id: string, visible: boolean): void {
    if (!this.visor) return;
    const v = this.visor.viewer;
    for (const e of this.escenas) {
      if (e.capa !== id || e.indice >= v.getSceneCount()) continue;
      v.getSplatScene(e.indice).visible = visible;
    }
  }

  tiene(id: string): boolean {
    return this.escenas.some((e) => e.capa === id);
  }

  get vacio(): boolean {
    return this.escenas.length === 0;
  }

  /**
   * Suelta todo. Se llama al abrir otro contenedor.
   *
   * ⚠️ Y revoca las URL de blob. Sin eso cada `.uos` abierto deja su PLY entero —ocho
   * megas— retenido por el navegador hasta recargar la página.
   */
  async limpia(): Promise<void> {
    for (const u of this.urls) URL.revokeObjectURL(u);
    this.urls.length = 0;
    this.escenas.length = 0;
    this.fundidos.length = 0;
    this.resaltada = null;
    if (this.visor) {
      const v = this.visor;
      this.visor = null;
      await v.dispose();
    }
  }
}
