import { describe, expect, it } from 'vitest';
import { fichaDe, type ColorCorona, type Pieza } from '../src/uos/Clinico';

const COLOR: ColorCorona = {
  space: 'CIELAB',
  cervical: [55.4, 9.6, 22.0],
  middle: [58.1, 8.9, 21.0],
  incisal: [57.2, 9.0, 26.1],
  from_photo: `sha256:${'a'.repeat(64)}`,
  n_pixels: 10205,
  measured: true,
  note: 'color medido por pieza; NO es un tono de guia certificado',
};

function pieza(extra: Partial<Pieza> = {}): Pieza {
  return { fdi: '26', findings: [], ...extra };
}

describe('la ficha de una pieza', () => {
  it('enseña el color medido con su soporte y su origen', () => {
    const html = fichaDe(26, pieza({ color: COLOR }), true);
    expect(html).toContain('cervical');
    expect(html).toContain('L* 55.4');
    expect(html).toContain('10,205');
    // ⚠️ El sha256 de la foto sí, su nombre NUNCA: en una clínica lleva datos del paciente.
    expect(html).toContain('sha256:aaa');
  });

  it('repite entera la nota de lo que el color NO es', () => {
    // Sin una referencia gris en el encuadre, el flash entra en el número. Resumir esto a
    // «color medido» dejaría a quien mira deduciendo un tono de guía de un cuadrito.
    const html = fichaDe(26, pieza({ color: COLOR }), true);
    expect(html).toContain('NO es un tono de guia certificado');
  });

  it('pone la muestra AL LADO del número, no en su lugar', () => {
    // La pantalla de quien mira no está calibrada: el cuadrito orienta y el dato es el L*a*b*.
    const html = fichaDe(26, pieza({ color: COLOR }), true);
    const muestra = html.indexOf('class="muestra"');
    const lab = html.indexOf('class="lab"');
    expect(muestra).toBeGreaterThan(-1);
    expect(lab).toBeGreaterThan(muestra);
  });

  it('una pieza sin color no inventa un cuadrito gris', () => {
    // Ausente no es lo mismo que nulo: si ninguna foto la vio, aquí no hay bloque.
    const html = fichaDe(17, pieza({ fdi: '17' }), true);
    expect(html).not.toContain('class="muestra"');
    expect(html).not.toContain('cervical');
  });

  it('sigue diciendo qué falta cuando el informe no menciona la pieza', () => {
    const html = fichaDe(17, undefined, false);
    expect(html).toContain('el informe no menciona esta pieza');
    expect(html).toContain('la segmentación no la encontró');
  });
});
