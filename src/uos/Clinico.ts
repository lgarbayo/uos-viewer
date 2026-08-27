/**
 * `clinical/observations.json` — lo que el informe dice de cada pieza.
 *
 * ⚠️ **Esto NO es UOS v0.2.** El borrador no define atributos clinicos por diente: su §9
 * los manda a `Observation` de FHIR, o sea a un servidor. La consecuencia es que un `.uos`
 * suelto no puede contestar «que dice el informe del 24», que es la pregunta que un
 * clinico hace delante del modelo. El emisor lo declara como extension propia
 * (`schema: ash-clinical/1.0`) y este visor lo lee **solo si esta**, sin exigirlo: un
 * contenedor de otro emisor no lo traera y tiene que seguir abriendose igual.
 *
 * ⚠️ **Y es Layer 1, no `derived/`.** Lo que viaja es la transcripcion de un informe que
 * firmo una persona. Pero la EXTRACCION puede haber usado un backend con LLM y el contrato
 * del emisor no registra cual: por eso cada pieza trae su `confidence` y su `agent`, y este
 * visor los ENSENA en vez de presentar el dato como si fuera cierto sin mas.
 */

export interface Pieza {
  readonly fdi: string;
  readonly ph?: number;
  readonly n_roots?: number;
  readonly n_canals?: number;
  readonly findings: readonly string[];
  readonly confidence?: number;
  readonly agent?: string;
  readonly observed?: string;
  readonly color?: ColorCorona;
}

/**
 * El color de una corona, medido sobre una foto del paciente, por tercios.
 *
 * ⚠️ **Va aqui y no solo en los pixeles del campo gaussiano a proposito.** El PLY lo lleva
 * como color de cada gaussiana y eso basta para pintar, pero no para contestar «de que
 * color es el 26» sin abrir 8 MB y buscar las gaussianas de esa pieza. Aqui es un dato con
 * su soporte —`n_pixels`— y su origen —el `sha256` de la foto, nunca su nombre, que en una
 * clinica lleva datos del paciente—.
 */
export interface ColorCorona {
  readonly space: string;
  readonly cervical: readonly [number, number, number];
  readonly middle: readonly [number, number, number];
  readonly incisal: readonly [number, number, number];
  readonly from_photo: string;
  readonly n_pixels: number;
  readonly measured: boolean;
  readonly note: string;
  /**
   * La pendiente por canal con la que el emisor descontó la caída del flash usando la
   * encía del propio paciente como referencia, o ausente si esta pieza NO se corrigió.
   *
   * ⚠️ **Ausente no es cero: es «no comparable».** Una pieza sin corregir lleva dentro lo
   * lejos que le llegó la luz. Sin corregir, un caso real recorría 22,7 puntos de `L*`
   * entre el 21 y el 27 —el incisivo salía blanco y el molar marrón siendo la misma
   * boca—; corregido recorre 5,6. El visor no necesita leer el número porque `note` ya lo
   * dice con palabras, pero el campo se declara para que quien lea este tipo sepa que la
   * comparación entre piezas depende de él.
   */
  readonly illumination_slope?: readonly [number, number, number];
}

export interface Medida {
  readonly name: string;
  readonly value: number;
  readonly unit: string;
  readonly side: string | null;
  readonly normal_min: number | null;
  readonly normal_max: number | null;
  readonly out_of_range: boolean;
  readonly text: string;
}

export interface CapaClinica {
  readonly schema: string;
  readonly extension_of?: string;
  readonly vocabulary: string;
  readonly regulatory: { readonly layer: number; readonly note: string };
  readonly teeth: readonly Pieza[];
  readonly measurements: readonly Medida[];
  readonly review: { readonly note: string; readonly reasons: readonly string[] };
}

/** Por codigo FDI, para poder contestar al clic sin recorrer la lista cada vez. */
export function porPieza(capa: CapaClinica): Map<string, Pieza> {
  return new Map(capa.teeth.map((t) => [t.fdi, t]));
}

/**
 * La ficha de una pieza en HTML, o el hueco declarado.
 *
 * ⚠️ **Un diente segmentado puede no tener informe, y al reves.** No se rellena el hueco:
 * se dice cual de los dos falta. Que no coincidan es informacion clinica —el gate del
 * emisor ya lo declara pieza a pieza— y taparlo con un «sin datos» generico la perderia.
 */
export function fichaDe(fdi: number, p: Pieza | undefined, segmentada: boolean): string {
  const filas: string[] = [];
  if (p?.ph !== undefined) filas.push(fila('pH', String(p.ph)));
  if (p?.n_roots !== undefined) filas.push(fila('raíces', String(p.n_roots)));
  if (p?.n_canals !== undefined) filas.push(fila('conductos', String(p.n_canals)));
  if (p?.findings.length) filas.push(fila('hallazgos', p.findings.join(', ')));

  const procedencia =
    p?.confidence !== undefined
      ? `<p class="nota">${p.agent ?? '—'} · confianza ${p.confidence.toFixed(2)}${
          p.confidence < 0.7 ? ' <span class="l3">bajo umbral</span>' : ''
        }</p>`
      : '';
  const huecos: string[] = [];
  if (!p) huecos.push('el informe no menciona esta pieza');
  if (!segmentada) huecos.push('la segmentación no la encontró');

  return `<h4>Pieza ${fdi}</h4>
    ${filas.length ? `<dl class="ficha">${filas.join('')}</dl>` : ''}
    ${p?.color ? bloqueColor(p.color) : ''}
    ${procedencia}
    ${huecos.map((h) => `<p class="hueco">${h}</p>`).join('')}`;
}

/**
 * Los tres tercios con su muestra, su L*a*b* y lo que el color NO es.
 *
 * ⚠️ La nota del emisor se ensena entera y no se resume. Sin una referencia gris en el
 * encuadre, el flash cayendo hacia el fondo de la boca entra en el numero: es color
 * medido, no un tono de guia certificado, y quien mire esto tiene que leerlo aqui y no
 * deducirlo de que la muestra se parezca a un A2.
 */
function bloqueColor(c: ColorCorona): string {
  const tercios: readonly [string, readonly [number, number, number]][] = [
    ['cervical', c.cervical],
    ['medio', c.middle],
    ['incisal', c.incisal],
  ];
  return `<div class="color">
    <ul class="tonos">${tercios
      .map(
        ([nombre, lab]) => `<li>
          <span class="muestra" style="background:${aCss(lab)}"></span>
          <span class="tercio">${nombre}</span>
          <span class="lab">L* ${lab[0].toFixed(1)} a* ${lab[1].toFixed(1)} b* ${lab[2].toFixed(1)}</span>
        </li>`,
      )
      .join('')}</ul>
    <p class="nota">${c.space} · ${c.n_pixels.toLocaleString()} px · ${c.from_photo}</p>
    <p class="nota">⚠️ ${c.note}</p>
  </div>`;
}

/**
 * CIELAB a sRGB, D65, **solo para la muestra de la pantalla**.
 *
 * El dato que viaja es el L*a*b*, que es lo que se midio; esto es una conversion de
 * presentacion y la pantalla de quien mira no esta calibrada. Por eso el numero se ensena
 * al lado del cuadrito: si los dos no coinciden, el bueno es el numero.
 */
export function aCss(lab: readonly [number, number, number]): string {
  const [L, a, b] = lab;
  const fy = (L + 16) / 116;
  const inversa = (t: number) => (t > 6 / 29 ? t ** 3 : 3 * (6 / 29) ** 2 * (t - 4 / 29));
  const x = 0.95047 * inversa(fy + a / 500);
  const y = 1.0 * inversa(fy);
  const z = 1.08883 * inversa(fy - b / 200);
  const canal = (v: number) => {
    const g = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, g)) * 255);
  };
  const r = canal(3.2406 * x - 1.5372 * y - 0.4986 * z);
  const v = canal(-0.9689 * x + 1.8758 * y + 0.0415 * z);
  const azul = canal(0.0557 * x - 0.204 * y + 1.057 * z);
  return `rgb(${r} ${v} ${azul})`;
}

function fila(k: string, v: string): string {
  return `<dt>${k}</dt><dd>${v}</dd>`;
}
