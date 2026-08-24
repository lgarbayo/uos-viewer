/**
 * `UosLoader` — abre un `.uos` y resuelve sus assets por prioridad de carga (spec §11.1).
 *
 * **Lo que hace distinto a un visor cualquiera.** No recibe una lista de ficheros que
 * alguien le preparó: recibe **un contenedor** y lo interroga. El manifiesto dice qué hay,
 * en qué marco vive cada cosa y con qué transformada se alinean, así que este visor puede
 * abrir el `.uos` de otro emisor sin saber nada de su pipeline. Es el punto de que UOS sea
 * un formato y no *nuestro* formato.
 *
 * **La carga es perezosa y por prioridad.** El manifiesto y la escena de malla se leen al
 * abrir —son unos MB y ya permiten enseñar algo—, y el volumen no se toca hasta que
 * alguien enciende esa capa. En un caso con CBCT eso es la diferencia entre esperar 34 MB
 * o 299 antes del primer fotograma, que es justo el presupuesto del §11.4.
 */

import type { Asset, ClaseAsset, Manifiesto, Registro } from './Manifest';
import type { Reader } from './Reader';
import { ZipReader } from './ZipReader';

export const MANIFIESTO = 'manifest.json';
export const VISTAS = 'views.json';

/** Lo que el contenedor no cumple. Se acumula en vez de reventar en el primer fallo. */
export interface Reparo {
  readonly grave: boolean;
  readonly texto: string;
}

export class UosLoader {
  private readonly cache = new Map<string, Uint8Array>();

  private constructor(
    private readonly zip: ZipReader,
    readonly manifiesto: Manifiesto,
    readonly reparos: readonly Reparo[],
  ) {}

  static async abrir(origen: Reader): Promise<UosLoader> {
    const zip = await ZipReader.abrir(origen);
    const reparos: Reparo[] = [];

    // ⚠️ La identificación POSITIVA del formato es que `manifest.json` sea la primera
    // entrada física (§3), no la extensión del fichero. Se comprueba antes de leer nada
    // más: un ZIP cualquiera con un `manifest.json` en medio no es un `.uos`.
    const primera = zip.primera;
    if (!primera || primera.nombre !== MANIFIESTO) {
      throw new Error(
        `La primera entrada del ZIP es \`${primera?.nombre ?? 'ninguna'}\` y el spec ` +
          `exige \`${MANIFIESTO}\`. Sin eso no hay identificación positiva del formato.`,
      );
    }

    const manifiesto = await zip.leerJSON<Manifiesto>(MANIFIESTO);
    if (!manifiesto.uos_version) {
      throw new Error('El manifiesto no declara `uos_version`: no se sabe qué se ha abierto.');
    }

    for (const a of manifiesto.assets) {
      const hay = a.uri.endsWith('/')
        ? zip.entradas.some((e) => e.nombre.startsWith(a.uri))
        : zip.entrada(a.uri) !== undefined;
      if (!hay) {
        reparos.push({
          grave: true,
          texto: `El manifiesto declara \`${a.id}\` en \`${a.uri}\` y no está en el contenedor.`,
        });
      }
    }
    if (manifiesto.canonical_frame.units !== 'mm') {
      reparos.push({
        grave: true,
        texto:
          `El marco canónico declara unidades \`${manifiesto.canonical_frame.units}\` y ` +
          'la convención del spec son milímetros: todas las medidas saldrían mal.',
      });
    }
    for (const f of alcanzablesDesdeCanonico(manifiesto).noConectados) {
      reparos.push({
        grave: true,
        texto:
          `El marco \`${f}\` no conecta con el canónico por ninguna registración: lo que ` +
          'viva en él se colocaría en el sitio equivocado sin poder detectarlo.',
      });
    }

    return new UosLoader(zip, manifiesto, reparos);
  }

  /** Los assets en el orden en que conviene cargarlos: menor `load_priority` primero. */
  get porPrioridad(): readonly Asset[] {
    return [...this.manifiesto.assets].sort(
      (a, b) => a.load_priority - b.load_priority || a.id.localeCompare(b.id),
    );
  }

  de(clase: ClaseAsset): readonly Asset[] {
    return this.porPrioridad.filter((a) => a.kind === clase);
  }

  /** Los bytes de un asset, bajados en ese momento y cacheados. */
  async bytes(asset: Asset): Promise<Uint8Array> {
    if (asset.uri.endsWith('/')) {
      throw new Error(
        `\`${asset.id}\` es un directorio (${asset.parts?.length ?? '?'} ficheros): se ` +
          'pide corte a corte con `parte()`, no de golpe.',
      );
    }
    const ya = this.cache.get(asset.uri);
    if (ya) return ya;
    const crudo = await this.zip.leer(asset.uri);
    this.cache.set(asset.uri, crudo);
    return crudo;
  }

  /** Un fichero suelto de un asset-directorio: un corte de la serie DICOM. */
  async parte(asset: Asset, nombre: string): Promise<Uint8Array> {
    return this.zip.leer(asset.uri + nombre);
  }

  /** El sidecar de un asset, si lo declara. Para el volumen evita parsear DICOM (§5.2). */
  async sidecar<T>(asset: Asset): Promise<T | null> {
    return asset.sidecar_uri ? this.zip.leerJSON<T>(asset.sidecar_uri) : null;
  }

  /** Las vistas guardadas (§7), o vacío si el contenedor no las trae. */
  async vistas<T>(): Promise<readonly T[]> {
    if (!this.zip.entrada(VISTAS)) return [];
    const { views } = await this.zip.leerJSON<{ views: T[] }>(VISTAS);
    return views ?? [];
  }

  /**
   * Verifica el `sha256` de un asset contra lo que declara el manifiesto.
   *
   * ⚠️ **No se hace sola**, y es deliberado: el spec (§8) deja la verificación como
   * política del cliente —obligatoria en ingesta y export, opcional al visualizar—, y
   * hashear 299 MB antes del primer fotograma es lo contrario del presupuesto del §11.4.
   * Quien quiera la garantía la pide.
   */
  async verifica(asset: Asset): Promise<boolean> {
    const crudo = await this.bytes(asset);
    const digest = await crypto.subtle.digest('SHA-256', crudo as BufferSource);
    const hex = [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    return hex === asset.sha256;
  }
}

/** Recorre el grafo de marcos desde el canónico. Los que no llegan se declaran (§6). */
export function alcanzablesDesdeCanonico(m: Manifiesto): {
  alcanzables: Set<string>;
  noConectados: string[];
} {
  const alcanzables = new Set<string>([m.canonical_frame.id]);
  const aristas: Array<[string, string]> = m.registrations.map((r: Registro) => [
    r.source_frame,
    r.target_frame,
  ]);
  for (let cambio = true; cambio; ) {
    cambio = false;
    for (const [a, b] of aristas) {
      for (const [x, y] of [
        [a, b],
        [b, a],
      ] as const) {
        if (alcanzables.has(y) && !alcanzables.has(x)) {
          alcanzables.add(x);
          cambio = true;
        }
      }
    }
  }
  const noConectados = [...new Set(m.assets.map((a) => a.frame))].filter(
    (f) => !alcanzables.has(f),
  );
  return { alcanzables, noConectados };
}
