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
}

export function Procedencia({
  caso, huesoVisible, alCambiarHueso, numeracion, alCambiarNumeracion,
}: Props) {
  const { apariencia, escaner, hueso, segmentador, hayEtiquetas } = caso;
  if (!apariencia && !escaner && !hueso) return null;
  const reg = hueso?.colocacion;
  // El régimen de las etiquetas lo dice SU sidecar, no el visor.
  const seg = caso.segmentaciones.find((s) => s.id === caso.etiquetas);
  const numeradoPorMalla = escaner?.numeracion.usada?.via === 'malla'
    ? escaner.numeracion.usada : null;
  const delCompuesto = escaner?.numeracion.delCompuesto ?? null;
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
                color de visualización, no del paciente: este caso no trae apariencia ·{' '}
                {escaner.n.toLocaleString('es')} gaussianas de <code>{escaner.id}</code>
              </div>
              <div className="nota">
                {'de' in escaner.relieve
                  ? <>relieve con las normales de <code>{escaner.relieve.de}</code>; la malla
                    no se dibuja</>
                  : <>sin relieve: {escaner.relieve.sinRelieve}</>}
              </div>
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
              <div className="nota">este contenedor no trae ni apariencia ni gaussianas del
                escáner: sólo se ve el CBCT</div>
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
              <span className="l3">Capa {seg?.capa ?? 3}</span>
              {seg?.estado && <> · {seg.estado}</>}
              {/* El hash va TAL COMO VIENE: si el emisor declara uno equivocado, el visor no
                  lo corrige ni lo esconde. */}
              {seg?.pesos && <> · pesos <code title={seg.pesos}>{seg.pesos.slice(0, 12)}…</code></>}
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
                        && <> · rms {p.registro.rms_error_mm.toFixed(2)} mm</>}{' '}
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
