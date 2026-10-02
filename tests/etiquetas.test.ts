import { expect, it } from 'vitest';
import { decodificaEtiquetas, leeEtiquetas } from '../src/uos/Etiquetas';
import type { Asset } from '../src/uos/Manifest';
import type { UosLoader } from '../src/uos/UosLoader';

it('decodes indexed labels from a buffer slice in little endian', () => {
  const bytes = Uint8Array.of(99, 11, 0, 26, 0, 99).subarray(1, 5);
  expect(Array.from(decodificaEtiquetas(bytes, { encoding: { dtype: 'int16-le', count: 2 } }, 2)))
    .toEqual([11, 26]);
});
it('rejects count and encoding mismatches', () => {
  for (const encoding of [{ dtype: 'int16-le', count: 3 }, { dtype: 'int16-be', count: 2 }])
    expect(() => decodificaEtiquetas(new Uint8Array(4), { encoding }, 2)).toThrow('incompatibles');
});
it('ignores labels attached to another source and rejects ambiguous assignments', async () => {
  const source = { id: 'scene', frame: 'ios' } as Asset;
  const assets = [{ id: 'a', frame: 'ios' }, { id: 'b', frame: 'ios' }] as Asset[];
  let ids = ['other'];
  const loader = { de: () => assets, sidecar: async () => ({ source_assets: ids }) } as unknown as UosLoader;
  expect(await leeEtiquetas(loader, source, 2)).toBeNull();
  ids = ['scene'];
  await expect(leeEtiquetas(loader, source, 2)).rejects.toThrow('Más de una');
});
it('rejects an invalid label hash before attaching labels', async () => {
  const source = { id: 'scene', frame: 'ios' } as Asset;
  const loader = { de: () => [{ id: 'a', frame: 'ios' }],
    sidecar: async () => ({ source_assets: ['scene'] }), verifica: async () => false,
  } as unknown as UosLoader;
  await expect(leeEtiquetas(loader, source, 2)).rejects.toThrow('hash');
});
