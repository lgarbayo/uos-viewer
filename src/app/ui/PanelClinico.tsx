/** La esquina «Clínico»: medidas globales del informe y motivos de la revisión humana. */

import type { CapaClinica } from '../../uos/Clinico';

export function PanelClinico({ clinico }: { clinico: CapaClinica }) {
  const motivos = clinico.review.reasons;
  return (
    <div className="cols cols-2">
      <div className="bloque">
        <h3>Medidas globales · <span className="n">{clinico.measurements.length}</span></h3>
        <div className="desliza">
          <ul className="medidas">
            {clinico.measurements.length === 0
              && <li className="nota">el informe no trae medidas globales</li>}
            {clinico.measurements.map((x, i) => (
              <li key={i} className={x.out_of_range ? 'fuera' : ''}>{x.name}{' '}
                {x.side && <span className="b">{x.side}</span>}{' '}
                <b>{x.value}{x.unit}</b>{' '}
                <span className="b">{x.normal_min ?? '—'}–{x.normal_max ?? '—'}</span>{' '}
                {x.out_of_range && <span className="l3">fuera</span>}
              </li>
            ))}
          </ul>
          <p className="nota">{clinico.schema} — extensión del emisor, no UOS v0.2 ·
            Layer {clinico.regulatory.layer} · {clinico.vocabulary}</p>
        </div>
      </div>
      <div className="bloque">
        <h3>Revisión humana · <span className="n">{motivos.length}</span> motivo(s)</h3>
        <div className="desliza">
          <ul className="gate">
            {motivos.length === 0
              && <li className="nota">ninguno: nada de este contenedor pide revisión</li>}
            {motivos.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </div>
      </div>
    </div>
  );
}
