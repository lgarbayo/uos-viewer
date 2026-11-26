/**
 * «Qué se ve»: de dónde sale cada capa del render, sobre el propio lienzo.
 *
 * ⚠️ **Existe por una diferencia de procedencia que la imagen sola no dice.** Un render
 * dental 3D puede ser anatomía de referencia —un CBCT de otra persona ajustado a una
 * radiografía— y verse igual de convincente que éste. Aquí NO hay anatomía de referencia:
 * las coronas son el escaneo intraoral de este paciente, numeradas por un modelo, y el
 * hueso y las raíces son su propio CBCT, colocado con la registración que declara el
 * contenedor. Todo se construye con lo que de verdad se dibuja: lo que no viaja no se
 * menciona como si estuviera.
 *
 * ⚠️ **La numeración FDI es una fila, no una casilla.** No se puede apagar (ver `App`), pero
 * su procedencia —qué modelo, qué Capa, qué pesos— se sigue diciendo aquí.
 */

import type { ReactNode } from 'react';

import type { Cortes } from '../Espaciado';
import type { Caso } from '../Caso';
import { numero, useIdioma, type Idioma } from './idioma';

interface Props {
  readonly caso: Caso;
  readonly huesoVisible: boolean;
  readonly alCambiarHueso: (si: boolean) => void;
  readonly enciaVisible: boolean;
  readonly alCambiarEncia: (si: boolean) => void;
  readonly raicesVisibles: boolean;
  readonly alCambiarRaices: (si: boolean) => void;
}

/** Un diagnóstico que escribe el visor o el lector en español: va marcado como tal. */
const Diag = ({ children }: { children: ReactNode }) => <span lang="es">{children}</span>;

const es = {
  aria: 'Qué se ve y de dónde sale',
  titulo: 'Qué se ve',
  coronas: 'Coronas',
  escaneoPaciente: 'escaneo intraoral de este paciente',
  colorApariencia: 'color de la apariencia 3DGS',
  medido: ' · medido',
  noMedido: ' · no medido',
  formaEscaner: 'forma medida del escáner',
  colorVisualizacion: 'color y opacidad de visualización, no del paciente: este caso no trae apariencia ·',
  gaussianasDe: (n: string) => <>{n} gaussianas de</>,
  relieveCon: (de: ReactNode) => <>relieve con las normales de {de}; la malla no se dibuja</>,
  sinRelieve: 'sin relieve:',
  infladas: (n: string, total: string, sigma: string, espaciado: string) =>
    <>{n} de {total} se dibujan con σ ≥ {sigma} mm (90 % del espaciado medido,{' '}
      {espaciado} mm): tamaño de visualización, no medido</>,
  sinNumeracion: 'sin numeración en las coronas:',
  noNumeraEscaner: (id: string) => `${id} no numera ninguna gaussiana del escáner`,
  ningunDerived: 'ningún derived_seg las numera',
  noSePintan: (id: ReactNode) => <>las gaussianas del escáner de {id} no se pintan:</>,
  soloCbct: '. Sólo se ve el CBCT',
  niApariencia: 'este contenedor no trae ni apariencia ni gaussianas del escáner: sólo se ve el CBCT',
  numeracion: 'Numeración FDI',
  seleccionOdontograma: 'selección y odontograma',
  por: (quien: string) => `por ${quien}`,
  unModelo: 'un modelo',
  capa: (n: number) => `Capa ${n}`,
  capaNoDeclarada: 'Capa no declarada',
  pesos: 'pesos',
  noDeclarado: 'no declarado',
  unidaPor: (malla: ReactNode) => <>unida por los vértices de {malla}, que caen uno a uno sobre
    las gaussianas del escáner</>,
  compuestoNumera: (id: ReactNode, n: string) => <>({id} numera {n} gaussianas del CBCT y
    ninguna del escáner)</>,
  encia: 'Encía',
  visible: 'visible',
  oculta: 'oculta',
  laSepara: (seg: ReactNode, capa: ReactNode) => <>lo separa la numeración {seg} ({capa}): el
    código 0 es la encía y todo lo que el modelo no asignó</>,
  vanConElla: (piezas: string) => ` · las piezas ${piezas} van con ella`,
  raices: 'Raíces',
  cbctPaciente: 'CBCT de este paciente',
  raicesNota: (n: string, id: ReactNode, de: ReactNode, modelo: string, capa: ReactNode) =>
    <>{n} gaussianas del CBCT de {id} que {de} asigna a una pieza ({modelo} · {capa}). Densidad
      medida, en marfil de visualización</>,
  modeloNoDeclarado: 'modelo no declarado',
  dienteEntero: 'es el diente entero del CBCT, corona incluida: lo que asoma por encima de la encía lo tapa el escáner',
  hueso: 'Hueso y raíces',
  densidad: (medida: boolean, id: ReactNode) => <>densidad {medida ? 'medida' : 'no medida'}{' '}
    {id}, en gris de visualización: es tejido duro, no una segmentación del hueso</>,
  dibujadas: (n: string, total: string) => ` · ${n} de ${total} gaussianas`,
  enCanonico: 'ya viaja en el marco canónico',
  colocadoCon: 'colocado con',
  invertida: ' (invertida)',
  provisional: 'provisional: apagado por defecto',
  sinVerificar: 'sin verificar por una persona',
  verificada: 'verificada',
  cortesIncompletos: (c: Cortes, i: Idioma) => <>el CBCT llega con cortes sueltos: {c.n} en{' '}
    {numero(i, c.extension, 1)} mm, donde una serie completa cada {numero(i, c.paso, 2)} mm
    tendría {c.esperados}, y el mayor hueco mide {numero(i, c.hueco, 2)} mm. Las franjas son
    los cortes que faltan, no hueso: el visor no los rellena</>,
  apagadoPorCortes: 'apagado por defecto',
  conductos: 'Conductos nerviosos',
  conductosNota: 'este contenedor no trae esa capa, y el visor no la infiere',
  noEsReferencia: 'No es anatomía de referencia ajustada a una imagen: todo lo dibujado es de este paciente',
  dosModalidades: ', en dos modalidades unidas por una registración declarada',
};

const TEXTOS: Record<Idioma, typeof es> = {
  es,
  en: {
    aria: 'What you see and where it comes from',
    titulo: 'What you see',
    coronas: 'Crowns',
    escaneoPaciente: 'intraoral scan of this patient',
    colorApariencia: 'color from the 3DGS appearance',
    medido: ' · measured',
    noMedido: ' · not measured',
    formaEscaner: 'shape measured by the scanner',
    colorVisualizacion: 'display color and opacity, not the patient’s: this case carries no appearance ·',
    gaussianasDe: (n) => <>{n} Gaussians from</>,
    relieveCon: (de) => <>relief from the normals of {de}; the mesh itself is not drawn</>,
    sinRelieve: 'no relief:',
    infladas: (n, total, sigma, espaciado) =>
      <>{n} of {total} are drawn with σ ≥ {sigma} mm (90 % of the measured spacing,{' '}
        {espaciado} mm): display size, not measured</>,
    sinNumeracion: 'no numbering on the crowns:',
    noNumeraEscaner: (id) => `${id} numbers none of the scanner Gaussians`,
    ningunDerived: 'no derived_seg numbers them',
    noSePintan: (id) => <>the scanner Gaussians from {id} are not drawn:</>,
    soloCbct: '. Only the CBCT is shown',
    niApariencia: 'this container carries neither an appearance nor scanner Gaussians: only the CBCT is shown',
    numeracion: 'FDI numbering',
    seleccionOdontograma: 'selection and odontogram',
    por: (quien) => `by ${quien}`,
    unModelo: 'a model',
    capa: (n) => `Layer ${n}`,
    capaNoDeclarada: 'Layer not declared',
    pesos: 'weights',
    noDeclarado: 'not declared',
    unidaPor: (malla) => <>joined through the vertices of {malla}, which fall one to one on the
      scanner Gaussians</>,
    compuestoNumera: (id, n) => <>({id} numbers {n} CBCT Gaussians and none from the
      scanner)</>,
    encia: 'Gingiva',
    visible: 'visible',
    oculta: 'hidden',
    laSepara: (seg, capa) => <>separated by the numbering {seg} ({capa}): code 0 is the gingiva
      and everything the model left unassigned</>,
    vanConElla: (piezas) => ` · teeth ${piezas} go with it`,
    raices: 'Roots',
    cbctPaciente: 'this patient’s CBCT',
    raicesNota: (n, id, de, modelo, capa) =>
      <>{n} CBCT Gaussians from {id} that {de} assigns to a tooth ({modelo} · {capa}). Measured
        density, in display ivory</>,
    modeloNoDeclarado: 'model not declared',
    dienteEntero: 'it is the whole tooth from the CBCT, crown included: what rises above the gingiva is covered by the scan',
    hueso: 'Bone and roots',
    densidad: (medida, id) => <>{medida ? 'measured' : 'unmeasured'} density {id}, in display
      grey: it is hard tissue, not a bone segmentation</>,
    dibujadas: (n, total) => ` · ${n} of ${total} Gaussians`,
    enCanonico: 'already travels in the canonical frame',
    colocadoCon: 'placed with',
    invertida: ' (inverted)',
    provisional: 'provisional: off by default',
    sinVerificar: 'not verified by a person',
    verificada: 'verified',
    cortesIncompletos: (c, i) => <>the CBCT arrives as loose slices: {c.n} over{' '}
      {numero(i, c.extension, 1)} mm, where a complete series every {numero(i, c.paso, 2)} mm
      would have {c.esperados}, and the largest gap is {numero(i, c.hueco, 2)} mm. The stripes
      are the missing slices, not bone: the viewer does not fill them in</>,
    apagadoPorCortes: 'off by default',
    conductos: 'Nerve canals',
    conductosNota: 'this container does not carry that layer, and the viewer does not infer it',
    noEsReferencia: 'This is not reference anatomy fitted to an image: everything drawn belongs to this patient',
    dosModalidades: ', in two modalities joined by a declared registration',
  },
};

export function Procedencia({
  caso, huesoVisible, alCambiarHueso, enciaVisible, alCambiarEncia, raicesVisibles,
  alCambiarRaices,
}: Props) {
  const idioma = useIdioma();
  const t = TEXTOS[idioma];
  const n = (v: number) => numero(idioma, v);
  const mm = (v: number, decimales: number) => numero(idioma, v, decimales);
  const { apariencia, escaner, escanerFallido, hueso, segmentador, hayEtiquetas } = caso;
  if (!apariencia && !escaner && !hueso && !escanerFallido) return null;
  const reg = hueso?.colocacion;
  // El régimen de las etiquetas lo dice SU sidecar, no el visor.
  const seg = caso.segmentaciones.find((s) => s.id === caso.etiquetas);
  const numeradoPorMalla = escaner?.numeracion.usada?.via === 'malla'
    ? escaner.numeracion.usada : null;
  const delCompuesto = escaner?.numeracion.delCompuesto ?? null;
  /** La Capa de un `derived_seg` tal como la declara su sidecar. */
  const capaDe = (id: string) => {
    const capa = caso.segmentaciones.find((s) => s.id === id)?.capa;
    return capa != null ? <span className="l3">{t.capa(capa)}</span>
      : <span className="sinver">{t.capaNoDeclarada}</span>;
  };
  const cortes = hueso?.cortes?.incompleto ? hueso.cortes : null;
  return (
    <aside id="procedencia" aria-label={t.aria}>
      <h3>{t.titulo}</h3>
      <ul>
        {apariencia && (
          <li>
            <span className="muestra-capa corona" aria-hidden="true" />
            <div>
              <b>{t.coronas}</b> · {t.escaneoPaciente}
              <div className="nota">
                {t.colorApariencia} <code>{apariencia.id}</code>
                {apariencia.medida ? t.medido : t.noMedido}
              </div>
            </div>
          </li>
        )}
        {!apariencia && escaner && (
          <li>
            <span className="muestra-capa marfil" aria-hidden="true" />
            <div>
              <b>{t.coronas}</b> · {t.formaEscaner}
              <div className="nota">
                {t.colorVisualizacion}{' '}
                {t.gaussianasDe(n(escaner.n))} <code>{escaner.id}</code>
              </div>
              <div className="nota">
                {'de' in escaner.relieve
                  ? t.relieveCon(<code>{escaner.relieve.de}</code>)
                  : <>{t.sinRelieve} <Diag>{escaner.relieve.sinRelieve}</Diag></>}
              </div>
              {escaner.infladas > 0 && (
                <div className="nota">
                  {t.infladas(n(escaner.infladas), n(escaner.n), mm(escaner.sigmaMinima, 3),
                    mm(escaner.espaciado, 3))}
                </div>
              )}
              {!escaner.numeracion.usada && (
                <div className="nota sinver">
                  {t.sinNumeracion}{' '}
                  {escaner.numeracion.motivo
                    ? <Diag>{escaner.numeracion.motivo}</Diag>
                    : escaner.numeracion.delCompuesto
                      ? t.noNumeraEscaner(escaner.numeracion.delCompuesto.id)
                      : t.ningunDerived}
                </div>
              )}
            </div>
          </li>
        )}
        {!apariencia && !escaner && (
          <li>
            <span className="muestra-capa ausente" aria-hidden="true" />
            <div>
              <b>{t.coronas}</b>
              {escanerFallido
                // El contenedor SÍ las trae: decir que no sería falso.
                ? <div className="nota sinver">{t.noSePintan(<code>{escanerFallido.id}</code>)}{' '}
                  <Diag>{escanerFallido.motivo}</Diag>{t.soloCbct}</div>
                : <div className="nota">{t.niApariencia}</div>}
            </div>
          </li>
        )}
        {hayEtiquetas && (
          <li>
            <span className="muestra-capa numeracion" aria-hidden="true" />
            <div>
              <b>{t.numeracion}</b> · {t.seleccionOdontograma}
              <div className="nota">
                {t.por(segmentador || t.unModelo)}
                {caso.etiquetas && <> · <code>{caso.etiquetas}</code></>} ·{' '}
                {/* La Capa y el régimen, tal como los declara el sidecar: no se suponen. */}
                {seg?.capa != null ? <span className="l3">{t.capa(seg.capa)}</span>
                  : <span className="sinver">{t.capaNoDeclarada}</span>}
                {seg?.estado && <> · {seg.estado}</>}
                {/* El hash va TAL COMO VIENE: si el emisor declara uno equivocado, el visor no
                    lo corrige ni lo esconde. */}
                {seg && (seg.pesos
                  ? <> · {t.pesos} <code title={seg.pesos}>{seg.pesos.slice(0, 12)}…</code></>
                  : <> · {t.pesos} <span className="sinver">{t.noDeclarado}</span></>)}
              </div>
              {numeradoPorMalla && (
                <div className="nota">
                  {t.unidaPor(<code>{numeradoPorMalla.malla}</code>)}
                  {delCompuesto && delCompuesto.escaner === 0 && <>
                    {' '}{t.compuestoNumera(<code>{delCompuesto.id}</code>, n(delCompuesto.resto))}</>}
                </div>
              )}
            </div>
          </li>
        )}
        {caso.encia && (
          <li>
            <label className="capa-conmutable">
              <input type="checkbox" checked={enciaVisible}
                onChange={(e) => alCambiarEncia(e.target.checked)} />
              <span className="muestra-capa encia" aria-hidden="true" />
              <span><b>{t.encia}</b> · {enciaVisible ? t.visible : t.oculta}</span>
            </label>
            <div className="nota">
              {t.laSepara(<code>{caso.etiquetas}</code>,
                caso.etiquetas ? capaDe(caso.etiquetas) : t.capaNoDeclarada)}
              {caso.sinAislar.length > 0 && t.vanConElla(caso.sinAislar.join(', '))}
            </div>
          </li>
        )}
        {caso.raices && (
          <li>
            <label className="capa-conmutable">
              <input type="checkbox" checked={raicesVisibles}
                onChange={(e) => alCambiarRaices(e.target.checked)} />
              <span className="muestra-capa raiz" aria-hidden="true" />
              <span><b>{t.raices}</b> · {t.cbctPaciente}</span>
            </label>
            <div className="nota">
              {t.raicesNota(n(caso.raices.n), <code>{caso.raices.id}</code>,
                <code>{caso.raices.de}</code>, caso.raices.modelo ?? t.modeloNoDeclarado,
                capaDe(caso.raices.de))}
            </div>
            <div className="nota">{t.dienteEntero}</div>
          </li>
        )}
        {hueso && reg && (
          <li>
            <label className="capa-conmutable">
              <input type="checkbox" checked={huesoVisible}
                onChange={(e) => alCambiarHueso(e.target.checked)} />
              <span className="muestra-capa hueso" aria-hidden="true" />
              <span><b>{t.hueso}</b> · {t.cbctPaciente}</span>
            </label>
            <div className="nota">
              {t.densidad(hueso.medida, <code>{hueso.id}</code>)}
              {hueso.dibujadas < hueso.total && t.dibujadas(n(hueso.dibujadas), n(hueso.total))}
            </div>
            {cortes && (
              // ⚠️ Lo primero que hay que saber de esta capa, antes que la registración: si
              // no se dice, las franjas parecen un fallo del visor o, peor, anatomía.
              <div className="nota sinver">
                {t.cortesIncompletos(cortes, idioma)}
                {!reg.provisional && <> · <span className="prov">{t.apagadoPorCortes}</span></>}
              </div>
            )}
            <div className="nota">
              {reg.pasos.length === 0
                ? t.enCanonico
                : <>{t.colocadoCon} {reg.pasos.map((p) => (
                    <span key={p.registro.id}>
                      <code>{p.registro.id}</code>{p.invertido ? t.invertida : ''}{' '}
                      <span className="k">{p.registro.method}</span>
                      {p.registro.rms_error_mm != null
                        && <> · rms {mm(p.registro.rms_error_mm, 2)} mm</>}{' '}
                    </span>
                  ))}
                  {reg.provisional
                    ? <span className="prov">{t.provisional}</span>
                    : reg.sinVerificar
                      ? <span className="sinver">{t.sinVerificar}</span>
                      : <span className="b">{t.verificada}</span>}
                </>}
            </div>
          </li>
        )}
        <li>
          <span className="muestra-capa conducto" aria-hidden="true" />
          <div>
            <b>{t.conductos}</b>
            <div className="nota">{t.conductosNota}</div>
          </div>
        </li>
      </ul>
      <p className="nota">
        {t.noEsReferencia}{hueso && (apariencia || escaner) ? t.dosModalidades : ''}.
      </p>
    </aside>
  );
}
