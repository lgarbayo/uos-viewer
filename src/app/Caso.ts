/**
 * Abrir un `.uos` y dejar lo que la interfaz necesita como DATOS, no como HTML.
 *
 * ⚠️ **Es lo que hacía `abre()` en el `main.ts` de antes, separado de cómo se pinta.** Antes
 * el mismo bucle leía el manifiesto y escribía `innerHTML`; ahora lee y devuelve, y React
 * pinta. El orden de lectura y lo que se comprueba no cambian: se cargan las capas, se
 * aplica la primera vista guardada, se lee la capa clínica si viaja, y lo que falle al
 * pintar se acumula junto a los reparos del loader.
 */

import type { CapaClinica, Pieza } from '../uos/Clinico';
import { leeClinico, porPieza } from '../uos/Clinico';
import type { Manifiesto } from '../uos/Manifest';
import { BlobReader } from '../uos/Reader';
import { UosLoader, type Reparo } from '../uos/UosLoader';
import { leeSegmentaciones, type Margen, type FronteraPieza, type Segmentacion } from './Segmentacion';
import type { InfoApariencia, InfoEscaner, InfoHueso, Visor } from './Visor';

export interface VistaJSON {
  id: string;
  label: string;
  visit: string;
  camera: { position: number[]; target: number[]; up: number[]; fov?: number };
}

/** Lo que el registro de fidelidad declara de un asset. Declaración del emisor, no prueba. */
export interface FidelidadAsset {
  readonly id: string;
  readonly origen: string;
  readonly fuentes: string;
  readonly historiaDeclarada: boolean;
  readonly perdidas: number;
  readonly repetibilidad: string;
}

export interface Caso {
  readonly uos: UosLoader;
  readonly manifiesto: Manifiesto;
  readonly vistas: readonly VistaJSON[];
  /**
   * Las vistas POR PIEZA, plegadas en su diente del odontograma: la del 24 se busca en el
   * 24, no en una lista de dieciocho botones donde catorce dicen «Pieza NN».
   */
  readonly vistaDePieza: ReadonlyMap<number, VistaJSON>;
  /** Las que NO son de una pieza: oclusal, frontal, vestibulares. Van siempre a la vista. */
  readonly generales: readonly VistaJSON[];
  readonly reparos: readonly Reparo[];
  readonly clinico: CapaClinica | null;
  readonly piezas: ReadonlyMap<string, Pieza>;
  /** Las piezas que se pueden seleccionar: las que SE DIBUJAN con `region_id`. */
  readonly segmentadas: readonly number[];
  readonly segmentador: string;
  readonly hayEtiquetas: boolean;
  readonly fidelidad: readonly FidelidadAsset[] | null;
  /** La capa de apariencia que se dibuja, con lo que su sidecar dice de ella. */
  readonly apariencia: InfoApariencia | null;
  /** El campo del CBCT que se dibuja como hueso, y con qué registraciones se colocó. */
  readonly hueso: InfoHueso | null;
  /** Las coronas desde el escáner del compuesto, cuando no hay apariencia. */
  readonly escaner: InfoEscaner | null;
  /** Un compuesto con gaussianas del escáner que no se pintaron, y por qué. */
  readonly escanerFallido: { readonly id: string; readonly motivo: string } | null;
  /** El `derived_seg` que da la selección y el odontograma, o `null`. */
  readonly etiquetas: string | null;
  /** Lo que declara cada segmentación de `derived/`. Ver `Segmentacion.ts`. */
  readonly segmentaciones: readonly Segmentacion[];
  /** De qué segmentación sale el criterio de frontera por pieza, si alguna lo declara. */
  readonly frontera: { readonly id: string; readonly piezas: ReadonlyMap<number, FronteraPieza> } | null;
  /** De qué segmentación sale el margen gingival, si alguna lo ejecutó. */
  readonly margen: { readonly id: string; readonly margen: Margen } | null;
}

export async function abreCaso(fichero: File, visor: Visor): Promise<Caso> {
  await visor.vacia();
  const uos = await UosLoader.abrir(new BlobReader(fichero));
  const vistas = await uos.vistas<VistaJSON>();

  // ⚠️ **Las capas GAUSSIANAS son lo único que se dibuja, y son EL MODELO.** El contenedor
  // lleva sólo el campo gaussiano y el manifiesto —el escaneo original viaja fuera,
  // nombrado por su sha256—, así que no hay malla que enseñar mientras.
  const { avisos, region, apariencia, hueso, escaner, escanerFallido, etiquetas } =
    await visor.carga(uos);

  if (vistas[0]) visor.escena.aplicaVista(vistas[0].camera);
  else visor.encuadra();

  // La capa clínica, si el contenedor la trae. ⚠️ Se busca por NUESTRA convención
  // (`clinical/`), porque no es UOS: un `.uos` de otro emisor no la traerá y tiene que
  // abrirse igual.
  const docClinico = uos
    .de('document')
    .find((a) => a.uri.startsWith('clinical/') && a.media_type === 'application/json');
  let clinico: CapaClinica | null = null;
  let piezas = new Map<string, Pieza>();
  if (docClinico) {
    try {
      clinico = leeClinico(JSON.parse(new TextDecoder().decode(await uos.bytes(docClinico))));
      piezas = porPieza(clinico);
    } catch (e) {
      avisos.push(`No se pudo interpretar la capa clínica: ${String(e)}`);
    }
  }

  // `reparos` del loader es de sólo lectura a propósito —es lo que el contenedor
  // incumple—, así que lo que falle AL PINTAR se acumula aparte y se muestra junto.
  const reparos: Reparo[] = [...uos.reparos, ...avisos.map((t) => ({ grave: false, texto: t }))];

  let fidelidad: FidelidadAsset[] | null = null;
  const asset = uos.porPrioridad.find((a) => a.id === 'asset.fidelity_provenance');
  if (asset) {
    try {
      const audit = JSON.parse(new TextDecoder().decode(await uos.bytes(asset))) as {
        assets?: Record<string, { origin?: string; source_status?: string;
          prior_history_unknown?: boolean; introduced_losses?: unknown[];
          inherited_losses?: unknown[]; process?: { repeatability?: { state?: string } } }>;
      };
      fidelidad = Object.entries(audit.assets ?? {}).map(([id, a]) => ({
        id,
        origen: a.origin ?? 'unknown',
        fuentes: a.source_status ?? 'unresolved',
        historiaDeclarada: a.prior_history_unknown === false,
        perdidas: (a.introduced_losses?.length ?? 0) + (a.inherited_losses?.length ?? 0),
        repetibilidad: a.process?.repeatability?.state ?? 'unknown',
      }));
    } catch (e) {
      reparos.push({ grave: false, texto: `Fidelidad no interpretable: ${String(e)}` });
    }
  }

  let segmentaciones: Segmentacion[] = [];
  try {
    segmentaciones = await leeSegmentaciones(uos);
  } catch (e) {
    reparos.push({ grave: false, texto: `Sidecar de segmentación no interpretable: ${String(e)}` });
  }
  // ⚠️ **La frontera y el margen, sólo de la segmentación que NUMERA lo que se ve.** Con dos
  // `derived_seg` (el del compuesto y el de la malla), tomar el primero que los declare
  // pondría el criterio de un modelo bajo la pieza que numeró otro.
  const numeradora = segmentaciones.find((s) => s.id === etiquetas) ?? null;

  const vistaDePieza = new Map<number, VistaJSON>();
  for (const v of vistas) {
    const n = /^view\.pieza_(\d+)$/.exec(v.id);
    if (n) vistaDePieza.set(Number(n[1]), v);
  }
  const generales = vistas.filter(
    (v) => !vistaDePieza.has(Number(/\d+$/.exec(v.id)?.[0] ?? -1)));

  // Si el contenedor no trae `region_id`, no hay selección y la interfaz no promete una
  // que no existe.
  const capaFdi = visor.splats.capas.find((c) => c.conFdi && c.conPieza > 0) ?? null;

  return {
    uos,
    manifiesto: uos.manifiesto,
    vistas,
    vistaDePieza,
    generales,
    reparos,
    clinico,
    piezas,
    // Sin las fundidas con la encía: se dibujan, pero no se pueden aislar.
    segmentadas: (capaFdi?.piezas ?? []).filter((f) => !visor.apariencia.sinAislar.includes(f)),
    // ⚠️ **La autoridad es la columna, no `derived/`.** Lo que decide si se puede
    // seleccionar algo es que haya una capa dibujada con `region_id`.
    segmentador: region?.derived_from ?? '',
    hayEtiquetas: visor.splats.hayFdi,
    fidelidad,
    apariencia,
    hueso,
    escaner,
    escanerFallido,
    etiquetas,
    segmentaciones,
    frontera: numeradora?.frontera ? { id: numeradora.id, piezas: numeradora.frontera } : null,
    margen: numeradora?.margen ? { id: numeradora.id, margen: numeradora.margen } : null,
  };
}
