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
}

export function Procedencia({ caso, huesoVisible, alCambiarHueso }: Props) {
  const { apariencia, hueso, segmentador, hayEtiquetas } = caso;
  if (!apariencia && !hueso) return null;
  const reg = hueso?.colocacion;
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
              {hayEtiquetas && (
                <div className="nota">numeradas por {segmentador || 'un modelo'} ·{' '}
                  <span className="l3">Capa 3</span></div>
              )}
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
                && ` · ${hueso.dibujadas.toLocaleString()} de ${hueso.total.toLocaleString()} gaussianas`}
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
        paciente{hueso ? ', en dos modalidades unidas por una registración declarada' : ''}.
      </p>
    </aside>
  );
}
