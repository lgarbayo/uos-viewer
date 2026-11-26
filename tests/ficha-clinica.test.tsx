import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { FichaClinica } from '../src/app/ui/FichaClinica';
import { ProveedorIdioma, type Idioma } from '../src/app/ui/idioma';
import { fichaDe, type ColorCorona, type Pieza } from '../src/uos/Clinico';

/**
 * `FichaClinica` es la presentación de `fichaDe` en React, en dos idiomas. Lo que guardan
 * estos tests: que en español diga EXACTAMENTE lo mismo que `fichaDe` —la ficha que tiene
 * los tests clínicos en `clinico.test.ts`— y que las dos no se separen sin que se note.
 */

const COLOR: ColorCorona = {
  space: 'CIELAB',
  cervical: [55.4, 9.6, 22.0],
  middle: [58.1, 8.9, 21.0],
  incisal: [57.2, 9.0, 26.1],
  from_photo: `sha256:${'a'.repeat(64)}`,
  // Menos de mil: `fichaDe` formatea con el locale del entorno y la ficha con el idioma.
  n_pixels: 950,
  measured: true,
  note: 'color medido por pieza; NO es un tono de guia certificado',
};

function pieza(extra: Partial<Pieza> = {}): Pieza {
  return { fdi: '26', findings: [], ...extra };
}

function ficha(idioma: Idioma, fdi: number, p: Pieza | undefined, segmentada: boolean): string {
  return renderToStaticMarkup(createElement(ProveedorIdioma, { value: idioma },
    createElement(FichaClinica, { fdi, pieza: p, segmentada })));
}

/** El texto que se lee, sin etiquetas y con los espacios juntados. */
function texto(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, ' ').trim();
}

/** Las clases en el orden en que aparecen. */
function clases(html: string): string[] {
  return [...html.matchAll(/class="([^"]+)"/g)].map((m) => m[1]!);
}

const CASOS: [string, number, Pieza | undefined, boolean][] = [
  ['con color, hallazgos y confianza baja', 26, pieza({
    color: COLOR, findings: ['caries', 'restauración'], ph: 6.8, n_roots: 3, n_canals: 4,
    confidence: 0.62, agent: 'clinical-agent',
  }), true],
  ['con procedencia', 11, pieza({
    fdi: '11', confidence: 0.91, agent: 'clinical-agent',
    details: [{ field: 'hallazgo', value: 'caries', alternative: false,
      provenance: { source: 'doc_001', page: 2, value: 'x' } }],
  } as Partial<Pieza>), true],
  ['sin color', 17, pieza({ fdi: '17' }), true],
  ['sin informe ni segmentación', 18, undefined, false],
];

describe('FichaClinica en español dice lo mismo que fichaDe', () => {
  for (const [nombre, fdi, p, seg] of CASOS) {
    it(nombre, () => {
      const nueva = ficha('es', fdi, p, seg);
      const vieja = fichaDe(fdi, p, seg);
      expect(texto(nueva)).toBe(texto(vieja));
      expect(clases(nueva)).toEqual(clases(vieja));
    });
  }
});

describe('FichaClinica en inglés', () => {
  it('traduce las etiquetas y deja los datos del contenedor tal cual', () => {
    const html = ficha('en', 26, pieza({
      color: { ...COLOR, n_pixels: 10205 }, findings: ['caries'], n_roots: 3,
      confidence: 0.62, agent: 'clinical-agent',
    }), true);
    expect(html).toContain('Tooth 26');
    expect(html).toContain('roots');
    expect(html).toContain('findings');
    expect(html).toContain('below threshold');
    expect(html).toContain('middle');
    // El número con separador inglés; la nota del emisor y el hallazgo, sin traducir.
    expect(html).toContain('10,205 px');
    expect(html).toContain('NO es un tono de guia certificado');
    expect(html).toContain('caries');
    expect(html).not.toMatch(/Pieza|raíces|hallazgos|bajo umbral/);
  });

  it('dice qué falta', () => {
    const html = ficha('en', 18, undefined, false);
    expect(html).toContain('the report does not mention this tooth');
    expect(html).toContain('the segmentation did not find it');
  });
});
