import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fichaDe, leeClinico, porPieza } from '../src/uos/Clinico';
import { leeEtiquetas } from '../src/uos/Etiquetas';
import { leeGlb } from '../src/uos/Glb';
import { NodeFileReader } from '../src/uos/NodeReader';
import { UosLoader } from '../src/uos/UosLoader';

it('reads old scalars and omitted findings without inventing clinical values', () => {
  const d = leeClinico({ schema: 'ash-clinical/1.0', teeth: [
    { fdi: '11', n_roots: 1 }, { fdi: '12', findings: ['finding'] },
  ] });
  expect(d.teeth[0]?.findings).toEqual([]);
  expect(d.teeth[0]?.n_roots).toBe(1);
  expect(d.teeth[1]?.n_roots).toBeUndefined();
  expect(fichaDe(11, d.teeth[0], true)).toContain('raíces');
});

it('preserves value provenance, alternatives, and unreviewed selection in v2', () => {
  const d = leeClinico({ schema: 'histora-clinical/2.0', teeth: [{
    fdi: '11', n_roots: { value: 2, agent: 'rules@1', source_ref: 'sha256:a',
      selection: 'last-observation-unreviewed',
      alternatives: [{ value: 1, source_ref: 'sha256:b', agent: 'other@1' }] },
    findings: { value: [{ display: 'finding', provenance: { source_ref: 'sha256:c' } }] },
  }] });
  const p = porPieza(d).get('11');
  expect(p?.n_roots).toBe(2);
  expect(p?.findings).toEqual(['finding']);
  const html = fichaDe(11, p, true);
  for (const value of ['alternativa', 'sha256:a', 'sha256:b', 'sha256:c',
                       'last-observation-unreviewed']) expect(html).toContain(value);
  expect(html).not.toContain('[object Object]');
});

it('merges repeated tooth entries without losing their findings or provenance', () => {
  const d = leeClinico({ schema: 'histora-clinical/2.0', teeth: [
    { fdi: '11', ph: { value: 7, source_ref: 'sha256:a' }, findings: ['a'] },
    { fdi: '11', findings: ['b'] },
  ] });
  expect(d.teeth).toHaveLength(1);
  expect(d.teeth[0]?.ph).toBe(7);
  expect(d.teeth[0]?.findings).toEqual(['a', 'b']);
  expect(d.teeth[0]?.details).toHaveLength(1);
});

it('rejects unsupported clinical schemas explicitly', () => {
  expect(() => leeClinico({ schema: 'future/99', teeth: [] })).toThrow('no soportado');
});

const current = process.env['UOS_CURRENT'] ?? '';
describe.skipIf(!existsSync(current))('local complete case (never included in git)', () => {
  it('reads all clinical entries and both GLB assets from the actual output', async () => {
    const uos = await UosLoader.abrir(new NodeFileReader(current));
    const doc = uos.porPrioridad.find(a => a.id === 'asset.clinical')!;
    const clinical = leeClinico(JSON.parse(new TextDecoder().decode(await uos.bytes(doc))));
    for (const p of clinical.teeth) {
      expect(Array.isArray(p.findings)).toBe(true);
      expect(fichaDe(Number(p.fdi), p, true)).not.toContain('[object Object]');
    }
    const base = uos.porPrioridad.find(a => a.id === 'asset.scene')!;
    const appearance = uos.porPrioridad.find(a => a.id === 'asset.appearance')!;
    expect(leeGlb(await uos.bytes(base)).splats).toBeNull();
    const bytes = await uos.bytes(appearance);
    expect(() => leeGlb(bytes)).toThrow('POSITION');
    const gs = leeGlb(bytes, true);
    expect(gs.triangulos).toBe(0);
    expect(gs.splats?.n).toBeGreaterThan(0);
    expect(gs.splats?.regionId).toBeNull(); // base coefficients never carry inferred labels
    const labels = await leeEtiquetas(uos, appearance, gs.splats!.n, gs.splats!.posiciones);
    expect(labels?.labels.length).toBe(gs.splats!.n);
    expect(new Set(labels?.labels).size).toBeGreaterThan(10);
  });
});

// Synthetic one-Gaussian GLB; contains no patient data.
it('reads a standalone KHR Gaussian primitive without weakening mesh checks', () => {
  const bytes = new Uint8Array(Buffer.from('Z2xURgIAAAA8BQAA6AQAAEpTT057ImFzc2V0Ijp7InZlcnNpb24iOiIyLjAiLCJnZW5lcmF0b3IiOiJhZ2VudGljLXNtYXJ0LWhlYWx0aCJ9LCJzY2VuZSI6MCwic2NlbmVzIjpbeyJub2RlcyI6WzBdfV0sIm5vZGVzIjpbeyJuYW1lIjoic2NhbiIsImNoaWxkcmVuIjpbMV19LHsibWVzaCI6MCwibmFtZSI6ImFwYXJpZW5jaWEifV0sIm1lc2hlcyI6W3sibmFtZSI6ImFwYXJpZW5jaWEiLCJwcmltaXRpdmVzIjpbeyJhdHRyaWJ1dGVzIjp7IlBPU0lUSU9OIjowLCJLSFJfZ2F1c3NpYW5fc3BsYXR0aW5nOlJPVEFUSU9OIjoxLCJLSFJfZ2F1c3NpYW5fc3BsYXR0aW5nOlNDQUxFIjoyLCJLSFJfZ2F1c3NpYW5fc3BsYXR0aW5nOk9QQUNJVFkiOjMsIktIUl9nYXVzc2lhbl9zcGxhdHRpbmc6U0hfREVHUkVFXzBfQ09FRl8wIjo0fSwibW9kZSI6MCwiZXh0ZW5zaW9ucyI6eyJLSFJfZ2F1c3NpYW5fc3BsYXR0aW5nIjp7Imtlcm5lbCI6ImVsbGlwc2UiLCJjb2xvclNwYWNlIjoic3JnYl9yZWM3MDlfZGlzcGxheSJ9fX1dfV0sImFjY2Vzc29ycyI6W3siYnVmZmVyVmlldyI6MCwiY29tcG9uZW50VHlwZSI6NTEyNiwiY291bnQiOjEsInR5cGUiOiJWRUMzIiwibWluIjpbMS4wLDIuMCwzLjBdLCJtYXgiOlsxLjAsMi4wLDMuMF19LHsiYnVmZmVyVmlldyI6MSwiY29tcG9uZW50VHlwZSI6NTEyNiwiY291bnQiOjEsInR5cGUiOiJWRUM0In0seyJidWZmZXJWaWV3IjoyLCJjb21wb25lbnRUeXBlIjo1MTI2LCJjb3VudCI6MSwidHlwZSI6IlZFQzMifSx7ImJ1ZmZlclZpZXciOjMsImNvbXBvbmVudFR5cGUiOjUxMjYsImNvdW50IjoxLCJ0eXBlIjoiU0NBTEFSIn0seyJidWZmZXJWaWV3Ijo0LCJjb21wb25lbnRUeXBlIjo1MTI2LCJjb3VudCI6MSwidHlwZSI6IlZFQzMifV0sImJ1ZmZlclZpZXdzIjpbeyJidWZmZXIiOjAsImJ5dGVPZmZzZXQiOjAsImJ5dGVMZW5ndGgiOjEyLCJ0YXJnZXQiOjM0OTYyfSx7ImJ1ZmZlciI6MCwiYnl0ZU9mZnNldCI6MTIsImJ5dGVMZW5ndGgiOjE2LCJ0YXJnZXQiOjM0OTYyfSx7ImJ1ZmZlciI6MCwiYnl0ZU9mZnNldCI6MjgsImJ5dGVMZW5ndGgiOjEyLCJ0YXJnZXQiOjM0OTYyfSx7ImJ1ZmZlciI6MCwiYnl0ZU9mZnNldCI6NDAsImJ5dGVMZW5ndGgiOjQsInRhcmdldCI6MzQ5NjJ9LHsiYnVmZmVyIjowLCJieXRlT2Zmc2V0Ijo0NCwiYnl0ZUxlbmd0aCI6MTIsInRhcmdldCI6MzQ5NjJ9XSwiYnVmZmVycyI6W3siYnl0ZUxlbmd0aCI6NTZ9XSwiZXh0ZW5zaW9uc1VzZWQiOlsiS0hSX2dhdXNzaWFuX3NwbGF0dGluZyJdfTgAAABCSU4AAACAPwAAAEAAAEBAAAAAAAAAAAAAAAAAAACAPwAAgD8AAIA/AACAPwAAAD8AAAAAAAAAAAAAAAA=', 'base64'));
  expect(() => leeGlb(bytes)).toThrow('POSITION');
  const result = leeGlb(bytes, true);
  expect(result.posiciones.length).toBe(0);
  expect(result.splats?.n).toBe(1);
  expect(Array.from(result.splats!.posiciones)).toEqual([1, 2, 3]);
  expect(result.splats?.opacidad[0]).toBe(0.5);
});

it('unwraps colour values while keeping their inferred provenance', () => {
  const color = { cervical: [50, 1, 2], middle: [51, 2, 3], incisal: [52, 3, 4],
    space: 'CIELAB', n_pixels: 100, from_photo: 'sha256:a', measured: true };
  const d = leeClinico({ schema: 'histora-clinical/2.0', teeth: [{ fdi: '26',
    color: { value: color, derivation: 'inferred', derived_from: ['asset.appearance'] } }] });
  expect(d.teeth[0]?.color?.middle).toEqual([51, 2, 3]);
  expect(fichaDe(26, d.teeth[0], true)).toContain('L* 51.0');
  expect(d.teeth[0]?.details?.[0]?.provenance['derivation']).toBe('inferred');
});
