/**
 * El render, entero, detrás de un constructor y un `dispose`.
 *
 * ⚠️ **React pinta la interfaz y NADA del render.** `Escena`, `Splats` y `Apariencia` siguen
 * siendo las clases imperativas de siempre —sin react-three-fiber—, y esta clase es la
 * única costura entre los dos mundos: React la crea en un efecto y la libera en la limpieza
 * de ese efecto. Lo que se dibuja y cómo se dibuja no cambia por estar dentro de React.
 *
 * ⚠️ **El lienzo lo crea ESTA clase, no JSX.** El modo estricto de React monta, desmonta y
 * vuelve a montar cada efecto en desarrollo, y el `<canvas>` de un JSX sería el mismo nodo
 * las dos veces. Un lienzo cuyo contexto se perdió —que es como `Escena.dispose` lo
 * suelta— devuelve a `getContext` ese mismo contexto perdido, así que el segundo montaje
 * arrancaría sobre un contexto muerto. Un lienzo por montaje evita la trampa entera.
 */

import type { UosLoader } from '../uos/UosLoader';
import { leeEtiquetas } from '../uos/Etiquetas';
import { leeGlb } from '../uos/Glb';
import { leePly } from '../uos/Ply';
import { campoDesdeSplats, plyDesdeCampo } from '../uos/SplatsKhr';
import { Apariencia, UMBRAL_ALFA_255 } from './Apariencia';
import { Escena } from './Escena';
import { Splats } from './Splats';

/**
 * Una columna del campo, tal y como la declara el sidecar.
 *
 * ⚠️ **Es la fuente de procedencia de las etiquetas que se dibujan.** Lo que dice de sí
 * misma la columna `region_id` (`measured`, `derived_from`, `vocabulary`) es lo que la
 * interfaz tiene que enseñar: sin eso, unas etiquetas de inferencia se leerían como medidas.
 */
export interface ColumnaGS {
  readonly name?: string;
  readonly unit?: string;
  readonly measured?: boolean;
  readonly derived_from?: string | null;
  readonly meaning?: string;
  readonly vocabulary?: string | null;
}

interface DescriptorGS {
  readonly role?: string;
  readonly measured?: boolean;
  readonly note?: string;
  readonly profile?: string;
  readonly n_primitives?: number;
  readonly columns?: readonly ColumnaGS[];
}

/** Falso color por capa del campo de DENSIDAD. NO significa tejido: distingue capas. */
const TONOS: Record<string, [number, number, number]> = {
  'asset.field': [0.35, 0.62, 0.95],
  'asset.composite': [0.95, 0.72, 0.35],
  'asset.gs': [0.55, 0.9, 0.65],
  'asset.apariencia': [1.0, 1.0, 1.0],
};

const PERFILES_DENSIDAD = ['ash-twin/1.0', 'histora-twin/1.0', 'histora-twin-fitted/1.0'];
const PERFILES_APARIENCIA = ['ash-gs-apariencia/1.0', 'histora-gs-appearance/1.0'];

/** Lo que una carga deja dicho para la interfaz. */
export interface ResultadoCapas {
  readonly avisos: string[];
  readonly region: ColumnaGS | null;
}

/** Se lanza cuando el visor se desmontó con una carga en vuelo. No es un fallo del `.uos`. */
export class VisorLiberado extends Error {
  constructor() {
    super('el visor se desmontó durante la carga');
    this.name = 'VisorLiberado';
  }
}

export class Visor {
  readonly lienzo: HTMLCanvasElement;
  readonly escena: Escena;
  readonly splats: Splats;
  /**
   * El paso de GS del §11.2 con el rasterizador que el spec nombra.
   *
   * ⚠️ **Convive con `Splats`, y cada uno hace una cosa distinta.** `Apariencia` DIBUJA la
   * capa de apariencia —splats elípticos, ordenados por profundidad, que es lo que un 3DGS
   * necesita—. `Splats` dibuja el campo de DENSIDAD, donde la composición es aditiva y
   * ordenar no haría nada, y además guarda la geometría de la apariencia **invisible**
   * para resolver el picking por `region_id`: el rasterizador reordena las gaussianas por
   * dentro, así que preguntarle a él por un índice no devolvería el nuestro.
   */
  readonly apariencia = new Apariencia();
  private fotograma = 0;
  private liberado = false;
  /** Cada apertura incrementa esto; una carga vieja que despierte ve que ya no es la suya. */
  private generacion = 0;

  constructor(contenedor: HTMLElement) {
    this.lienzo = document.createElement('canvas');
    this.lienzo.id = 'lienzo';
    contenedor.appendChild(this.lienzo);
    this.escena = new Escena(this.lienzo);
    this.splats = new Splats(this.escena.scene);
    this.bucle();
  }

  private readonly bucle = (): void => {
    if (this.liberado) return;
    // La escala de los splats depende del alto del lienzo y del `fov`, y los dos cambian
    // en vivo: al redimensionar y al aplicar una vista guardada.
    this.splats.sincroniza(this.lienzo.height || 1, this.escena.camera);
    this.escena.dibuja();
    this.fotograma = requestAnimationFrame(this.bucle);
  };

  /**
   * Suelta TODO: el bucle, el rasterizador de splats y sus workers, la geometría, el
   * destino del picking, los controles, el listener de `resize`, el contexto WebGL y el
   * lienzo. Es la limpieza del efecto de React.
   *
   * ⚠️ El contexto se suelta DESPUÉS de que el `DropInViewer` termine de liberarse: su
   * `dispose` es asíncrono —espera a la ordenación en vuelo— y libera texturas de la GPU;
   * perder el contexto antes lo dejaría liberando contra un renderer muerto.
   */
  dispose(): Promise<void> {
    if (this.liberado) return Promise.resolve();
    this.liberado = true;
    this.generacion++;
    cancelAnimationFrame(this.fotograma);
    this.lienzo.remove();
    return this.apariencia.dispose().finally(() => {
      this.splats.dispose();
      this.escena.dispose();
    });
  }

  /** Deja la escena vacía para abrir otro contenedor. */
  async vacia(): Promise<void> {
    this.generacion++;
    this.splats.limpia();
    await this.apariencia.limpia();
  }

  private sigueSiendo(gen: number): void {
    if (this.liberado || gen !== this.generacion) throw new VisorLiberado();
  }

  /**
   * Carga las capas de gaussianas que el contenedor declare.
   *
   * ⚠️ **Se elige por el sidecar, y el perfil se comprueba contra él.** Un `.ply` de 3DGS
   * de facto comparte nombres de columna con éste y no su semántica: allí `density` es
   * opacidad aprendida y las escalas van en logaritmo. Pintarlo con este shader daría una
   * imagen plausible y falsa, así que si el perfil no es el que se espera la capa se salta
   * **diciéndolo**.
   *
   * ⚠️ **La apariencia se busca PRIMERO dentro del glTF.** El contenedor la lleva como
   * primitiva `KHR_gaussian_splatting`, que es lo que el §5.1 pide: un visor glTF conforme
   * la dibuja sin saber nada de UOS. Sólo se cae al `.ply` suelto cuando no la trae.
   */
  async carga(uos: UosLoader): Promise<ResultadoCapas> {
    const gen = this.generacion;
    const avisos: string[] = [];
    let region: ColumnaGS | null = null;

    let deGlb = false;
    for (const escena of uos.de('mesh_gs_scene').filter(
      (a) => !a.external && a.media_type === 'model/gltf-binary')) {
      try {
        const malla = leeGlb(await uos.bytes(escena), true);
        this.sigueSiendo(gen);
        if (malla.splats) {
          // ⚠️ `KHR_gaussian_splatting` transporta gaussianas; no tiene dónde decir que
          // `region_id` es inferencia con vocabulario ISO-3950. Eso lo dice el sidecar.
          const d = await uos.sidecar<DescriptorGS>(escena);
          region ??= d?.columns?.find((c) => c.name === 'region_id') ?? null;
          let campo = campoDesdeSplats(malla.splats);
          const inferred = await leeEtiquetas(uos, escena, campo.n, malla.splats.posiciones);
          this.sigueSiendo(gen);
          if (inferred) {
            campo = { ...campo, columnas: { ...campo.columnas,
              region_id: Float32Array.from(inferred.labels) } };
            region = { name: 'region_id', measured: false,
              derived_from: inferred.meta.model?.name ?? inferred.asset.id,
              vocabulary: inferred.meta.encoding?.vocabulary ?? null };
            avisos.push('Selección dental basada en segmentación inferida; las fronteras requieren revisión.');
          } else if (!malla.splats.regionId) avisos.push(
            `${escena.id}: apariencia sin etiquetas FDI; no permite aislar piezas.`);
          await this.apariencia.añade(escena.id, plyDesdeCampo(campo), UMBRAL_ALFA_255);
          this.sigueSiendo(gen);
          this.splats.añadeApariencia(
            escena.id, 'apariencia inferida (KHR_gaussian_splatting)', campo,
            { medida: false, nota: '', soloSeleccion: true },
          );
          deGlb = true;
        }
      } catch (e) {
        if (e instanceof VisorLiberado) throw e;
        avisos.push(
          `la capa \`KHR_gaussian_splatting\` de la escena no se pudo leer, se usa el ` +
            `\`.ply\` si viaja: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    for (const a of uos.de('mesh_gs_scene')) {
      // ⚠️ La autoridad sobre qué es cada asset es su SIDECAR, no un tipo MIME: el
      // manifiesto declara los `.ply` como `application/octet-stream`.
      if (a.media_type === 'model/gltf-binary') continue;
      const d = await uos.sidecar<DescriptorGS>(a);
      this.sigueSiendo(gen);
      if (!d?.profile) continue;
      if (![...PERFILES_DENSIDAD, ...PERFILES_APARIENCIA].includes(d.profile)) {
        avisos.push(
          `${a.id}: perfil \`${d.profile}\`, que no es \`ash-twin/1.0\` ni ` +
            '`ash-gs-apariencia/1.0`. No se pinta: sus columnas se llaman igual y no ' +
            'significan lo mismo.',
        );
        continue;
      }
      try {
        let campo = leePly(await uos.bytes(a));
        const inferred = await leeEtiquetas(uos, a, campo.n);
        this.sigueSiendo(gen);
        if (inferred) campo = { ...campo, columnas: { ...campo.columnas,
          region_id: Float32Array.from(inferred.labels) } };
        const o = campo.comentarios['origin']?.split(/[\s,]+/).map(Number);
        const origen = o && o.length === 3 && o.every(Number.isFinite)
          ? [o[0]!, o[1]!, o[2]!] as [number, number, number]
          : undefined;
        if (PERFILES_APARIENCIA.includes(d.profile)) {
          // El sidecar se lee IGUAL aunque la capa venga del glTF: es donde se declara que
          // `region_id` es inferencia y no medida.
          region ??= d.columns?.find((c) => c.name === 'region_id') ?? null;
          if (deGlb) continue;
          await this.apariencia.añade(a.id, plyDesdeCampo(campo), UMBRAL_ALFA_255);
          this.sigueSiendo(gen);
          this.splats.añadeApariencia(a.id, d.role ?? a.id, campo, {
            origen,
            medida: d.measured === true,
            nota: d.note ?? '',
            // Invisible SIEMPRE: quien la dibuja es el rasterizador. Esta geometría existe
            // para la caja de encuadre y el pase de selección contra `region_id`.
            soloSeleccion: true,
          });
        } else {
          this.splats.añade(a.id, d.role ?? a.id, campo, TONOS[a.id] ?? [0.8, 0.8, 0.8], {
            origen,
            medida: d.measured === true,
            nota: d.note ?? '',
          });
        }
      } catch (e) {
        if (e instanceof VisorLiberado) throw e;
        avisos.push(`${a.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // El grupo del rasterizador se cuelga DESPUÉS de cargar: se crea perezosamente y un
    // `.uos` sin apariencia no lo llega a instanciar.
    const gs = this.apariencia.grupo;
    if (gs && gs.parent !== this.escena.scene) this.escena.scene.add(gs);
    return { avisos, region };
  }

  /** Encuadra sobre la apariencia, o sobre la primera capa si no la hay. */
  encuadra(): void {
    const cual = this.splats.apariencia?.id ?? this.splats.capas[0]?.id;
    const caja = cual ? this.splats.caja(cual) : null;
    if (caja) this.escena.encuadraCaja(caja);
  }

  /**
   * Enciende una pieza y apaga el resto. `null` las devuelve todas.
   *
   * A los DOS: `splats` guarda el estado y resalta el campo de densidad si está encendido;
   * `apariencia` es quien de verdad se ve, y aísla la pieza apagando las demás escenas.
   */
  resalta(fdi: number | null): void {
    this.splats.resalta(fdi);
    this.apariencia.resalta(fdi);
  }

  /**
   * Picking semántico (§11.3) SOBRE LAS GAUSSIANAS, en coordenadas de cliente.
   *
   * El spec lo define contra los vértices de `scene.glb`; aquí no hay malla, así que se
   * resuelve con un pase de selección contra `region_id`. Ver `Splats.piezaEn`.
   */
  piezaEn(clientX: number, clientY: number): number | null {
    const r = this.lienzo.getBoundingClientRect();
    // A píxeles del buffer de dibujo: el lienzo tiene `pixelRatio` y el destino de 1x1 se
    // recorta sobre esa rejilla, no sobre la de CSS.
    const k = this.lienzo.width / Math.max(r.width, 1);
    return this.splats.piezaEn(
      this.escena.renderer, this.escena.camera,
      Math.round((clientX - r.left) * k), Math.round((clientY - r.top) * k),
      this.lienzo.width, this.lienzo.height,
    );
  }
}
