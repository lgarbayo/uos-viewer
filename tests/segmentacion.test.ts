import { describe, expect, it } from 'vitest';

import { interpretaSegmentacion, margenDePieza } from '../src/app/Segmentacion';

/** Con la forma que escribe `uos.derivados.meta_segmentacion` del emisor. */
const completo = {
  model: { name: 'segmentador', version: 'v1', weights_sha256: 'ab'.repeat(32) },
  source_assets: ['asset.scene'],
  regulatory: { layer: 3, status: 'investigational', jurisdictions: [] },
  generated: '2026-11-20T12:25:02+00:00',
  encoding: { dtype: 'int16-le', count: 10, indexes: 'un código por vértice', vocabulary: 'ISO-3950 (FDI)' },
  per_tooth_boundary: { criterion: 'p95', note: '', teeth: {
    '11': { mesiodistal_mm: 9.8, table_mm: 8.5, excess_mm: 1.3, within_expert_range: true },
    '16': { mesiodistal_mm: 12.9, table_mm: 10, excess_mm: 2.9, within_expert_range: false },
  } },
  gingival_margin: { method: 'ancla_al_pliegue', applied: true, criterion: 'metodo',
    thresholds: { crease_strength: 1.5, crease_coverage: 0.75 },
    teeth: {
      '11': { moved: 0, moved_fraction: 0, declined: true, reason: 'weak_crease' },
      '13': { moved: 1308, moved_fraction: 0.3262, declined: false, reason: null },
    } },
  labels: { present: [16, 11], n_labelled: 7, n_total: 10 },
};

describe('lo que declara una segmentación de derived/', () => {
  it('lee modelo, pesos, régimen y piezas tal cual', () => {
    const s = interpretaSegmentacion('asset.seg', 'derived/seg.bin', completo);
    expect(s.modelo).toBe('segmentador');
    expect(s.version).toBe('v1');
    expect(s.pesos).toHaveLength(64);
    expect(s.capa).toBe(3);
    expect(s.estado).toBe('investigational');
    expect(s.piezas).toEqual([11, 16]);
    expect(s.frontera?.get(16)?.within_expert_range).toBe(false);
  });

  it('lo que el emisor deja a null se queda en null: no se rellena con lo que «sabemos»', () => {
    const s = interpretaSegmentacion('asset.seg', 'x', {
      model: { name: 'm', version: null, weights_sha256: null } });
    expect(s.version).toBeNull();
    expect(s.pesos).toBeNull();
    expect(s.frontera).toBeNull();
    // Sin `gingival_margin` el margen NO se ejecutó: no es lo mismo que «no movió nada».
    expect(s.margen).toBeNull();
  });

  it('distingue margen anclado, declinado y propuesto sin aplicar', () => {
    const s = interpretaSegmentacion('a', 'x', completo);
    expect(margenDePieza(s.margen, 13)).toMatch(/anclado al surco.*1\.?308 vértices.*33 %/);
    expect(margenDePieza(s.margen, 11)).toMatch(/sin surco claro.*weak_crease/);
    expect(margenDePieza(s.margen, 22)).toBeNull();
    const propuesto = interpretaSegmentacion('a', 'x', {
      ...completo, gingival_margin: { ...completo.gingival_margin, applied: false } });
    expect(margenDePieza(propuesto.margen, 13)).toMatch(/propuesto, NO aplicado/);
  });
});
