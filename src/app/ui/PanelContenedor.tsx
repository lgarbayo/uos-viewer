/**
 * La esquina «Contenedor»: assets, regeneración, registraciones, fidelidad y reparos.
 *
 * ⚠️ **Los assets fluyen a lo ANCHO, no en una columna.** Iban en una tabla dentro de un
 * tercio del modal: diecinueve filas en un hueco donde caben ocho, así que once quedaban por
 * debajo del corte. En rejilla caben los diecinueve a la vez.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';

import type { Asset } from '../../uos/Manifest';
import { esProvisional } from '../../uos/Manifest';
import type { UosLoader } from '../../uos/UosLoader';
import type { Caso, FidelidadAsset } from '../Caso';
import { construye3mf, regenera, type ProgresoRegenera, type Regenerado } from '../Regenera';
import type { Segmentacion } from '../Segmentacion';
import { baja } from './descargas';
import { numero, useIdioma, type Idioma } from './idioma';
import { useTemporal } from './useTemporal';

/** Un diagnóstico que escribe el visor o el lector en español: va marcado como tal. */
const Diag = ({ children }: { children: ReactNode }) => <span lang="es">{children}</span>;

const es = {
  fidelidad: 'Fidelidad y procedencia',
  fidelidadNota: 'Declaraciones del emisor; no certifican aptitud clínica. Desconocido significa que no hay evidencia suficiente.',
  fidelidadFila: (a: FidelidadAsset) => <><b>{a.id}</b> · origen {a.origen} · fuentes {a.fuentes} · historia{' '}
    {a.historiaDeclarada ? 'declarada' : 'desconocida'} · pérdidas registradas{' '}
    {a.perdidas} · repetibilidad {a.repetibilidad}</>,
  porPrioridad: ' · por prioridad de carga',
  declaradosFuera: (n: ReactNode) => <> · {n} declarado(s) fuera</>,
  regeneracion: 'Regeneración local · geometría y apariencia',
  regeneracionNota: <>El STL mejorado <b>no viaja</b> dentro: serían 19 MB para
    duplicar una geometría que este contenedor sabe reconstruir. De{' '}
    <code>asset.scene</code> y el color de <code>asset.apariencia</code> sale
    aquí mismo, sin subir nada a ningún sitio.</>,
  registraciones: 'Registraciones · ',
  ninguna: 'ninguna',
  provisional: 'provisional',
  verificadaPor: (quien: string) => `verificada por ${quien}`,
  sinVerificar: 'sin verificar',
  reparos: 'Reparos · ',
  sinReparos: 'el contenedor no se contradice en nada de lo que este visor comprueba',
  fueraNoEsReparo: <>Un asset <b>fuera</b> no es un reparo: el formato declara el
    original por su dirección de contenido y deja su custodia a otro sistema. Que
    no esté dentro es lo que el contenedor afirma, no lo que incumple.</>,
  partes: (n: number) => `${n} partes`,
  fueraSoloHash: 'fuera · sólo su hash',
  verificando: 'verificando…',
  noCuadra: 'hash NO cuadra',
  guardado: 'guardado ✓',
  fallo: 'falló',
  guardar: 'guardar',
  regenerando: 'regenerando…',
  regenerada: 'regenerada ✓',
  regenerar: 'regenerar arcada con color',
  progreso: (p: ProgresoRegenera, i: Idioma) => ({
    leyendo: 'leyendo el gemelo…',
    mezclando: `mezclando ${'vertices' in p ? numero(i, p.vertices) : ''} vértices…`,
    color: `mezclando color… ${'fraccion' in p ? Math.round(p.fraccion * 100) : ''} %`,
    escribiendo: 'escribiendo los ficheros…',
  })[p.fase],
  verticesTriangulos: (v: string, t: string) => `${v} vértices · ${t} triángulos`,
  colorMedido: (pct: string, fdi: string, rellenados: string) => <>color <b>medido</b> en el {pct} %
    ·{' '}{fdi} con código FDI ·{' '}{rellenados} hueco(s) heredados de su misma pieza</>,
  ply: '.ply · con color, FDI y medido',
  construyendo: 'construyendo…',
  tresMf: '.3mf · con color, para imprimir',
  stl: '.stl · sólo geometría',
  inferencia: (n: ReactNode) => <>Inferencia · {n} segmentación(es) en{' '}
    <code>derived/</code></>,
  inferenciaNota: 'Salida de modelos: no es una medida ni un diagnóstico, y se puede quitar del contenedor sin romperlo.',
  noDeclarado: 'no declarado',
  modelo: 'modelo',
  version: 'versión',
  pesos: 'pesos',
  regimen: 'régimen',
  capa: (n: number) => `Capa ${n}`,
  indexa: 'indexa',
  conPieza: (n: string, total: string) => ` · ${n} de ${total} con pieza`,
  piezas: 'piezas',
  generada: 'generada',
  frontera: 'frontera',
  fueraDelRango: (fdi: string) => `fuera del rango de experto: ${fdi}`,
  todasDentro: 'todas dentro del rango de experto',
  margen: 'margen',
  aplicado: 'aplicado',
  propuesto: 'propuesto, no aplicado',
  criterio: 'criterio',
  ancladas: (n: number) => `${n} pieza(s) ancladas al surco`,
  sinSurco: 'sin surco claro:',
  noEjecutado: 'no se ejecutó',
};

const TEXTOS: Record<Idioma, typeof es> = {
  es,
  en: {
    fidelidad: 'Fidelity and provenance',
    fidelidadNota: 'Emitter declarations; they do not certify clinical fitness. Unknown means there is not enough evidence.',
    fidelidadFila: (a) => <><b>{a.id}</b> · origin {a.origen} · sources {a.fuentes} · history{' '}
      {a.historiaDeclarada ? 'declared' : 'unknown'} · recorded losses{' '}
      {a.perdidas} · repeatability {a.repetibilidad}</>,
    porPrioridad: ' · by load priority',
    declaradosFuera: (n) => <> · {n} declared external</>,
    regeneracion: 'Local regeneration · geometry and appearance',
    regeneracionNota: <>The enhanced STL <b>does not travel</b> inside: it would take 19 MB to
      duplicate a geometry this container knows how to rebuild. It is built right here from{' '}
      <code>asset.scene</code> and the color of <code>asset.apariencia</code>, without
      uploading anything anywhere.</>,
    registraciones: 'Registrations · ',
    ninguna: 'none',
    provisional: 'provisional',
    verificadaPor: (quien) => `verified by ${quien}`,
    sinVerificar: 'not verified',
    reparos: 'Issues · ',
    sinReparos: 'the container does not contradict itself in anything this viewer checks',
    fueraNoEsReparo: <>An <b>external</b> asset is not an issue: the format declares the
      original by its content address and leaves its custody to another system. That it is
      not inside is what the container states, not something it violates.</>,
    partes: (n) => `${n} parts`,
    fueraSoloHash: 'external · hash only',
    verificando: 'verifying…',
    noCuadra: 'hash does NOT match',
    guardado: 'saved ✓',
    fallo: 'failed',
    guardar: 'save',
    regenerando: 'regenerating…',
    regenerada: 'regenerated ✓',
    regenerar: 'regenerate arch with color',
    progreso: (p, i) => ({
      leyendo: 'reading the twin…',
      mezclando: `blending ${'vertices' in p ? numero(i, p.vertices) : ''} vertices…`,
      color: `blending color… ${'fraccion' in p ? Math.round(p.fraccion * 100) : ''} %`,
      escribiendo: 'writing the files…',
    })[p.fase],
    verticesTriangulos: (v, t) => `${v} vertices · ${t} triangles`,
    colorMedido: (pct, fdi, rellenados) => <>color <b>measured</b> on {pct} % of the vertices
      ·{' '}{fdi} with an FDI code ·{' '}{rellenados} gap(s) inherited from their own tooth</>,
    ply: '.ply · with color, FDI and measured',
    construyendo: 'building…',
    tresMf: '.3mf · with color, for printing',
    stl: '.stl · geometry only',
    inferencia: (n) => <>Inference · {n} segmentation(s) in{' '}
      <code>derived/</code></>,
    inferenciaNota: 'Model output: it is neither a measurement nor a diagnosis, and it can be removed from the container without breaking it.',
    noDeclarado: 'not declared',
    modelo: 'model',
    version: 'version',
    pesos: 'weights',
    regimen: 'regime',
    capa: (n) => `Layer ${n}`,
    indexa: 'indexes',
    conPieza: (n, total) => ` · ${n} of ${total} with a tooth`,
    piezas: 'teeth',
    generada: 'generated',
    frontera: 'boundary',
    fueraDelRango: (fdi) => `outside the expert range: ${fdi}`,
    todasDentro: 'all within the expert range',
    margen: 'margin',
    aplicado: 'applied',
    propuesto: 'proposed, not applied',
    criterio: 'criterion',
    ancladas: (n) => `${n} ${n === 1 ? 'tooth' : 'teeth'} anchored to the sulcus`,
    sinSurco: 'no clear sulcus:',
    noEjecutado: 'not run',
  },
};

export function PanelContenedor({ caso }: { caso: Caso }) {
  const t = TEXTOS[useIdioma()];
  const { uos, manifiesto: m, reparos, fidelidad } = caso;
  const fuera = uos.porPrioridad.filter((a) => a.external).length;
  return (
    <div className="filas">
      {fidelidad && (
        <div className="bloque">
          <h3>{t.fidelidad}</h3>
          <p className="nota">{t.fidelidadNota}</p>
          <ul>{fidelidad.map((a) => (
            <li key={a.id}>{t.fidelidadFila(a)}</li>
          ))}</ul>
        </div>
      )}
      <div className="bloque">
        <h3>
          Assets · <span className="n">{uos.porPrioridad.length}</span>{t.porPrioridad}
          {fuera > 0 && t.declaradosFuera(<span className="n">{fuera}</span>)}
        </h3>
        <div className="desliza"><div className="rejilla-assets">
          {uos.porPrioridad.map((a) => <FichaAsset key={a.id} uos={uos} asset={a} />)}
        </div></div>
      </div>
      {caso.segmentaciones.length > 0 && <Inferencia segmentaciones={caso.segmentaciones} />}
      <div className="cols cols-3">
        <div className="bloque">
          <h3>{t.regeneracion}</h3>
          <div className="desliza">
            <p className="nota">{t.regeneracionNota}</p>
            <Regeneracion uos={uos} />
          </div>
        </div>
        <div className="bloque">
          <h3>{t.registraciones}<span className="n">{m.registrations.length}</span></h3>
          <div className="desliza"><ul>
            {m.registrations.length === 0 && <li className="nota">{t.ninguna}</li>}
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
                  ? <span className="prov">{t.provisional}</span>
                  : r.verified_by
                    ? <span className="b">{t.verificadaPor(r.verified_by)}</span>
                    : <span className="sinver">{t.sinVerificar}</span>}
              </li>
            ))}
          </ul></div>
        </div>
        <div className="bloque">
          <h3>{t.reparos}<span className="n">{reparos.length}</span></h3>
          <div className="desliza">
            <ul className="reparos">
              {reparos.length === 0 && <li className="nota">{t.sinReparos}</li>}
              {/* Los reparos los escribe el visor en español: no se traducen. */}
              {reparos.map((r, i) => <li key={i} lang="es" className={r.grave ? 'grave' : ''}>{r.texto}</li>)}
            </ul>
            <p className="nota">{t.fueraNoEsReparo}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function FichaAsset({ uos, asset: a }: { uos: UosLoader; asset: Asset }) {
  const t = TEXTOS[useIdioma()];
  return (
    <div className="asset">
      <div className="id" title={a.id}><b>{a.id}</b></div>
      <div className="uri">{a.uri}</div>
      <div className="pie">
        <span className="k">{a.kind}</span>
        <span className="b">{a.frame}</span>
        <span className="b">{(a.bytes / 1e6).toFixed(1)} MB</span>
        {a.parts && <span className="b">{t.partes(a.parts.length)}</span>}
      </div>
      <div className="pie">{
        // ⚠️ Un asset EXTERNO no se puede guardar porque no está: ofrecer el botón sería
        // prometer un fichero que el contenedor no lleva. Lo que sí se puede hacer es decir
        // por su hash CUÁL es, que es exactamente lo que el `.uos` afirma de él.
        a.external
          ? <span className="l3">{t.fueraSoloHash}</span>
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
  const t = TEXTOS[useIdioma()];
  // Se guarda la clave y no el texto: si se cambia de idioma a mitad, el botón la sigue.
  // El mensaje de un error lo escribe el lector, en español, y va tal cual.
  const [estado, setEstado] = useState<
    'verificando' | 'noCuadra' | 'guardado' | 'fallo' | { error: string } | null>(null);
  const [malo, setMalo] = useState(false);
  const luego = useTemporal();

  async function guarda(): Promise<void> {
    setEstado('verificando');
    try {
      const bytes = await uos.bytes(asset);
      if (!(await uos.verifica(asset))) {
        setEstado('noCuadra');
        setMalo(true);
        return;
      }
      baja(bytes, asset.uri.split('/').pop() || asset.id, asset.media_type);
      setEstado('guardado');
    } catch (e) {
      setEstado(e instanceof Error ? { error: e.message.slice(0, 40) } : 'fallo');
      setMalo(true);
    } finally {
      luego(() => { setEstado(null); setMalo(false); }, 4000);
    }
  }

  return (
    <button className={`guardar${malo ? ' malo' : ''}`} disabled={estado !== null}
      onClick={() => void guarda()}>
      {estado === null ? t.guardar
        : typeof estado === 'string' ? t[estado] : <Diag>{estado.error}</Diag>}
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
  const idioma = useIdioma();
  const t = TEXTOS[idioma];
  const [estado, setEstado] = useState<ProgresoRegenera | null>(null);
  const [boton, setBoton] = useState<
    { texto: 'regenerando' | 'regenerada' | 'fallo'; malo: boolean } | null>(null);
  const [hecho, setHecho] = useState<Regenerado | null>(null);
  const [error, setError] = useState<string | null>(null);
  const corte = useRef<AbortController | null>(null);
  const luego = useTemporal();

  useEffect(() => () => corte.current?.abort(), []);

  async function lanza(): Promise<void> {
    corte.current?.abort();
    const c = new AbortController();
    corte.current = c;
    setBoton({ texto: 'regenerando', malo: false });
    setHecho(null);
    setError(null);
    try {
      const r = await regenera(uos, (p) => { if (!c.signal.aborted) setEstado(p); }, undefined, c.signal);
      if (c.signal.aborted) return;
      setHecho(r);
      setEstado(null);
      setBoton({ texto: 'regenerada', malo: false });
    } catch (e) {
      if (c.signal.aborted) return;
      setError(e instanceof Error ? e.message : String(e));
      setBoton({ texto: 'fallo', malo: true });
    } finally {
      if (!c.signal.aborted) luego(() => setBoton(null), 6000);
    }
  }

  return (
    <>
      <p>
        <button className={`guardar${boton?.malo ? ' malo' : ''}`} disabled={boton !== null}
          onClick={() => void lanza()}>
          {boton ? t[boton.texto] : t.regenerar}
        </button>
      </p>
      <div className="nota">
        {/* El progreso llega como dato y se dice en el idioma de la interfaz; el error lo
            escribe `Regenera` en español. */}
        {estado && t.progreso(estado, idioma)}
        {error && <p className="error" lang="es">{error}</p>}
        {hecho && <Resultado r={hecho} />}
      </div>
    </>
  );
}

function Resultado({ r }: { r: Regenerado }) {
  const idioma = useIdioma();
  const t = TEXTOS[idioma];
  const n = (v: number) => numero(idioma, v);
  const pct = ((r.medidos / r.vertices) * 100).toFixed(1);
  const [tresMf, setTresMf] = useState<
    { texto: 'construyendo' | 'fallo' | { error: string }; malo: boolean } | null>(null);
  const textoTresMf = tresMf === null ? t.tresMf
    : typeof tresMf.texto === 'string' ? t[tresMf.texto] : <Diag>{tresMf.texto.error}</Diag>;
  return (
    <>
      <p className="nota">{t.verticesTriangulos(n(r.vertices), n(r.triangulos))}</p>
      <p className="nota">{t.colorMedido(pct, n(r.conFdi), n(r.rellenados))}</p>
      <p>
        <button className="guardar" onClick={() => baja(r.ply, 'arcada-color.ply', 'application/octet-stream')}>
          {t.ply}</button>{' '}
        <button className={`guardar${tresMf?.malo ? ' malo' : ''}`} disabled={tresMf?.texto === 'construyendo'}
          onClick={() => {
            // ⚠️ El 3MF se construye AL PEDIRLO: son veinticinco megas de XML, y hacerlo
            // con el resto costaría un par de segundos de página parada a quien no lo quiere.
            setTresMf({ texto: 'construyendo', malo: false });
            // El texto de la meta va DENTRO del 3MF: es contenido del fichero, no interfaz.
            void construye3mf(
              r.posiciones, r.caras, r.rgb,
              `arcada regenerada desde un .uos por uos-viewer · ${r.vertices} vertices · ` +
                `${pct} % con color medido del paciente`,
            ).then(
              (b) => { baja(b, 'arcada-color.3mf', 'model/3mf'); setTresMf(null); },
              (e: unknown) => setTresMf({
                texto: e instanceof Error ? { error: e.message.slice(0, 30) } : 'fallo', malo: true }),
            );
          }}>
          {textoTresMf}</button>{' '}
        <button className="guardar" onClick={() => baja(r.stl, 'arcada-color.stl', 'model/stl')}>
          {t.stl}</button>{' '}
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
  const t = TEXTOS[useIdioma()];
  return (
    <div className="bloque derived">
      <h3>{t.inferencia(<span className="n">{segmentaciones.length}</span>)}</h3>
      <p className="nota">{t.inferenciaNota}</p>
      <div className="rejilla-seg">
        {segmentaciones.map((s) => <FichaSegmentacion key={s.id} s={s} />)}
      </div>
    </div>
  );
}

function FichaSegmentacion({ s }: { s: Segmentacion }) {
  const idioma = useIdioma();
  const t = TEXTOS[idioma];
  const noDeclarado = <span className="sinver">{t.noDeclarado}</span>;
  const fuera = s.frontera
    ? [...s.frontera].filter(([, f]) => !f.within_expert_range).map(([f]) => f).sort((a, b) => a - b)
    : [];
  const m = s.margen;
  const anclas = m ? [...m.teeth].filter(([, d]) => !d.declined && d.moved > 0).map(([f]) => f) : [];
  const declinadas = m ? [...m.teeth].filter(([, d]) => d.declined).map(([f]) => f).sort((a, b) => a - b) : [];
  return (
    <div className="asset seg">
      <div className="id" title={s.id}><b>{s.id}</b></div>
      <div className="uri">{s.uri}</div>
      <dl>
        <dt>{t.modelo}</dt><dd>{s.modelo ?? noDeclarado}</dd>
        <dt>{t.version}</dt><dd>{s.version ?? noDeclarado}</dd>
        <dt>{t.pesos}</dt><dd>{s.pesos
          ? <code title={s.pesos}>sha256:{s.pesos.slice(0, 12)}…</code> : noDeclarado}</dd>
        <dt>{t.regimen}</dt><dd>
          {s.capa !== null ? <span className="l3">{t.capa(s.capa)}</span> : noDeclarado}
          {s.estado && <> · {s.estado}</>}
          {s.jurisdicciones.length > 0 && <> · {s.jurisdicciones.join(', ')}</>}
        </dd>
        <dt>{t.indexa}</dt><dd>{s.fuentes.join(', ') || noDeclarado}
          {s.etiquetadas !== null && s.total !== null
            && <span className="b">{t.conPieza(numero(idioma, s.etiquetadas), numero(idioma, s.total))}</span>}</dd>
        <dt>{t.piezas}</dt><dd>{s.piezas.length ? s.piezas.join(' ') : <span className="b">{t.ninguna}</span>}</dd>
        {s.generado && <><dt>{t.generada}</dt><dd>{s.generado.slice(0, 10)}</dd></>}
        {s.frontera && <><dt>{t.frontera}</dt><dd>{fuera.length
          ? <span className="sinver">{t.fueraDelRango(fuera.join(', '))}</span>
          : t.todasDentro}</dd></>}
        <dt>{t.margen}</dt><dd>{m
          ? <>{m.applied ? t.aplicado : <span className="sinver">{t.propuesto}</span>}
              {m.criterion && <> · {t.criterio} {m.criterion}</>}
              {' · '}{t.ancladas(anclas.length)}
              {declinadas.length > 0 && <> · {t.sinSurco} {declinadas.join(', ')}</>}
              <div className="b">{m.method}{Object.entries(m.thresholds).map(([k, v]) => ` · ${k} ≥ ${v}`).join('')}</div></>
          : <span className="b">{t.noEjecutado}</span>}</dd>
      </dl>
    </div>
  );
}
