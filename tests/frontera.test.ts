import { describe, expect, it } from 'vitest';
import { avisoDeFrontera, type MetaSegmentacion } from '../src/uos/Derivados';

const base = {
  model: { name: 'ash-seg-teeth', version: '0', weights_sha256: null },
  source_assets: ['asset.scene'],
  regulatory: { layer: 3, status: 'investigational', jurisdictions: [] },
  generated: '2026-08-27T00:00:00Z',
  encoding: { dtype: 'int16-le', count: 3, indexes: '', vocabulary: 'ISO-3950 (FDI)' },
  labels: { present: [11, 15], n_labelled: 2, n_total: 3 },
};

describe('el aviso de frontera por pieza', () => {
  const meta = {
    ...base,
    per_tooth_boundary: {
      criterion: 'x',
      note: 'y',
      teeth: {
        '11': { mesiodistal_mm: 8.9, table_mm: 8.5, excess_mm: 0.4, within_expert_range: true },
        '15': { mesiodistal_mm: 14.2, table_mm: 6.5, excess_mm: 7.7, within_expert_range: false },
      },
    },
  } as MetaSegmentacion;

  it('calla cuando el recorte esta declarado bueno', () => {
    expect(avisoDeFrontera(meta, 11)).toBe('');
  });

  it('avisa con el numero delante cuando no lo esta', () => {
    const a = avisoDeFrontera(meta, 15);
    expect(a).toContain('NO es de fiar');
    expect(a).toContain('14.2');
    expect(a).toContain('7.7');
    expect(a).toContain('más ancha');
  });

  // ⚠️ Un contenedor de otro emisor no trae el bloque, y tiene que abrirse igual: la
  // ausencia del dato no es «esta mal», es «no se declara».
  it('no inventa un aviso si el emisor no declara el bloque', () => {
    expect(avisoDeFrontera(base as MetaSegmentacion, 15)).toBe('');
    expect(avisoDeFrontera(null, 15)).toBe('');
  });
});
