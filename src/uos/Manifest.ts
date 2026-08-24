/**
 * `manifest.json` — el contrato del contenedor (spec §4).
 *
 * Los tipos van aquí y no repartidos por el visor porque el manifiesto es lo único que
 * este visor puede dar por cierto de un `.uos` que escribió otro. Todo lo demás —qué
 * assets hay, en qué marco viven, cómo se alinean— sale de aquí.
 */

export type EstadoPHI = 'identified' | 'pseudonymized' | 'anonymized' | 'quarantined';

export type ClaseAsset =
  | 'volume'
  | 'mesh_gs_scene'
  | 'image2d'
  | 'signal'
  | 'derived_seg'
  | 'document';

export interface Regulatorio {
  readonly layer: number;
  readonly status?: string | null;
  readonly jurisdictions?: readonly string[];
}

export interface ParteAsset {
  readonly name: string;
  readonly sha256: string;
  readonly bytes: number;
}

export interface Asset {
  readonly id: string;
  readonly kind: ClaseAsset;
  readonly visit: string;
  /** Relativa, ASCII y sin `..`. Acabada en `/` si es un directorio (una serie DICOM). */
  readonly uri: string;
  readonly media_type: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly frame: string;
  /** Menor = antes. Es el orden de carga progresiva del §4.1. */
  readonly load_priority: number;
  readonly regulatory: Regulatorio;
  /** Sólo en assets-directorio: un fichero por corte, verificable por separado. */
  readonly parts?: readonly ParteAsset[];
  /** Descriptor que evita parsear el asset para saber qué es. El volumen lo usa (§5.2). */
  readonly sidecar_uri?: string | null;
}

export interface Frame {
  readonly id: string;
  readonly description: string;
  readonly units: string;
  readonly handedness: string;
}

export interface Registro {
  readonly id: string;
  readonly source_frame: string;
  readonly target_frame: string;
  /** Lleva puntos de `source_frame` a `target_frame`, en mm y mano derecha. */
  readonly transform_4x4_row_major: readonly number[];
  readonly method: string;
  readonly rms_error_mm?: number | null;
  readonly verified_by?: string | null;
}

export interface Visita {
  readonly id: string;
  readonly date: string;
  readonly label: string;
}

export interface Manifiesto {
  readonly uos_version: string;
  readonly case_id: string;
  readonly created: string;
  readonly generator: Readonly<Record<string, string>>;
  readonly phi_state: EstadoPHI;
  readonly subject: { readonly pseudonym: string; readonly fhir_patient?: string | null };
  readonly canonical_frame: Frame;
  readonly frames: readonly Frame[];
  readonly visits: readonly Visita[];
  readonly assets: readonly Asset[];
  readonly registrations: readonly Registro[];
  readonly fhir_map: Readonly<Record<string, { readonly resource_type: string }>>;
  readonly provenance: {
    readonly prev_manifest_sha256?: string | null;
    readonly chain?: string | null;
  };
}

/**
 * ⚠️ Una registración automática sin `verified_by` humano es **provisional**, y el visor
 * tiene que indicarlo (§6). Un alineamiento que nadie ha mirado no es lo mismo que uno
 * firmado, y presentarlos igual es exactamente el fallo callado que el spec evita.
 */
export function esProvisional(r: Registro): boolean {
  return r.method === 'auto_dl' && !r.verified_by;
}
