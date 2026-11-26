/**
 * App de demostración: arrastra un `.uos` y se abre.
 *
 * Es el mínimo que demuestra lo que este repositorio existe para demostrar — que un `.uos`
 * se puede abrir **sin saber nada de quién lo escribió**: se lee el manifiesto, se ordenan
 * los assets por prioridad, se carga la escena y se aplica una vista guardada.
 *
 * ⚠️ **React pinta la interfaz; el render es del `Visor`.** Esta componente no sabe nada de
 * three: crea el visor con `useVisor`, le pasa el fichero y le pide resaltar una pieza.
 *
 * ⚠️ **La disposición es la de un software de clínica.** El lienzo ocupa la pantalla y la
 * información se pide por esquinas: cada modal es un tema, y el que no se ha pedido no está
 * tapando el modelo. Lo que se usa continuamente —vistas generales y odontograma— está
 * puesto, no detrás de un botón.
 */

import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';

import { abreCaso, type Caso } from '../Caso';
import { VisorLiberado } from '../Visor';
import { Barra } from './Barra';
import { Ficha, type Seleccion } from './Ficha';
import { InterruptorTema } from './InterruptorTema';
import { Modal } from './Modal';
import { Odontograma } from './Odontograma';
import { PanelClinico } from './PanelClinico';
import { PanelContenedor } from './PanelContenedor';
import { Portada } from './Portada';
import { useAviso } from './useAviso';
import { useTema } from './useTema';
import { useVisor } from './useVisor';

type Estado =
  | { readonly fase: 'vacio' }
  | { readonly fase: 'abriendo'; readonly nombre: string }
  | { readonly fase: 'error'; readonly mensaje: string }
  | { readonly fase: 'abierto'; readonly caso: Caso };

type IdModal = 'contenedor' | 'clinico';

export function App() {
  const montaje = useRef<HTMLDivElement>(null);
  const visor = useVisor(montaje);
  const [estado, setEstado] = useState<Estado>({ fase: 'vacio' });
  const [seleccion, setSeleccion] = useState<Seleccion>({ tipo: 'ninguna' });
  const [abierto, setAbierto] = useState<IdModal | null>(null);
  const { aviso, avisa } = useAviso();
  const [tema, ponTema] = useTema();
  /** Cada apertura se numera: la respuesta de una apertura vieja no pisa a la nueva. */
  const aperturas = useRef(0);

  const caso = estado.fase === 'abierto' ? estado.caso : null;

  const abre = useCallback(async (fichero: File) => {
    if (!visor) return;
    const n = ++aperturas.current;
    // Estado del contenedor ANTERIOR fuera. Sin esto, abrir un segundo `.uos` dejaba la
    // ficha de una pieza del primero y el resaltado encendido sobre otra arcada.
    setSeleccion({ tipo: 'ninguna' });
    setAbierto(null);
    setEstado({ fase: 'abriendo', nombre: fichero.name });
    try {
      const c = await abreCaso(fichero, visor);
      if (n === aperturas.current) setEstado({ fase: 'abierto', caso: c });
    } catch (err) {
      if (err instanceof VisorLiberado || n !== aperturas.current) return;
      // Se enseña el mensaje entero: los del loader dicen QUÉ regla del spec no se cumple,
      // que es lo único útil cuando el contenedor lo escribió otro.
      setEstado({ fase: 'error', mensaje: err instanceof Error ? err.message : String(err) });
    }
  }, [visor]);

  /** Enciende una pieza y apaga el resto. `null` las devuelve todas. */
  const selecciona = useCallback((fdi: number | null) => {
    visor?.resalta(fdi);
    setSeleccion(fdi === null ? { tipo: 'ninguna' } : { tipo: 'pieza', fdi });
  }, [visor]);

  // El fondo 3D sigue al tema. También al montar: un visor nuevo arranca con el de ahora.
  useEffect(() => { visor?.ponTema(tema); }, [visor, tema]);

  // Arrastrar un `.uos` a cualquier parte de la ventana.
  useEffect(() => {
    const encima = (e: DragEvent): void => e.preventDefault();
    const suelta = (e: DragEvent): void => {
      e.preventDefault();
      const f = e.dataTransfer?.files?.[0];
      if (f) void abre(f);
    };
    document.addEventListener('dragover', encima);
    document.addEventListener('drop', suelta);
    return () => {
      document.removeEventListener('dragover', encima);
      document.removeEventListener('drop', suelta);
    };
  }, [abre]);

  /*
   * Las teclas del visor de referencia de la biblioteca, cableadas a mano.
   *
   * ⚠️ **La biblioteca las trae y las apaga en modo drop-in**: su manejador las guarda tras
   * `!usingExternalCamera`, y con cámara externa eso es siempre falso. Se replican aquí
   * porque las tres son de inspección, que es lo que hace falta para auditar una
   * segmentación: mirar la misma arcada de otra manera.
   */
  useEffect(() => {
    const tecla = (ev: KeyboardEvent): void => {
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      const donde = ev.target as HTMLElement | null;
      if (donde && /^(INPUT|TEXTAREA|SELECT)$/.test(donde.tagName)) return;
      // Escape cierra lo que esté abierto. Es la tecla que cualquiera prueba primero.
      if (ev.code === 'Escape' && abierto) { setAbierto(null); ev.preventDefault(); return; }
      if (!visor) return;
      const { escena, apariencia } = visor;
      switch (ev.code) {
        case 'KeyO':
          escena.ponOrtografica(!escena.esOrtografica);
          avisa(`proyección ${escena.esOrtografica ? 'ortográfica' : 'en perspectiva'}`);
          break;
        case 'KeyP':
          apariencia.nube(!apariencia.esNube);
          avisa(apariencia.esNube ? 'gaussianas como puntos' : 'gaussianas como splats');
          break;
        // `n` NO existe: el supersampling de display se quitó después de medir que para
        // este contenido no aporta nada visible y cuesta 4× de relleno.
        case 'Equal':
        case 'NumpadAdd':
          avisa(`tamaño de splat ×${apariencia.escala(0.05).toFixed(2)}`);
          break;
        case 'Minus':
        case 'NumpadSubtract':
          avisa(`tamaño de splat ×${apariencia.escala(-0.05).toFixed(2)}`);
          break;
        default:
          return;
      }
      ev.preventDefault();
    };
    addEventListener('keydown', tecla);
    return () => removeEventListener('keydown', tecla);
  }, [visor, abierto, avisa]);

  /**
   * Picking semántico (§11.3) sobre las gaussianas, contra `region_id`. Va en el envoltorio
   * del lienzo y no en el lienzo: el lienzo lo crea el `Visor` y cambia con cada montaje.
   */
  function alClicar(ev: MouseEvent): void {
    if (!visor || !caso?.hayEtiquetas) return;
    const fdi = visor.piezaEn(ev.clientX, ev.clientY);
    selecciona(fdi);
    if (fdi === null) setSeleccion({ tipo: 'fallo' });
  }

  const modales = caso ? {
    contenedor: {
      titulo: 'Contenedor · assets, registraciones y reparos',
      cuenta: (() => {
        const fuera = caso.uos.porPrioridad.filter((a) => a.external).length;
        return `${caso.uos.porPrioridad.length}${fuera ? ` · ${fuera} fuera` : ''}`;
      })(),
      grave: caso.reparos.some((r) => r.grave),
    },
    clinico: caso.clinico ? {
      titulo: `Clínico · ${caso.clinico.schema}`,
      cuenta: `${caso.clinico.teeth.length} piezas${caso.clinico.review.reasons.length
        ? ` · ${caso.clinico.review.reasons.length} revisión` : ''}`,
      grave: false,
    } : null,
  } : null;

  function alternaModal(id: IdModal): void {
    // Volver a pulsar la misma esquina cierra: es el gesto que se espera de una pestaña.
    setAbierto((a) => (a === id ? null : id));
  }

  return (
    <>
      <div id="montaje" ref={montaje} onClick={alClicar} />

      <Barra manifiesto={caso?.manifiesto ?? null} alAbrir={(f) => void abre(f)}
        extremo={<InterruptorTema tema={tema} alCambiar={ponTema} />} />

      <nav id="esquinas">
        {modales && (
          <button className={`dock ar${modales.contenedor.grave ? ' aviso-grave' : ''}`}
            onClick={() => alternaModal('contenedor')}>
            Contenedor <span className="cuenta">{modales.contenedor.cuenta}</span>
          </button>
        )}
        {modales?.clinico && (
          <button className="dock ar2" onClick={() => alternaModal('clinico')}>
            Clínico <span className="cuenta">{modales.clinico.cuenta}</span>
          </button>
        )}
      </nav>

      {caso && caso.generales.length > 0 && (
        <div id="vistas-barra">
          {caso.generales.map((v) => (
            <button key={v.id} onClick={() => visor?.escena.aplicaVista(v.camera)}>{v.label}</button>
          ))}
        </div>
      )}

      {caso && (
        <Ficha hayEtiquetas={caso.hayEtiquetas} seleccion={seleccion} piezas={caso.piezas}
          segmentador={caso.segmentador} alCerrar={() => selecciona(null)} />
      )}

      {caso && (
        <Odontograma segmentadas={caso.segmentadas} piezas={caso.piezas}
          seleccionada={seleccion.tipo === 'pieza' ? seleccion.fdi : null}
          alPulsar={(fdi) => {
            // Volver a pulsar la misma casilla devuelve la arcada entera.
            const quita = seleccion.tipo === 'pieza' && seleccion.fdi === fdi;
            selecciona(quita ? null : fdi);
            // Y si el emisor guardó una cámara para esa pieza, se aplica: aislarla sin
            // acercarse deja el diente encendido a tres centímetros, que no es verla.
            const v = quita ? undefined : caso.vistaDePieza.get(fdi);
            if (v) visor?.escena.aplicaVista(v.camera);
          }} />
      )}

      {estado.fase !== 'abierto' && (
        <Portada estado={estado.fase === 'abriendo' ? { abriendo: estado.nombre }
          : estado.fase === 'error' ? { error: estado.mensaje } : null} />
      )}

      {caso && abierto === 'contenedor' && modales && (
        <Modal titulo={modales.contenedor.titulo} alCerrar={() => setAbierto(null)}>
          <PanelContenedor caso={caso} />
        </Modal>
      )}
      {caso?.clinico && abierto === 'clinico' && modales?.clinico && (
        <Modal titulo={modales.clinico.titulo} alCerrar={() => setAbierto(null)}>
          <PanelClinico clinico={caso.clinico} />
        </Modal>
      )}

      <div id="aviso" className={aviso.visible ? 'visible' : ''}>{aviso.texto}</div>
    </>
  );
}
