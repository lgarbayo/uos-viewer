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
    ${procedencia}
    ${huecos.map((h) => `<p class="hueco">${h}</p>`).join('')}`;
}

function fila(k: string, v: string): string {
  return `<dt>${k}</dt><dd>${v}</dd>`;
}
