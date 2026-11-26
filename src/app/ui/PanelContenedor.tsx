/**
 * La esquina «Contenedor»: assets, regeneración, registraciones, fidelidad y reparos.
 *
 * ⚠️ **Los assets fluyen a lo ANCHO, no en una columna.** Iban en una tabla dentro de un
 * tercio del modal: diecinueve filas en un hueco donde caben ocho, así que once quedaban por
 * debajo del corte. En rejilla caben los diecinueve a la vez.
 */

import { useEffect, useRef, useState } from 'react';

import type { Asset } from '../../uos/Manifest';
import { esProvisional } from '../../uos/Manifest';
import type { UosLoader } from '../../uos/UosLoader';
import type { Caso } from '../Caso';
import { construye3mf, regenera, type Regenerado } from '../Regenera';
import type { Segmentacion } from '../Segmentacion';
import { baja } from './descargas';
import { useTemporal } from './useTemporal';

export function PanelContenedor({ caso }: { caso: Caso }) {
  const { uos, manifiesto: m, reparos, fidelidad } = caso;
  const fuera = uos.porPrioridad.filter((a) => a.external).length;
  return (
    <div className="filas">
      {fidelidad && (
        <div className="bloque">
          <h3>Fidelidad y procedencia</h3>
          <p className="nota">Declaraciones del emisor; no certifican aptitud clínica.
            Desconocido significa que no hay evidencia suficiente.</p>
          <ul>{fidelidad.map((a) => (
            <li key={a.id}>
              <b>{a.id}</b> · origen {a.origen} · fuentes {a.fuentes} · historia{' '}
              {a.historiaDeclarada ? 'declarada' : 'desconocida'} · pérdidas registradas{' '}
              {a.perdidas} · repetibilidad {a.repetibilidad}
            </li>
          ))}</ul>
        </div>
      )}
      <div className="bloque">
        <h3>
          Assets · <span className="n">{uos.porPrioridad.length}</span> · por prioridad de carga
          {fuera > 0 && <> · <span className="n">{fuera}</span> declarado(s) fuera</>}
        </h3>
        <div className="desliza"><div className="rejilla-assets">
          {uos.porPrioridad.map((a) => <FichaAsset key={a.id} uos={uos} asset={a} />)}
        </div></div>
      </div>
      {caso.segmentaciones.length > 0 && <Inferencia segmentaciones={caso.segmentaciones} />}
      <div className="cols cols-3">
        <div className="bloque">
          <h3>Regeneración local · geometría y apariencia</h3>
          <div className="desliza">
            <p className="nota">El STL mejorado <b>no viaja</b> dentro: serían 19 MB para
              duplicar una geometría que este contenedor sabe reconstruir. De{' '}
              <code>asset.scene</code> y el color de <code>asset.apariencia</code> sale
              aquí mismo, sin subir nada a ningún sitio.</p>
            <Regeneracion uos={uos} />
          </div>
        </div>
        <div className="bloque">
          <h3>Registraciones · <span className="n">{m.registrations.length}</span></h3>
          <div className="desliza"><ul>
            {m.registrations.length === 0 && <li className="nota">ninguna</li>}
            {m.registrations.map((r) => (
              // ⚠️ Dos etiquetas distintas y no una. El spec (§6) llama PROVISIONAL a la
              // registración automática por aprendizaje que nadie ha mirado. Una
              // `icp_surface` sin verificar tampoco está firmada, pero no es lo mismo: un
              // ajuste geométrico converge o no, y se puede leer su residuo.
              <li key={r.id}>{r.id}<br />
                <span className="b">{r.source_frame} → {r.target_frame}</span>{' '}
                <span className="k">{r.method}</span>{' '}
                {r.rms_error_mm != null && <span className="b">rms {r.rms_error_mm.toFixed(3)} mm</span>}{' '}
                {esProvisional(r)
                  ? <span className="prov">provisional</span>
                  : r.verified_by
                    ? <span className="b">verificada por {r.verified_by}</span>
                    : <span className="sinver">sin verificar</span>}
              </li>
            ))}
          </ul></div>
        </div>
        <div className="bloque">
          <h3>Reparos · <span className="n">{reparos.length}</span></h3>
          <div className="desliza">
            <ul className="reparos">
              {reparos.length === 0 && <li className="nota">el contenedor no se contradice en
                nada de lo que este visor comprueba</li>}
              {reparos.map((r, i) => <li key={i} className={r.grave ? 'grave' : ''}>{r.texto}</li>)}
            </ul>
            <p className="nota">Un asset <b>fuera</b> no es un reparo: el formato declara el
              original por su dirección de contenido y deja su custodia a otro sistema. Que
              no esté dentro es lo que el contenedor afirma, no lo que incumple.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function FichaAsset({ uos, asset: a }: { uos: UosLoader; asset: Asset }) {
  return (
    <div className="asset">
      <div className="id" title={a.id}><b>{a.id}</b></div>
      <div className="uri">{a.uri}</div>
      <div className="pie">
        <span className="k">{a.kind}</span>
        <span className="b">{a.frame}</span>
        <span className="b">{(a.bytes / 1e6).toFixed(1)} MB</span>
        {a.parts && <span className="b">{a.parts.length} partes</span>}
      </div>
      <div className="pie">{
        // ⚠️ Un asset EXTERNO no se puede guardar porque no está: ofrecer el botón sería
        // prometer un fichero que el contenedor no lleva. Lo que sí se puede hacer es decir
        // por su hash CUÁL es, que es exactamente lo que el `.uos` afirma de él.
        a.external
          ? <span className="l3">fuera · sólo su hash</span>
          : a.uri.endsWith('/') ? null : <BotonGuardar uos={uos} asset={a} />
      }</div>
    </div>
  );
}

/**
 * Saca un asset del contenedor al disco, VERIFICANDO su `sha256` antes.
 *
 * ⚠️ El §8 del spec deja la verificación como política del cliente —opcional al
 * visualizar, **obligatoria en ingesta y export**— y sacar un fichero del contenedor **es
 * un export**. Si el hash no cuadra NO se guarda: un fichero que no es el que dice ser,
 * entregado igual con un aviso al lado, se convierte en el fichero bueno en cuanto el aviso
 * se cierra.
 */
function BotonGuardar({ uos, asset }: { uos: UosLoader; asset: Asset }) {
  const [texto, setTexto] = useState<string | null>(null);
  const [malo, setMalo] = useState(false);
  const luego = useTemporal();

  async function guarda(): Promise<void> {
    setTexto('verificando…');
    try {
      const bytes = await uos.bytes(asset);
      if (!(await uos.verifica(asset))) {
        setTexto('hash NO cuadra');
        setMalo(true);
        return;
      }
      baja(bytes, asset.uri.split('/').pop() || asset.id, asset.media_type);
      setTexto('guardado ✓');
    } catch (e) {
      setTexto(e instanceof Error ? e.message.slice(0, 40) : 'falló');
      setMalo(true);
    } finally {
      luego(() => { setTexto(null); setMalo(false); }, 4000);
    }
  }

  return (
    <button className={`guardar${malo ? ' malo' : ''}`} disabled={texto !== null}
      onClick={() => void guarda()}>
      {texto ?? 'guardar'}
    </button>
  );
}

/**
 * Regenera la arcada coloreada y la ofrece al disco.
 *
 * ⚠️ **Aquí NO se verifica ningún hash, y la diferencia importa.** Esto es un fichero NUEVO,
 * calculado ahora, del que el contenedor no afirma ningún hash. Lo que sí viaja con él es
 * su `.meta.json`, que dice de qué dos assets salió, con sus hashes.
 *
 * ⚠️ **Cerrar el modal CANCELA el cálculo.** El Worker se termina en la limpieza del efecto;
 * antes seguía veinte segundos calculando para entregar el resultado a un DOM ya borrado.
 */
function Regeneracion({ uos }: { uos: UosLoader }) {
  const [estado, setEstado] = useState('');
  const [boton, setBoton] = useState<{ texto: string; malo: boolean } | null>(null);
  const [hecho, setHecho] = useState<Regenerado | null>(null);
  const [error, setError] = useState<string | null>(null);
  const corte = useRef<AbortController | null>(null);
  const luego = useTemporal();

  useEffect(() => () => corte.current?.abort(), []);

  async function lanza(): Promise<void> {
    corte.current?.abort();
    const c = new AbortController();
    corte.current = c;
    setBoton({ texto: 'regenerando…', malo: false });
    setHecho(null);
    setError(null);
    try {
      const r = await regenera(uos, (t) => { if (!c.signal.aborted) setEstado(t); }, undefined, c.signal);
      if (c.signal.aborted) return;
      setHecho(r);
      setEstado('');
      setBoton({ texto: 'regenerada ✓', malo: false });
    } catch (e) {
      if (c.signal.aborted) return;
      setError(e instanceof Error ? e.message : String(e));
      setBoton({ texto: 'falló', malo: true });
    } finally {
      if (!c.signal.aborted) luego(() => setBoton(null), 6000);
    }
  }

  return (
    <>
      <p>
        <button className={`guardar${boton?.malo ? ' malo' : ''}`} disabled={boton !== null}
          onClick={() => void lanza()}>
          {boton?.texto ?? 'regenerar arcada con color'}
        </button>
      </p>
      <div className="nota">
        {estado}
        {error && <p className="error">{error}</p>}
        {hecho && <Resultado r={hecho} />}
      </div>
    </>
  );
}

function Resultado({ r }: { r: Regenerado }) {
  const pct = ((r.medidos / r.vertices) * 100).toFixed(1);
  const [tresMf, setTresMf] = useState<{ texto: string; malo: boolean } | null>(null);
  return (
    <>
      <p className="nota">{r.vertices.toLocaleString('es')} vértices ·{' '}
        {r.triangulos.toLocaleString('es')} triángulos</p>
      <p className="nota">color <b>medido</b> en el {pct} % ·{' '}
        {r.conFdi.toLocaleString('es')} con código FDI ·{' '}
        {r.rellenados.toLocaleString('es')} hueco(s) heredados de su misma pieza</p>
      <p>
        <button className="guardar" onClick={() => baja(r.ply, 'arcada-color.ply', 'application/octet-stream')}>
          .ply · con color, FDI y medido</button>{' '}
        <button className={`guardar${tresMf?.malo ? ' malo' : ''}`} disabled={tresMf?.texto === 'construyendo…'}
          onClick={() => {
            // ⚠️ El 3MF se construye AL PEDIRLO: son veinticinco megas de XML, y hacerlo
            // con el resto costaría un par de segundos de página parada a quien no lo quiere.
            setTresMf({ texto: 'construyendo…', malo: false });
            void construye3mf(
              r.posiciones, r.caras, r.rgb,
              `arcada regenerada desde un .uos por uos-viewer · ${r.vertices} vertices · ` +
                `${pct} % con color medido del paciente`,
            ).then(
              (b) => { baja(b, 'arcada-color.3mf', 'model/3mf'); setTresMf(null); },
              (e: unknown) => setTresMf({
                texto: e instanceof Error ? e.message.slice(0, 30) : 'falló', malo: true }),
            );
          }}>
          {tresMf?.texto ?? '.3mf · con color, para imprimir'}</button>{' '}
        <button className="guardar" onClick={() => baja(r.stl, 'arcada-color.stl', 'model/stl')}>
          .stl · sólo geometría</button>{' '}
        <button className="guardar" onClick={() => baja(r.meta, 'arcada-color.meta.json', 'application/json')}>
          .meta.json</button>
      </p>
    </>
  );
}

/**
 * Lo que declaran las segmentaciones de `derived/`: modelo, versión, pesos, régimen, y qué
 * hizo el margen gingival.
 *
 * ⚠️ **Lo que el sidecar trae a `null` se enseña como «no declarado», y no se rellena.** El
 * visor no sabe qué modelo se usó; sabe lo que el contenedor afirma. Un hash de pesos que
 * falta es información —no se puede reproducir la inferencia— y taparlo la perdería.
 */
function Inferencia({ segmentaciones }: { segmentaciones: readonly Segmentacion[] }) {
  return (
    <div className="bloque derived">
      <h3>Inferencia · <span className="n">{segmentaciones.length}</span> segmentación(es) en{' '}
        <code>derived/</code></h3>
      <p className="nota">Salida de modelos: no es una medida ni un diagnóstico, y se puede
        quitar del contenedor sin romperlo.</p>
      <div className="rejilla-seg">
        {segmentaciones.map((s) => <FichaSegmentacion key={s.id} s={s} />)}
      </div>
    </div>
  );
}

const noDeclarado = <span className="sinver">no declarado</span>;

function FichaSegmentacion({ s }: { s: Segmentacion }) {
  const fuera = s.frontera
    ? [...s.frontera].filter(([, t]) => !t.within_expert_range).map(([f]) => f).sort((a, b) => a - b)
    : [];
  const m = s.margen;
  const anclas = m ? [...m.teeth].filter(([, t]) => !t.declined && t.moved > 0).map(([f]) => f) : [];
  const declinadas = m ? [...m.teeth].filter(([, t]) => t.declined).map(([f]) => f).sort((a, b) => a - b) : [];
  return (
    <div className="asset seg">
      <div className="id" title={s.id}><b>{s.id}</b></div>
      <div className="uri">{s.uri}</div>
      <dl>
        <dt>modelo</dt><dd>{s.modelo ?? noDeclarado}</dd>
        <dt>versión</dt><dd>{s.version ?? noDeclarado}</dd>
        <dt>pesos</dt><dd>{s.pesos
          ? <code title={s.pesos}>sha256:{s.pesos.slice(0, 12)}…</code> : noDeclarado}</dd>
        <dt>régimen</dt><dd>
          {s.capa !== null ? <span className="l3">Capa {s.capa}</span> : noDeclarado}
          {s.estado && <> · {s.estado}</>}
          {s.jurisdicciones.length > 0 && <> · {s.jurisdicciones.join(', ')}</>}
        </dd>
        <dt>indexa</dt><dd>{s.fuentes.join(', ') || noDeclarado}
          {s.etiquetadas !== null && s.total !== null
            && <span className="b"> · {s.etiquetadas.toLocaleString('es')} de {s.total.toLocaleString('es')} con pieza</span>}</dd>
        <dt>piezas</dt><dd>{s.piezas.length ? s.piezas.join(' ') : <span className="b">ninguna</span>}</dd>
        {s.generado && <><dt>generada</dt><dd>{s.generado.slice(0, 10)}</dd></>}
        {s.frontera && <><dt>frontera</dt><dd>{fuera.length
          ? <span className="sinver">fuera del rango de experto: {fuera.join(', ')}</span>
          : 'todas dentro del rango de experto'}</dd></>}
        <dt>margen</dt><dd>{m
          ? <>{m.applied ? 'aplicado' : <span className="sinver">propuesto, no aplicado</span>}
              {m.criterion && <> · criterio {m.criterion}</>}
              {' · '}{anclas.length} pieza(s) ancladas al surco
              {declinadas.length > 0 && <> · sin surco claro: {declinadas.join(', ')}</>}
              <div className="b">{m.method}{Object.entries(m.thresholds).map(([k, v]) => ` · ${k} ≥ ${v}`).join('')}</div></>
          : <span className="b">no se ejecutó</span>}</dd>
      </dl>
    </div>
  );
}
