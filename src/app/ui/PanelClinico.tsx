/** La esquina «Clínico»: medidas globales del informe y motivos de la revisión humana. */

import type { ReactNode } from 'react';

import type { CapaClinica } from '../../uos/Clinico';
import { useIdioma, type Idioma } from './idioma';

const es = {
  medidas: 'Medidas globales',
  sinMedidas: 'el informe no trae medidas globales',
  // `out_of_range` de la medida: fuera del rango normal, no un recurso externo.
  fuera: 'fuera',
  extension: 'extensión del emisor, no UOS v0.2',
  capa: 'Layer',
  revision: 'Revisión humana',
  motivos: (n: ReactNode) => <>{n} motivo(s)</>,
  ninguno: 'ninguno: nada de este contenedor pide revisión',
};

const TEXTOS: Record<Idioma, typeof es> = {
  es,
  en: {
    medidas: 'Global measurements',
    sinMedidas: 'the report carries no global measurements',
    fuera: 'out of range',
    extension: 'emitter extension, not UOS v0.2',
    capa: 'Layer',
    revision: 'Human review',
    motivos: (n) => <>{n} reason(s)</>,
    ninguno: 'none: nothing in this container asks for review',
  },
};

export function PanelClinico({ clinico }: { clinico: CapaClinica }) {
  const t = TEXTOS[useIdioma()];
  const motivos = clinico.review.reasons;
  return (
    <div className="cols cols-2">
      <div className="bloque">
        <h3>{t.medidas} · <span className="n">{clinico.measurements.length}</span></h3>
        <div className="desliza">
          <ul className="medidas">
            {clinico.measurements.length === 0
              && <li className="nota">{t.sinMedidas}</li>}
            {clinico.measurements.map((x, i) => (
              <li key={i} className={x.out_of_range ? 'fuera' : ''}>{x.name}{' '}
                {x.side && <span className="b">{x.side}</span>}{' '}
                <b>{x.value}{x.unit}</b>{' '}
                <span className="b">{x.normal_min ?? '—'}–{x.normal_max ?? '—'}</span>{' '}
                {x.out_of_range && <span className="l3">{t.fuera}</span>}
              </li>
            ))}
          </ul>
          <p className="nota">{clinico.schema} — {t.extension} ·{' '}
            {t.capa} {clinico.regulatory.layer} · {clinico.vocabulary}</p>
        </div>
      </div>
      <div className="bloque">
        <h3>{t.revision} · {t.motivos(<span className="n">{motivos.length}</span>)}</h3>
        <div className="desliza">
          <ul className="gate">
            {motivos.length === 0
              && <li className="nota">{t.ninguno}</li>}
            {motivos.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </div>
      </div>
    </div>
  );
}
