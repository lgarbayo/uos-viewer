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
 */

import type { Caso } from '../Caso';

interface Props {
  readonly caso: Caso;
  readonly huesoVisible: boolean;
  readonly alCambiarHueso: (si: boolean) => void;
  readonly numeracion: boolean;
  readonly alCambiarNumeracion: (si: boolean) => void;
  readonly enciaVisible: boolean;
  readonly alCambiarEncia: (si: boolean) => void;
  readonly raicesVisibles: boolean;
  readonly alCambiarRaices: (si: boolean) => void;
}

/** Milímetros con coma decimal y un número fijo de decimales, como el resto del panel. */
function mm(v: number, decimales: number): string {
  return v.toLocaleString('es', { minimumFractionDigits: decimales, maximumFractionDigits: decimales });
}

export function Procedencia({
  caso, huesoVisible, alCambiarHueso, numeracion, alCambiarNumeracion,
  enciaVisible, alCambiarEncia, raicesVisibles, alCambiarRaices,
}: Props) {
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
    return capa != null ? <span className="l3">Capa {capa}</span>
      : <span className="sinver">Capa no declarada</span>;
  };
  return (
    <aside id="procedencia" aria-label="Qué se ve y de dónde sale">
      <h3>Qué se ve</h3>
      <ul>
        {apariencia && (
          <li>
            <span className="muestra-capa corona" aria-hidden="true" />
            <div>
              <b>Coronas</b> · escaneo intraoral de este paciente
              <div className="nota">
                color de la apariencia 3DGS <code>{apariencia.id}</code>
                {apariencia.medida ? ' · medido' : ' · no medido'}
              </div>
            </div>
          </li>
        )}
        {!apariencia && escaner && (
          <li>
            <span className="muestra-capa marfil" aria-hidden="true" />
            <div>
              <b>Coronas</b> · forma medida del escáner
              <div className="nota">
                color y opacidad de visualización, no del paciente: este caso no trae
                apariencia ·{' '}
                {escaner.n.toLocaleString('es')} gaussianas de <code>{escaner.id}</code>
              </div>
              <div className="nota">
                {'de' in escaner.relieve
                  ? <>relieve con las normales de <code>{escaner.relieve.de}</code>; la malla
                    no se dibuja</>
                  : <>sin relieve: {escaner.relieve.sinRelieve}</>}
              </div>
              {escaner.infladas > 0 && (
                <div className="nota">
                  {escaner.infladas.toLocaleString('es')} de {escaner.n.toLocaleString('es')} se
                  dibujan con σ ≥ {mm(escaner.sigmaMinima, 3)} mm (90 % del espaciado medido,
                  {' '}{mm(escaner.espaciado, 3)} mm): tamaño de visualización, no medido
                </div>
              )}
              {!escaner.numeracion.usada && (
                <div className="nota sinver">
                  sin numeración en las coronas:{' '}
                  {escaner.numeracion.motivo
                    ?? (escaner.numeracion.delCompuesto
                      ? <>{escaner.numeracion.delCompuesto.id} no numera ninguna gaussiana
                        del escáner</>
                      : 'ningún derived_seg las numera')}
                </div>
              )}
            </div>
          </li>
        )}
        {!apariencia && !escaner && (
          <li>
            <span className="muestra-capa ausente" aria-hidden="true" />
            <div>
              <b>Coronas</b>
              {escanerFallido
                // El contenedor SÍ las trae: decir que no sería falso.
                ? <div className="nota sinver">las gaussianas del escáner de{' '}
                  <code>{escanerFallido.id}</code> no se pintan: {escanerFallido.motivo}. Sólo
                  se ve el CBCT</div>
                : <div className="nota">este contenedor no trae ni apariencia ni gaussianas del
                  escáner: sólo se ve el CBCT</div>}
            </div>
          </li>
        )}
        {hayEtiquetas && (
          <li>
            <label className="capa-conmutable">
              <input type="checkbox" checked={numeracion}
                onChange={(e) => alCambiarNumeracion(e.target.checked)} />
              <span className="muestra-capa numeracion" aria-hidden="true" />
              <span><b>Numeración FDI</b> · selección y odontograma</span>
            </label>
            <div className="nota">
              por {segmentador || 'un modelo'}
              {caso.etiquetas && <> · <code>{caso.etiquetas}</code></>} ·{' '}
              {/* La Capa y el régimen, tal como los declara el sidecar: no se suponen. */}
              {seg?.capa != null ? <span className="l3">Capa {seg.capa}</span>
                : <span className="sinver">Capa no declarada</span>}
              {seg?.estado && <> · {seg.estado}</>}
              {/* El hash va TAL COMO VIENE: si el emisor declara uno equivocado, el visor no
                  lo corrige ni lo esconde. */}
              {seg && (seg.pesos
                ? <> · pesos <code title={seg.pesos}>{seg.pesos.slice(0, 12)}…</code></>
                : <> · pesos <span className="sinver">no declarado</span></>)}
            </div>
            {numeradoPorMalla && (
              <div className="nota">
                unida por los vértices de <code>{numeradoPorMalla.malla}</code>, que caen uno a
                uno sobre las gaussianas del escáner
                {delCompuesto && delCompuesto.escaner === 0 && <>
                  {' '}(<code>{delCompuesto.id}</code> numera{' '}
                  {delCompuesto.resto.toLocaleString('es')} gaussianas del CBCT y ninguna del
                  escáner)</>}
              </div>
            )}
          </li>
        )}
        {caso.encia && (
          <li>
            <label className="capa-conmutable">
              <input type="checkbox" checked={enciaVisible} disabled={!numeracion}
                onChange={(e) => alCambiarEncia(e.target.checked)} />
              <span className="muestra-capa encia" aria-hidden="true" />
              <span><b>Encía</b> · {enciaVisible ? 'visible' : 'oculta'}</span>
            </label>
            <div className="nota">
              {numeracion
                ? <>lo separa la numeración <code>{caso.etiquetas}</code> (
                  {caso.etiquetas ? capaDe(caso.etiquetas) : 'Capa no declarada'}): el código 0
                  es la encía y todo lo que el modelo no asignó</>
                : 'sin numeración no hay corte: se ve todo lo medido'}
              {caso.sinAislar.length > 0 && <> · las piezas {caso.sinAislar.join(', ')} van
                con ella</>}
            </div>
          </li>
        )}
        {caso.raices && (
          <li>
            <label className="capa-conmutable">
              <input type="checkbox" checked={raicesVisibles}
                onChange={(e) => alCambiarRaices(e.target.checked)} />
              <span className="muestra-capa raiz" aria-hidden="true" />
              <span><b>Raíces</b> · CBCT de este paciente</span>
            </label>
            <div className="nota">
              {caso.raices.n.toLocaleString('es')} gaussianas del CBCT de{' '}
              <code>{caso.raices.id}</code> que <code>{caso.raices.de}</code> asigna a una pieza
              ({caso.raices.modelo ?? 'modelo no declarado'} · {capaDe(caso.raices.de)}).
              Densidad medida, en marfil de visualización
            </div>
            <div className="nota">
              es el diente entero del CBCT, corona incluida: lo que asoma por encima de la encía
              lo tapa el escáner
            </div>
          </li>
        )}
        {hueso && reg && (
          <li>
            <label className="capa-conmutable">
              <input type="checkbox" checked={huesoVisible}
                onChange={(e) => alCambiarHueso(e.target.checked)} />
              <span className="muestra-capa hueso" aria-hidden="true" />
              <span><b>Hueso y raíces</b> · CBCT de este paciente</span>
            </label>
            <div className="nota">
              densidad {hueso.medida ? 'medida' : 'no medida'} <code>{hueso.id}</code>, en gris
              de visualización: es tejido duro, no una segmentación del hueso
              {hueso.dibujadas < hueso.total
                && ` · ${hueso.dibujadas.toLocaleString('es')} de ${hueso.total.toLocaleString('es')} gaussianas`}
            </div>
            <div className="nota">
              {reg.pasos.length === 0
                ? 'ya viaja en el marco canónico'
                : <>colocado con {reg.pasos.map((p) => (
                    <span key={p.registro.id}>
                      <code>{p.registro.id}</code>{p.invertido ? ' (invertida)' : ''}{' '}
                      <span className="k">{p.registro.method}</span>
                      {p.registro.rms_error_mm != null
                        && <> · rms {mm(p.registro.rms_error_mm, 2)} mm</>}{' '}
                    </span>
                  ))}
                  {reg.provisional
                    ? <span className="prov">provisional: apagado por defecto</span>
                    : reg.sinVerificar
                      ? <span className="sinver">sin verificar por una persona</span>
                      : <span className="b">verificada</span>}
                </>}
            </div>
          </li>
        )}
        <li>
          <span className="muestra-capa conducto" aria-hidden="true" />
          <div>
            <b>Conductos nerviosos</b>
            <div className="nota">este contenedor no trae esa capa, y el visor no la infiere</div>
          </div>
        </li>
      </ul>
      <p className="nota">
        No es anatomía de referencia ajustada a una imagen: todo lo dibujado es de este
        paciente{hueso && (apariencia || escaner)
          ? ', en dos modalidades unidas por una registración declarada' : ''}.
      </p>
    </aside>
  );
}
