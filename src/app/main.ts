/**
 * App de demostración: arrastra un `.uos` y se abre.
 *
 * Es el mínimo que demuestra lo que este repositorio existe para demostrar — que un `.uos`
 * se puede abrir **sin saber nada de quién lo escribió**: se lee el manifiesto, se ordenan
 * los assets por prioridad, se carga la escena y se aplica una vista guardada.
 *
 * ⚠️ **La disposición es la de un software de clínica, y ese cambio no es cosmético.** Todo
 * esto vivía en una columna de 27 rem a la derecha con scroll: manifiesto, diecinueve
 * assets, registraciones, capas, vistas, inferencia, clínico y diecisiete motivos de
 * revisión, uno detrás de otro. Delante del paciente eso no se lee. Ahora el lienzo ocupa
 * la pantalla y la información se pide por **esquinas**: cuatro modales, cada uno con un
 * tema, y el que no se ha pedido no está tapando el modelo.
 */

import type { CapaClinica, Pieza } from '../uos/Clinico';
import { aCss, fichaDe, porPieza } from '../uos/Clinico';
import { esProvisional } from '../uos/Manifest';
import { BlobReader } from '../uos/Reader';
import { UosLoader } from '../uos/UosLoader';
import { Apariencia, UMBRAL_ALFA_255 } from './Apariencia';
import { Escena } from './Escena';
import { construye3mf, regenera } from './Regenera';
import { leePly } from '../uos/Ply';
import { leeGlb } from '../uos/Glb';
import { campoDesdeSplats, plyDesdeCampo } from '../uos/SplatsKhr';
import { Splats } from './Splats';

interface VistaJSON {
  id: string;
  label: string;
  visit: string;
  camera: { position: number[]; target: number[]; up: number[]; fov?: number };
}

const lienzo = document.querySelector<HTMLCanvasElement>('#lienzo')!;
const identidad = document.querySelector<HTMLDivElement>('#identidad')!;
const ficha = document.querySelector<HTMLDivElement>('#ficha')!;
const portada = document.querySelector<HTMLDivElement>('#portada')!;
const barraVistas = document.querySelector<HTMLDivElement>('#vistas-barra')!;
const cartaDental = document.querySelector<HTMLDivElement>('#odontograma')!;
const modal = document.querySelector<HTMLDivElement>('#modal')!;
const tituloModal = document.querySelector<HTMLHeadingElement>('#titulo-modal')!;
const cuerpoModal = document.querySelector<HTMLDivElement>('#cuerpo-modal')!;
const escena = new Escena(lienzo);
const splats = new Splats(escena.scene);
/**
 * El paso de GS del §11.2 con el rasterizador que el spec nombra.
 *
 * ⚠️ **Convive con `Splats`, y cada uno hace una cosa distinta.** `Apariencia` DIBUJA la
 * capa de apariencia —splats elípticos, ordenados por profundidad, que es lo que un 3DGS
 * necesita—. `Splats` sigue dibujando el campo de DENSIDAD, donde la composición es
 * aditiva y ordenar no haría nada, y además guarda la geometría de la apariencia
 * **invisible** para resolver el picking por `region_id`: el rasterizador reordena las
 * gaussianas por dentro, así que preguntarle a él por un índice no devolvería el nuestro.
 */
const apariencia = new Apariencia();

/** Lo que hace falta para contestar a un clic. Se rellena al abrir un contenedor. */
let piezas = new Map<string, Pieza>();
let segmentador = '';
let hayEtiquetas = false;
let seleccionada: number | null = null;

/**
 * El contenido de cada esquina, montado al abrir el contenedor y no al pulsar.
 *
 * Se construye una vez porque los datos ya están en memoria: reconstruirlo en cada
 * apertura haría que un modal tardara en salir sin ninguna razón. Lo que sí se aplaza es
 * **inyectarlo en el DOM**, que es lo caro cuando la lista es de diecinueve assets.
 */
interface Modal {
  readonly titulo: string;
  readonly html: string;
  /** Cuenta que se enseña en el botón de la esquina: permite decidir sin abrir. */
  readonly cuenta: string;
  /** Marca la esquina en rojo. Sólo para lo que el contenedor INCUMPLE. */
  readonly grave?: boolean;
  /** Listeners del contenido, cableados justo después de inyectarlo. */
  readonly monta?: (raiz: HTMLElement) => void;
}
let modales = new Map<string, Modal>();
let abierto: string | null = null;

/**
 * Publica el alto REAL de la carta dental para que la ficha flotante sepa dónde acaba.
 *
 * ⚠️ Sin esto la ficha se metía por debajo del odontograma y su último párrafo quedaba
 * cortado a media frase. El alto de esa barra depende del texto de la leyenda, del tamaño
 * de fuente y del ancho de la ventana —la leyenda envuelve—, así que no es un número que
 * se pueda escribir en el CSS: hay que medirlo, y volver a medirlo al redimensionar.
 */
function mideCarta(): void {
  const alto = cartaDental.hidden ? 0 : cartaDental.offsetHeight;
  document.documentElement.style.setProperty('--alto-carta', `${alto}px`);
}
addEventListener('resize', mideCarta);

function bucle(): void {
  // La escala de los splats depende del alto del lienzo y del `fov`, y los dos cambian
  // en vivo: al redimensionar y al aplicar una vista guardada.
  splats.sincroniza(lienzo.height || 1, escena.camera);
  escena.dibuja();
  requestAnimationFrame(bucle);
}
bucle();

/* --- modales --------------------------------------------------------------- */

function abreModal(id: string): void {
  const m = modales.get(id);
  if (!m) return;
  tituloModal.textContent = m.titulo;
  cuerpoModal.innerHTML = m.html;
  m.monta?.(cuerpoModal);
  modal.hidden = false;
  abierto = id;
}

function cierraModal(): void {
  modal.hidden = true;
  cuerpoModal.innerHTML = '';
  abierto = null;
}

document.querySelector<HTMLButtonElement>('#cierra-modal')!
  .addEventListener('click', cierraModal);
// El fondo cierra; el contenido no. Sin la comprobación, un clic dentro de la lista de
// assets cerraba el modal a media lectura.
modal.addEventListener('click', (e) => { if (e.target === modal) cierraModal(); });

for (const b of document.querySelectorAll<HTMLButtonElement>('.dock')) {
  b.addEventListener('click', () => {
    const id = b.dataset['modal']!;
    // Volver a pulsar la misma esquina cierra: es el gesto que se espera de una pestaña.
    if (abierto === id) cierraModal();
    else abreModal(id);
  });
}

/** Pone las cuentas en las esquinas y esconde las que este contenedor no llena. */
function ponEsquinas(): void {
  for (const b of document.querySelectorAll<HTMLButtonElement>('.dock')) {
    const m = modales.get(b.dataset['modal']!);
    b.hidden = !m;
    b.classList.toggle('aviso-grave', m?.grave === true);
    const c = b.querySelector<HTMLSpanElement>('.cuenta');
    if (c) c.textContent = m?.cuenta ?? '';
  }
}

/* --- descarga verificada --------------------------------------------------- */

/**
 * Saca un asset del contenedor al disco, VERIFICANDO su `sha256` antes.
 *
 * ⚠️ La verificación no es un adorno ni una lentitud gratuita: el §8 del spec la deja como
 * política del cliente —opcional al visualizar, **obligatoria en ingesta y export**— y
 * sacar un fichero del contenedor **es un export**. Es justo el momento en que alguien se
 * lleva el STL a una impresora 3D, así que es justo el momento en que hay que poder
 * afirmar que lo que sale es byte a byte lo que el manifiesto declara.
 *
 * Si el hash no cuadra NO se guarda. Un fichero que no es el que dice ser, entregado igual
 * con un aviso al lado, se convierte en el fichero bueno en cuanto el aviso se cierra.
 */
async function guarda(uos: UosLoader, boton: HTMLButtonElement): Promise<void> {
  const id = boton.dataset['guardar']!;
  const asset = uos.porPrioridad.find((a) => a.id === id);
  if (!asset) return;

  const antes = boton.textContent;
  boton.disabled = true;
  boton.textContent = 'verificando…';
  try {
    const bytes = await uos.bytes(asset);
    if (!(await uos.verifica(asset))) {
      boton.textContent = 'hash NO cuadra';
      boton.classList.add('malo');
      return;
    }
    const url = URL.createObjectURL(
      new Blob([bytes as BlobPart], { type: asset.media_type }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = asset.uri.split('/').pop() || asset.id;
    a.click();
    // Revocar en el mismo tick cancela la descarga en algunos navegadores.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    boton.textContent = 'guardado ✓';
  } catch (e) {
    boton.textContent = e instanceof Error ? e.message.slice(0, 40) : 'falló';
    boton.classList.add('malo');
  } finally {
    setTimeout(() => {
      boton.disabled = false;
      boton.textContent = antes;
      boton.classList.remove('malo');
    }, 4000);
  }
}

/* --- regeneración de la arcada --------------------------------------------- */

/** Ofrece un fichero al disco. Mismo gesto que `guarda`, sin hash que verificar. */
function baja(bytes: Uint8Array | string, nombre: string, tipo: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: tipo }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Regenera la arcada coloreada y la ofrece al disco.
 *
 * ⚠️ **Aquí NO se verifica ningún hash, y la diferencia importa.** `guarda` saca un asset
 * del contenedor y el §8 exige comprobar su `sha256` porque el manifiesto afirma cuál es.
 * Esto es otra cosa: un fichero NUEVO, calculado ahora, del que el contenedor no afirma
 * ningún hash — no puede, porque no lo lleva. Lo que sí viaja con él es su `.meta.json`,
 * que dice de qué dos assets salió, con sus hashes, y qué pierde cada formato.
 */
async function regeneraAqui(
  uos: UosLoader, boton: HTMLButtonElement, estado: HTMLDivElement | null,
): Promise<void> {
  boton.disabled = true;
  const antes = boton.textContent;
  try {
    const r = await regenera(uos, (t) => { if (estado) estado.textContent = t; });
    const pct = ((r.medidos / r.vertices) * 100).toFixed(1);
    if (estado) {
      estado.innerHTML =
        `<p class="nota">${r.vertices.toLocaleString()} vértices ·
          ${r.triangulos.toLocaleString()} triángulos</p>
         <p class="nota">color <b>medido</b> en el ${pct} % ·
          ${r.conFdi.toLocaleString()} con código FDI ·
          ${r.rellenados.toLocaleString()} hueco(s) heredados de su misma pieza</p>
         <p><button class="guardar" data-baja="ply">.ply · con color, FDI y medido</button>
            <button class="guardar" id="baja-3mf">.3mf · con color, para imprimir</button>
            <button class="guardar" data-baja="stl">.stl · sólo geometría</button>
            <button class="guardar" data-baja="meta">.meta.json</button></p>`;
      const mapa: Record<string, [Uint8Array | string, string, string]> = {
        ply: [r.ply, 'arcada-color.ply', 'application/octet-stream'],
        stl: [r.stl, 'arcada-color.stl', 'model/stl'],
        meta: [r.meta, 'arcada-color.meta.json', 'application/json'],
      };
      for (const b of estado.querySelectorAll<HTMLButtonElement>('button[data-baja]')) {
        b.addEventListener('click', () => {
          const q = mapa[b.dataset['baja']!];
          if (q) baja(q[0], q[1], q[2]);
        });
      }
      // ⚠️ El 3MF se construye AL PEDIRLO. Son veinticinco megas de XML: hacerlo con el
      // resto costaría un par de segundos de página parada a todo el que regenere sin
      // querer el 3MF, que es la mayoría.
      const b3mf = estado.querySelector<HTMLButtonElement>('#baja-3mf');
      b3mf?.addEventListener('click', () => {
        void (async () => {
          const antes3 = b3mf.textContent;
          b3mf.disabled = true;
          b3mf.textContent = 'construyendo…';
          try {
            baja(
              await construye3mf(
                r.posiciones, r.caras, r.rgb,
                `arcada regenerada desde un .uos por uos-viewer · ${r.vertices} vertices · ` +
                  `${pct} % con color medido del paciente`,
              ),
              'arcada-color.3mf',
              'model/3mf',
            );
            b3mf.textContent = antes3;
          } catch (e) {
            b3mf.textContent = e instanceof Error ? e.message.slice(0, 30) : 'falló';
            b3mf.classList.add('malo');
          } finally {
            b3mf.disabled = false;
          }
        })();
      });
    }
    boton.textContent = 'regenerada ✓';
  } catch (e) {
    if (estado) {
      estado.innerHTML = `<p class="error">${e instanceof Error ? e.message : String(e)}</p>`;
    }
    boton.textContent = 'falló';
    boton.classList.add('malo');
  } finally {
    setTimeout(() => {
      boton.disabled = false;
      boton.textContent = antes;
      boton.classList.remove('malo');
    }, 6000);
  }
}

/* --- ficha de la pieza ----------------------------------------------------- */

/**
 * La ficha de la pieza seleccionada, FLOTANDO sobre el lienzo.
 *
 * ⚠️ Estaba al final de la columna, detrás de diecisiete assets y diecinueve botones de
 * vista, y por eso parecía que el visor no enseñaba lo que dice el informe: se generaba
 * entera y se actualizaba a dos pantallas de scroll del clic. El dato estaba; el sitio no.
 */
function dibujaFicha(fdi: number | null): void {
  if (!hayEtiquetas) {
    ficha.innerHTML = '';
    return;
  }
  if (fdi === null) {
    ficha.innerHTML = '<p class="nota">pincha un diente para aislarlo y ver qué dice de él el informe</p>';
    return;
  }
  // ⚠️ **Una pieza sin ficha clínica tiene que decirlo igual.** Antes, pinchar un diente
  // del que el informe no habla dejaba la ficha vacía y no se distinguía de «el clic no ha
  // acertado nada» — que es justo lo que hay que poder comprobar cuando lo que se está
  // mirando es si la SEGMENTACIÓN acierta. El código FDI va siempre, venga o no con texto.
  const conFicha = piezas.has(String(fdi));
  // De dónde viene cada mitad va escrito: la geometría la segmentó un modelo (Layer 3) y
  // lo clínico lo dice un informe que firmó una persona (Layer 1). Son dos fuentes con dos
  // regímenes distintos, y presentarlas juntas sin decirlo las igualaría.
  ficha.innerHTML =
    `<button id="quita-pieza" class="cerrar" title="ver la arcada entera">✕</button>` +
    `<p class="pieza-fdi">FDI <b>${fdi}</b></p>` +
    (conFicha
      ? fichaDe(fdi, piezas.get(String(fdi)), true)
      : '<p class="nota">el informe no dice nada de esta pieza</p>') +
    `<p class="nota">segmentada por ${segmentador || '—'} · <span class="l3">Layer 3</span></p>`;
  ficha
    .querySelector<HTMLButtonElement>('#quita-pieza')
    ?.addEventListener('click', () => seleccionar(null));
}

/**
 * Falso color por capa. NO significa tejido: distingue dos capas del campo entre sí.
 */
const TONOS: Record<string, [number, number, number]> = {
  'asset.field': [0.35, 0.62, 0.95],
  'asset.composite': [0.95, 0.72, 0.35],
  'asset.gs': [0.55, 0.9, 0.65],
  'asset.apariencia': [1.0, 1.0, 1.0],
};

/**
 * Una columna del campo, tal y como la declara el sidecar.
 *
 * ⚠️ **Es la unica fuente de procedencia que queda para las etiquetas.** Antes el visor
 * leia `derived/seg_teeth` y su `MetaSegmentacion`, que traia el modelo, su version y el
 * hash de los pesos. Esa capa indexa los vertices de `scene.glb`, asi que en un contenedor
 * de solo gaussianas no viaja — y el FDI llega ahora por gaussiana, en la columna
 * `region_id` de la propia apariencia. Lo que dice de si misma esa columna (`measured`,
 * `derived_from`, `vocabulary`) es lo que el panel tiene que enseñar: sin eso, unas
 * etiquetas de inferencia se leerian como si fueran medidas.
 */
interface ColumnaGS {
  readonly name?: string;
  readonly unit?: string;
  readonly measured?: boolean;
  readonly derived_from?: string | null;
  readonly meaning?: string;
  readonly vocabulary?: string | null;
}

interface DescriptorGS {
  readonly role?: string;
  readonly measured?: boolean;
  readonly note?: string;
  readonly profile?: string;
  readonly n_primitives?: number;
  readonly columns?: readonly ColumnaGS[];
}

/**
 * Carga las capas de gaussianas que el contenedor declare.
 *
 * ⚠️ **Se elige por `media_type`, y el perfil se comprueba contra el sidecar.** Un `.ply`
 * de 3DGS de facto comparte nombres de columna con éste y no su semántica: allí `density`
 * es opacidad aprendida y las escalas van en logaritmo. Pintarlo con este shader daría una
 * imagen plausible y falsa, así que si el perfil no es el que se espera la capa se salta
 * **diciéndolo**, en vez de dibujarla como si tal cosa.
 *
 * ⚠️ **Los interruptores de capa ya no están en la interfaz, y la carga sí.** Eran una
 * vista previa cruda del campo de densidad —falso color, sprites inflados, suma sin
 * ordenar— que se comía una esquina entera para algo que no se mira en consulta. El
 * contenedor sigue trayendo esas capas y el visor sigue leyéndolas y demostrando que las
 * lee: lo que se ha quitado es el mando, no la lectura.
 */
async function ponCapas(
  uos: UosLoader,
): Promise<{ avisos: string[]; region: ColumnaGS | null }> {
  const avisos: string[] = [];
  let region: ColumnaGS | null = null;

  // ⚠️ **La apariencia se busca PRIMERO dentro del glTF, y ése es todo el cambio.** El
  // contenedor la lleva ahora como primitiva `KHR_gaussian_splatting` de `scene.glb`, que
  // es lo que el §5.1 pedía desde el principio: un visor glTF conforme la dibuja sin saber
  // nada de UOS. Este visor la lee de ahí y sólo cae al `.ply` suelto cuando el contenedor
  // no trae la extensión —los que emitimos antes de hoy—, en vez de leer siempre el `.ply`
  // y dejar la primitiva sin usar.
  let deGlb = false;
  const escena = uos.de('mesh_gs_scene').find((a) => a.media_type === 'model/gltf-binary');
  if (escena) {
    try {
      const malla = leeGlb(await uos.bytes(escena));
      if (malla.splats) {
        // ⚠️ **El descriptor cuelga ahora de `asset.scene`, y sin él las etiquetas se
        // leerían como medidas.** `KHR_gaussian_splatting` transporta gaussianas; no tiene
        // dónde decir que `region_id` es inferencia con vocabulario ISO-3950, que `f_dc`
        // es color medido corona a corona ni que `ao` es visualización. Antes ese sidecar
        // colgaba del `.ply` de apariencia; al dejar de viajar el `.ply`, el panel de
        // piezas se quedaba diciendo «procedencia no declarada» sobre unas etiquetas que
        // sí la traen.
        const d = await uos.sidecar<DescriptorGS>(escena);
        region ??= d?.columns?.find((c) => c.name === 'region_id') ?? null;
        const campo = campoDesdeSplats(malla.splats);
        await apariencia.añade('asset.apariencia', plyDesdeCampo(campo), UMBRAL_ALFA_255);
        splats.añadeApariencia(
          'asset.apariencia', 'apariencia (KHR_gaussian_splatting)', campo,
          { medida: false, nota: '', soloSeleccion: true },
        );
        deGlb = true;
      }
    } catch (e) {
      avisos.push(
        `la capa \`KHR_gaussian_splatting\` de la escena no se pudo leer, se usa el ` +
          `\`.ply\` si viaja: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  for (const a of uos.de('mesh_gs_scene')) {
    // ⚠️ **La autoridad sobre qué es cada asset es su SIDECAR, no un tipo MIME.** Aquí
    // había un filtro por `application/x-ply` que me inventé: el manifiesto declara
    // `application/octet-stream`, así que no entraba ninguna capa y el panel salía sin la
    // sección entera, sin decir por qué. Un `.ply` no tiene tipo MIME registrado y el
    // formato no lo exige; lo que sí exige es el `.gs.json` que declara el perfil.
    if (a.media_type === 'model/gltf-binary') continue;
    const d = await uos.sidecar<DescriptorGS>(a);
    if (!d?.profile) continue;
    if (d.profile !== 'ash-twin/1.0' && d.profile !== 'ash-gs-apariencia/1.0') {
      avisos.push(
        `${a.id}: perfil \`${d.profile}\`, que no es \`ash-twin/1.0\` ni ` +
          '`ash-gs-apariencia/1.0`. No se pinta: sus columnas se llaman igual y no ' +
          'significan lo mismo.',
      );
      continue;
    }
    try {
      const campo = leePly(await uos.bytes(a));
      const o = campo.comentarios['origin']?.split(/[\s,]+/).map(Number);
      const origen = o && o.length === 3 && o.every(Number.isFinite)
        ? [o[0]!, o[1]!, o[2]!] as [number, number, number]
        : undefined;
      if (d.profile === 'ash-gs-apariencia/1.0') {
        // El sidecar se lee IGUAL aunque la capa venga del glTF: es donde se declara que
        // `region_id` es inferencia y no medida, y la extensión no tiene dónde decirlo.
        region ??= d.columns?.find((c) => c.name === 'region_id') ?? null;
        if (deGlb) continue;
        // Los bytes ya salieron del contenedor: se le pasan al rasterizador tal cual, sin
        // volver a leer nada. `leePly` de arriba nos dio además las columnas, que es lo
        // que la biblioteca NO expone y necesitamos para el picking.
        await apariencia.añade(a.id, await uos.bytes(a), UMBRAL_ALFA_255);
        splats.añadeApariencia(a.id, d.role ?? a.id, campo, {
          origen,
          medida: d.measured === true,
          nota: d.note ?? '',
          // Invisible SIEMPRE: quien la dibuja es el rasterizador. Esta geometría existe
          // para dos cosas que el rasterizador no da — la caja para encuadrar y el pase
          // de selección contra `region_id`.
          soloSeleccion: true,
        });
      } else {
        splats.añade(a.id, d.role ?? a.id, campo, TONOS[a.id] ?? [0.8, 0.8, 0.8], {
          origen,
          medida: d.measured === true,
          nota: d.note ?? '',
        });
      }
    } catch (e) {
      avisos.push(`${a.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { avisos, region };
}

/** Enciende una pieza y apaga el resto, y pone su ficha arriba. `null` las devuelve todas. */
function seleccionar(fdi: number | null): void {
  // A los DOS: `splats` guarda el estado y resalta el campo de densidad si está encendido;
  // `apariencia` es quien de verdad se ve, y aísla la pieza apagando las demás escenas.
  splats.resalta(fdi);
  apariencia.resalta(fdi);
  seleccionada = fdi;
  dibujaFicha(fdi);
  // El odontograma es el mismo estado por otra vía: si está abierto, la casilla que
  // corresponde tiene que quedar encendida igual que el diente en el modelo.
  for (const d of cartaDental.querySelectorAll<HTMLButtonElement>('.diente')) {
    d.setAttribute('aria-pressed', String(Number(d.dataset['fdi']) === fdi));
  }
}

// Picking semántico (§11.3) SOBRE LAS GAUSSIANAS. El spec lo define contra los vértices de
// `scene.glb`; aquí no hay malla —el contenedor lleva sólo el campo gaussiano y el
// manifiesto— así que se resuelve con un pase de selección contra `region_id`. Va aquí y
// no dentro de `abre` para que no se acumule un listener por cada contenedor abierto.
lienzo.addEventListener('click', (ev) => {
  if (!hayEtiquetas) return;
  const r = lienzo.getBoundingClientRect();
  // A píxeles del buffer de dibujo: el lienzo tiene `pixelRatio` y el destino de 1x1 se
  // recorta sobre esa rejilla, no sobre la de CSS.
  const k = lienzo.width / Math.max(r.width, 1);
  const fdi = splats.piezaEn(
    escena.renderer, escena.camera,
    Math.round((ev.clientX - r.left) * k), Math.round((ev.clientY - r.top) * k),
    lienzo.width, lienzo.height,
  );
  seleccionar(fdi);
  if (fdi === null) {
    // Ni encía ni vacío se distinguen del «no ha acertado»: los tres significan «aquí no
    // hay pieza», y decirlo es lo que permite comprobar si la segmentación cubre lo que
    // debería. Callar sería indistinguible de que el picking esté roto.
    ficha.innerHTML = '<p class="nota">ahí no hay pieza: encía, o sin asignar</p>';
  }
});

/**
 * Las teclas del visor de referencia de la biblioteca, cableadas a mano.
 *
 * ⚠️ **La biblioteca las trae y las apaga en modo drop-in**: su manejador las guarda tras
 * `!usingExternalCamera`, y con cámara externa eso es siempre falso. Se replican aquí
 * porque las tres son de inspección, que es lo que hace falta para auditar una
 * segmentación: mirar la misma arcada de otra manera.
 */
addEventListener('keydown', (ev) => {
  if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
  const donde = ev.target as HTMLElement | null;
  if (donde && /^(INPUT|TEXTAREA|SELECT)$/.test(donde.tagName)) return;
  // Escape cierra lo que esté abierto. Es la tecla que cualquiera prueba primero.
  if (ev.code === 'Escape' && abierto) { cierraModal(); ev.preventDefault(); return; }
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
    // este contenido no aporta nada visible y cuesta 4× de relleno. El renderer va a
    // DPR nativo, y el `devicePixelRatio` de la biblioteca no se toca jamás (ver
    // `Apariencia.arranca`).
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
});

/** Un aviso efímero: sin esto, una tecla que no cambia nada visible parece rota. */
let borraAviso: ReturnType<typeof setTimeout> | undefined;
function avisa(texto: string): void {
  let caja = document.querySelector<HTMLDivElement>('#aviso');
  if (!caja) {
    caja = document.createElement('div');
    caja.id = 'aviso';
    document.body.appendChild(caja);
  }
  caja.textContent = texto;
  caja.classList.add('visible');
  clearTimeout(borraAviso);
  borraAviso = setTimeout(() => caja?.classList.remove('visible'), 1600);
}

document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  e.preventDefault();
  const f = e.dataTransfer?.files?.[0];
  if (f) void abre(f);
});
document.querySelector<HTMLInputElement>('#fichero')!.addEventListener('change', (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (f) void abre(f);
});

/* --- odontograma ----------------------------------------------------------- */

/**
 * Las dos arcadas en rejilla FDI, que es como se lee un diente en una clínica.
 *
 * ⚠️ **Sustituye a una lista de códigos separados por puntos.** Antes las piezas
 * segmentadas se enseñaban como `11 · 12 · 13 · …`, y de ahí no se saca la pregunta que
 * de verdad se hace delante del modelo: *qué falta*. En la rejilla, un hueco es un hueco
 * — se ve que no hay 18 ni 28 sin contar nada—, y cada casilla dice de un vistazo si esa
 * pieza está segmentada, si el informe habla de ella y de qué color se midió.
 */
const ARCADAS: readonly (readonly [string, readonly number[]])[] = [
  ['superior · derecha del paciente → izquierda',
   [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28]],
  ['inferior · derecha del paciente → izquierda',
   [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38]],
];

function odontograma(segmentadas: readonly number[]): string {
  const hay = new Set(segmentadas);
  return ARCADAS.map(([rotulo, fdis]) => `
    <div class="arcada">
      <div class="rotulo">${rotulo}</div>
      <div class="dientes">${fdis.map((fdi) => {
        const p = piezas.get(String(fdi));
        const esta = hay.has(fdi);
        // El tono del tercio medio, que es el que un dentista usa para comparar contra
        // una guía. Sin color medido la barra queda gris: ausencia declarada, no un tono.
        const tono = p?.color?.measured
          ? `background:${aCss(p.color.middle)}`
          : '';
        const marcas = [
          p?.findings.length ? `<span class="hall" title="${p.findings.join(', ')}">●</span>` : '',
          p && !p.findings.length ? '·' : '',
        ].join('');
        return `<button class="diente" data-fdi="${fdi}" data-hay="${esta ? 'si' : 'no'}"
          aria-pressed="false"${esta ? '' : ' disabled'}
          title="${esta ? 'aislar esta pieza' : 'la segmentación no trae esta pieza'}">
          <span class="fdi">${fdi}</span>
          <span class="tono" style="${tono}"></span>
          <span class="marcas">${marcas}</span>
        </button>`;
      }).join('')}</div>
    </div>`).join('');
}

/* --- apertura del contenedor ------------------------------------------------ */

async function abre(fichero: File): Promise<void> {
  // Estado del contenedor ANTERIOR. Sin esto, abrir un segundo `.uos` dejaba la ficha de
  // una pieza del primero arriba y el resaltado encendido sobre una malla que ya no es esa.
  piezas = new Map();
  segmentador = '';
  hayEtiquetas = false;
  seleccionada = null;
  modales = new Map();
  ponEsquinas();
  cierraModal();
  splats.limpia();
  const anterior = apariencia.grupo;
  if (anterior) escena.scene.remove(anterior);
  await apariencia.limpia();
  ficha.innerHTML = '';
  identidad.innerHTML = '';
  barraVistas.innerHTML = ''; barraVistas.hidden = true;
  cartaDental.innerHTML = ''; cartaDental.hidden = true;
  mideCarta();
  portada.hidden = false;
  portada.innerHTML = `<p>Abriendo <code>${fichero.name}</code>…</p>`;
  try {
    const uos = await UosLoader.abrir(new BlobReader(fichero));
    const m = uos.manifiesto;
    const vistas = await uos.vistas<VistaJSON>();

    // ⚠️ **Las capas GAUSSIANAS son lo único que se dibuja, y son EL MODELO.** Antes esto
    // iba detrás de una malla `scene.glb` que se cargaba primero «para enseñar algo
    // mientras»; pero el contenedor de este formato lleva sólo el campo gaussiano y el
    // manifiesto —el escaneo original viaja fuera, nombrado por su sha256— así que enseñar
    // una malla era enseñar algo que el `.uos` no lleva.
    const { avisos: avisosCapas, region } = await ponCapas(uos);
    // El grupo del rasterizador se cuelga DESPUES de cargar: se crea perezosamente y un
    // `.uos` sin apariencia no lo llega a instanciar.
    const gs = apariencia.grupo;
    if (gs && gs.parent !== escena.scene) escena.scene.add(gs);

    if (vistas[0]) {
      escena.aplicaVista(vistas[0].camera);
    } else {
      // Sin vistas guardadas, la cámara se encuadra sobre la apariencia — y si no la hay,
      // sobre la primera capa que se dibuje.
      const cual = splats.apariencia?.id ?? splats.capas[0]?.id;
      const caja = cual ? splats.caja(cual) : null;
      if (caja) escena.encuadraCaja(caja);
    }

    // La capa clínica, si el contenedor la trae. ⚠️ Se busca por NUESTRA convención
    // (`clinical/`), porque no es UOS v0.2: un `.uos` de otro emisor no la traerá y tiene
    // que abrirse igual. Por eso todo lo que sigue va tras un `if`.
    const docClinico = uos
      .de('document')
      .find((a) => a.uri.startsWith('clinical/') && a.media_type === 'application/json');
    let clinico: CapaClinica | null = null;
    // Va al estado del módulo y no a una local: el listener del clic vive fuera de `abre`
    // —uno solo, no uno por contenedor abierto— así que tiene que poder consultarlo.
    piezas = new Map<string, Pieza>();
    if (docClinico) {
      clinico = JSON.parse(new TextDecoder().decode(await uos.bytes(docClinico)));
      if (clinico) piezas = porPieza(clinico);
    }

    // `reparos` del loader es de solo lectura a proposito —es lo que el contenedor
    // incumple— asi que lo que falle AL PINTAR se acumula aparte y se muestra junto.
    const reparos = [...uos.reparos, ...avisosCapas.map((t) => ({ grave: false, texto: t }))];
    // Las piezas que se pueden seleccionar salen de lo que SE DIBUJA. Si el contenedor no
    // trae `region_id`, no hay seleccion y el panel no promete una que no existe.
    const capaFdi = splats.capas.find((c) => c.conFdi) ?? null;

    portada.hidden = true;
    identidad.innerHTML = `
      <span class="caso" title="${m.case_id}">${m.case_id}</span>
      <span class="phi phi-${m.phi_state}">${m.phi_state}</span>
      <span class="campo">uos <b>${m.uos_version}</b></span>
      <span class="campo">${m.generator['name'] ?? '—'} <b>${m.generator['version'] ?? ''}</b></span>
      <span class="campo">marco <b>${m.canonical_frame.id}</b> (${m.canonical_frame.units})</span>
      <span class="campo">visitas <b>${m.visits.map((v) => v.id).join(', ') || '—'}</b></span>`;

/* --- odontograma, PERMANENTE -------------------------------------------- */
    /*
     * ⚠️ **Era un modal y ese era el error.** El odontograma no es una consulta, es el
     * ÍNDICE del caso: se pincha un diente, se mira, se pincha el siguiente. Detrás de un
     * botón, mirar dos piezas seguidas costaba cuatro clics — abrir, pinchar, cerrar,
     * repetir. Puesto abajo y a lo ancho, cuesta uno.
     */
    const segmentadas = capaFdi?.piezas ?? [];
    // Las vistas POR PIEZA se pliegan aquí y no en la barra de arriba: la de la pieza 24
    // se busca en el 24 del odontograma, no en una lista de dieciocho botones donde
    // catorce dicen «Pieza NN». Es el mismo dato del contenedor, puesto donde se busca.
    const vistaDePieza = new Map<number, VistaJSON>();
    for (const v of vistas) {
      const n = /^view\.pieza_(\d+)$/.exec(v.id);
      if (n) vistaDePieza.set(Number(n[1]), v);
    }
    cartaDental.hidden = false;
    cartaDental.innerHTML = `<div class="fila">
      ${odontograma(segmentadas)}
      <div class="leyenda">
        <p class="nota"><b>${segmentadas.length}</b> pieza(s) segmentada(s) · la barra de
          cada casilla es el <b>tercio medio</b> del color medido.</p>
        <p class="nota">En gris: sin color declarado — ahí el campo pinta el degradado de
          respaldo, que no es color del paciente.</p>
        <p class="nota">● hallazgo en el informe</p>
      </div>
    </div>`;
    mideCarta();
    for (const b of cartaDental.querySelectorAll<HTMLButtonElement>('.diente[data-hay="si"]')) {
      b.addEventListener('click', () => {
        const fdi = Number(b.dataset['fdi']);
        // Volver a pulsar la misma casilla devuelve la arcada entera.
        const quita = seleccionada === fdi;
        seleccionar(quita ? null : fdi);
        // Y si el emisor guardó una cámara para esa pieza, se aplica: aislarla sin
        // acercarse deja el diente encendido a tres centímetros, que no es verla.
        const v = quita ? undefined : vistaDePieza.get(fdi);
        if (v) escena.aplicaVista(v.camera);
      });
    }

/* --- esquina: contenedor ------------------------------------------------ */
    const fuera = uos.porPrioridad.filter((a) => a.external).length;
    modales.set('contenedor', {
      titulo: 'Contenedor · assets, registraciones y reparos',
      cuenta: `${uos.porPrioridad.length}${fuera ? ` · ${fuera} fuera` : ''}`,
      grave: reparos.some((r) => r.grave),
      /*
       * ⚠️ **Los assets fluyen a lo ANCHO, no en una columna.** Iban en una tabla dentro de
       * un tercio del modal: diecinueve filas en un hueco donde caben ocho, así que once
       * quedaban por debajo del corte y había que desplazarse para saber qué lleva el
       * contenedor — que es exactamente la pregunta que se viene a hacer aquí. En rejilla
       * caben los diecinueve a la vez.
       */
      html: `<div class="filas">
        <div class="bloque">
          <h3>Assets · <span class="n">${uos.porPrioridad.length}</span> · por prioridad de
            carga${fuera ? ` · <span class="n">${fuera}</span> declarado(s) fuera` : ''}</h3>
          <div class="desliza"><div class="rejilla-assets">${uos.porPrioridad.map((a) => `
            <div class="asset">
              <div class="id" title="${a.id}"><b>${a.id}</b></div>
              <div class="uri">${a.uri}</div>
              <div class="pie">
                <span class="k">${a.kind}</span>
                <span class="b">${a.frame}</span>
                <span class="b">${(a.bytes / 1e6).toFixed(1)} MB</span>
                ${a.parts ? `<span class="b">${a.parts.length} partes</span>` : ''}
              </div>
              <div class="pie">${
                // ⚠️ Un asset EXTERNO no se puede guardar porque no está: ofrecer el botón
                // sería prometer un fichero que el contenedor no lleva. Lo que sí se puede
                // hacer es decir por su hash CUÁL es, que es exactamente lo que el `.uos`
                // afirma de él — y con eso quien lo tenga puede comprobar que es el mismo.
                a.external
                  ? '<span class="l3">fuera · sólo su hash</span>'
                  : a.uri.endsWith('/')
                  ? ''
                  : `<button class="guardar" data-guardar="${a.id}">guardar</button>`
              }</div>
            </div>`).join('')}</div></div>
        </div>
        <div class="cols cols-3">
          <div class="bloque">
            <h3>Reversible · <span class="n">ash_reversible/1.0</span></h3>
            <div class="desliza">
              <p class="nota">El STL mejorado <b>no viaja</b> dentro: serían 19 MB para
                duplicar una geometría que este contenedor sabe reconstruir. De
                <code>asset.scene</code> y el color de <code>asset.apariencia</code> sale
                aquí mismo, sin subir nada a ningún sitio.</p>
              <p><button class="guardar" id="regenerar">regenerar arcada con color</button></p>
              <div id="regen-estado" class="nota"></div>
            </div>
          </div>
          <div class="bloque">
            <h3>Registraciones · <span class="n">${m.registrations.length}</span></h3>
            <div class="desliza"><ul>${
              m.registrations.map((r) =>
                // ⚠️ Dos etiquetas distintas y no una. El spec (§6) llama PROVISIONAL a la
                // registración automática por aprendizaje que nadie ha mirado, y pide que
                // el visor lo indique. Una `icp_surface` sin verificar tampoco está
                // firmada, pero no es lo mismo: un ajuste geométrico converge o no, y se
                // puede leer su residuo. Meterlas en el mismo cajón perdería esa
                // diferencia.
                `<li>${r.id}<br>
                  <span class="b">${r.source_frame} → ${r.target_frame}</span>
                  <span class="k">${r.method}</span>
                  ${r.rms_error_mm != null ? `<span class="b">rms ${r.rms_error_mm.toFixed(3)} mm</span>` : ''}
                  ${
                    esProvisional(r)
                      ? '<span class="prov">provisional</span>'
                      : r.verified_by
                        ? `<span class="b">verificada por ${r.verified_by}</span>`
                        : '<span class="sinver">sin verificar</span>'
                  }</li>`).join('') || '<li class="nota">ninguna</li>'
            }</ul></div>
          </div>
          <div class="bloque">
            <h3>Reparos · <span class="n">${reparos.length}</span></h3>
            <div class="desliza"><ul class="reparos">${
              reparos.map((r) => `<li class="${r.grave ? 'grave' : ''}">${r.texto}</li>`).join('')
              || '<li class="nota">el contenedor no se contradice en nada de lo que este visor comprueba</li>'
            }</ul>
            <p class="nota">Un asset <b>fuera</b> no es un reparo: el formato declara el
              original por su dirección de contenido y deja su custodia a otro sistema. Que
              no esté dentro es lo que el contenedor afirma, no lo que incumple.</p>
            </div>
          </div>
        </div>
      </div>`,
      monta: (raiz) => {
        for (const b of raiz.querySelectorAll<HTMLButtonElement>('button[data-guardar]')) {
          b.addEventListener('click', () => void guarda(uos, b));
        }
        const boton = raiz.querySelector<HTMLButtonElement>('#regenerar');
        const estado = raiz.querySelector<HTMLDivElement>('#regen-estado');
        boton?.addEventListener('click', () => void regeneraAqui(uos, boton, estado));
      },
    });

/* --- vistas generales, PERMANENTES -------------------------------------- */
    /*
     * Sólo las que NO son de una pieza: oclusal, frontal y las dos vestibulares. Se
     * alternan constantemente mientras se mira una arcada, así que tenerlas detrás de un
     * modal obligaba a abrir y cerrar una ventana entre cada dos miradas. Las catorce de
     * pieza no están aquí — están en su diente del odontograma.
     */
    const generales = vistas.filter((v) => !vistaDePieza.has(Number(/\d+$/.exec(v.id)?.[0] ?? -1)));
    if (generales.length) {
      barraVistas.hidden = false;
      barraVistas.innerHTML = generales
        .map((v) => `<button data-v="${v.id}">${v.label}</button>`)
        .join('');
      for (const b of barraVistas.querySelectorAll<HTMLButtonElement>('button[data-v]')) {
        b.addEventListener('click', () => {
          const v = vistas.find((x) => x.id === b.dataset['v']);
          if (v) escena.aplicaVista(v.camera);
        });
      }
    }

    /* --- esquina: clínico --------------------------------------------------- */
    if (clinico) {
      const motivos = clinico.review.reasons;
      modales.set('clinico', {
        titulo: `Clínico · ${clinico.schema}`,
        cuenta: `${clinico.teeth.length} piezas${motivos.length ? ` · ${motivos.length} revisión` : ''}`,
        html: `<div class="cols cols-2">
          <div class="bloque">
            <h3>Medidas globales · <span class="n">${clinico.measurements.length}</span></h3>
            <div class="desliza">
              <ul class="medidas">${clinico.measurements.map((x) => `<li class="${
                x.out_of_range ? 'fuera' : ''
              }">${x.name}
                ${x.side ? `<span class="b">${x.side}</span>` : ''}
                <b>${x.value}${x.unit}</b>
                <span class="b">${x.normal_min ?? '—'}–${x.normal_max ?? '—'}</span>
                ${x.out_of_range ? '<span class="l3">fuera</span>' : ''}</li>`).join('')
                || '<li class="nota">el informe no trae medidas globales</li>'}</ul>
              <p class="nota">${clinico.schema} — extensión del emisor, no UOS v0.2 ·
                Layer ${clinico.regulatory.layer} · ${clinico.vocabulary}</p>
            </div>
          </div>
          <div class="bloque">
            <h3>Revisión humana · <span class="n">${motivos.length}</span> motivo(s)</h3>
            <div class="desliza">
              <ul class="gate">${
                motivos.map((r) => `<li>${r}</li>`).join('')
                || '<li class="nota">ninguno: nada de este contenedor pide revisión</li>'
              }</ul>
            </div>
          </div>
        </div>`,
      });
    }

    ponEsquinas();

    // ⚠️ **La autoridad ya no es `derived/`, es la columna.** `hayEtiquetas` decia «viaja
    // `derived/seg_teeth`», y esa capa indexa los vertices de `scene.glb`: en un contenedor
    // de solo gaussianas no viaja, asi que el clic quedaba muerto sobre un modelo que SI
    // trae el FDI, gaussiana a gaussiana. Ahora dice «hay una capa dibujada con
    // `region_id`», que es lo que de verdad decide si se puede seleccionar algo.
    segmentador = region?.derived_from ?? '';
    hayEtiquetas = splats.hayFdi;
    dibujaFicha(null);
  } catch (err) {
    // Se enseña el mensaje entero: los del loader dicen QUÉ regla del spec no se cumple,
    // que es lo único útil cuando el contenedor lo escribió otro.
    portada.hidden = false;
    portada.innerHTML = `<p class="error">${
      err instanceof Error ? err.message : String(err)
    }</p>`;
  }
}
