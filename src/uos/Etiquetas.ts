/** Joins separately stored inferred labels by source asset and declared index order. */
import type { Asset } from './Manifest';
import type { UosLoader } from './UosLoader';

export interface MetaEtiquetas {
  readonly source_assets?: readonly string[];
  readonly model?: { readonly name?: string; readonly version?: string | null };
  readonly encoding?: { readonly dtype?: string; readonly count?: number;
    readonly vocabulary?: string; readonly source_positions_sha256?: string };
}

export function decodificaEtiquetas(raw: Uint8Array, meta: MetaEtiquetas, count: number): Int16Array {
  if (meta.encoding?.dtype !== 'int16-le' || meta.encoding.count !== count || raw.length !== count * 2)
    throw new Error('Etiquetas FDI incompatibles con el número u orden declarado de elementos');
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  return Int16Array.from({ length: count }, (_, i) => view.getInt16(i * 2, true));
}

export async function leeEtiquetas(uos: UosLoader, source: Asset, count: number, positions?: Float32Array) {
  const matches: { asset: Asset; meta: MetaEtiquetas }[] = [];
  for (const asset of uos.de('derived_seg')) {
    if (asset.external) continue;
    const meta = await uos.sidecar<MetaEtiquetas>(asset);
    if (meta?.source_assets?.includes(source.id)) matches.push({ asset, meta });
  }
  if (matches.length > 1) throw new Error(`Más de una segmentación indexa ${source.id}; requiere selección explícita`);
  const match = matches[0];
  if (!match) return null;
  if (match.asset.frame !== source.frame) throw new Error('Las etiquetas FDI declaran otro marco');
  if (!await uos.verifica(match.asset) || !await uos.verifica(source))
    throw new Error('El hash de las etiquetas o de su fuente no coincide');
  const expected = match.meta.encoding?.source_positions_sha256;
  if (expected) {
    if (!positions) throw new Error('Faltan posiciones para verificar el orden de las etiquetas');
    const digest = await crypto.subtle.digest('SHA-256', positions as BufferSource);
    const actual = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    if (actual !== expected) throw new Error('El orden de posiciones no coincide con las etiquetas FDI');
  }
  return { ...match, labels: decodificaEtiquetas(await uos.bytes(match.asset), match.meta, count) };
}
