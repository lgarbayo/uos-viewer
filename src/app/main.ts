/**
 * App de demostración: arrastra un `.uos` y se abre.
 *
 * Es el mínimo que demuestra lo que este repositorio existe para demostrar — que un `.uos`
 * se puede abrir **sin saber nada de quién lo escribió**: se lee el manifiesto, se ordenan
 * los assets por prioridad, se carga la escena y se aplica una vista guardada. Todo lo
 * demás que pide el §11 está por hacer, y el `README` dice cuál es cuál.
 */

import { BufferAttribute, BufferGeometry, Float32BufferAttribute } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Mesh } from 'three';

import type { CapaClinica, Pieza } from '../uos/Clinico';
import { fichaDe, porPieza } from '../uos/Clinico';
import type { MetaSegmentacion } from '../uos/Derivados';
import { decodificaEtiquetas } from '../uos/Derivados';
import type { Asset } from '../uos/Manifest';
import { esProvisional } from '../uos/Manifest';
import { BlobReader } from '../uos/Reader';
import { UosLoader } from '../uos/UosLoader';
import { Escena } from './Escena';
import { leePly } from '../uos/Ply';
import { Splats } from './Splats';

interface VistaJSON {
  id: string;
  label: string;
  visit: string;
  camera: { position: number[]; target: number[]; up: number[]; fov?: number };
}

const lienzo = document.querySelector<HTMLCanvasElement>('#lienzo')!;
const panel = document.querySelector<HTMLDivElement>('#contenido')!;
const ficha = document.querySelector<HTMLDivElement>('#ficha')!;
const escena = new Escena(lienzo);
const splats = new Splats(escena.scene);

/** Lo que hace falta para contestar a un clic. Se rellena al abrir un contenedor. */
let piezas = new Map<string, Pieza>();
let segmentador = '';
let hayEtiquetas = false;

function bucle(): void {
  // La escala de los splats depende del alto del lienzo y del `fov`, y los dos cambian
  // en vivo: al redimensionar y al aplicar una vista guardada.
  splats.sincroniza(lienzo.clientHeight || 1, escena.camera.fov);
  escena.dibuja();
  requestAnimationFrame(bucle);
}
bucle();

/**
 * La ficha de la pieza seleccionada, ARRIBA del panel.
 *
 * ⚠️ Estaba al final, detrás de diecisiete assets y diecinueve botones de vista, y por eso
 * parecía que el visor no enseñaba lo que dice el informe: se generaba entera y se
 * actualizaba a dos pantallas de scroll del clic. El dato estaba; el sitio no.
 */

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

function dibujaFicha(fdi: number | null): void {
  if (!hayEtiquetas) {
    ficha.innerHTML = '';
    return;
  }
  if (fdi === null) {
    ficha.innerHTML = '<p class="nota">pincha un diente para ver qué dice de él el informe</p>';
    return;
  }
  // De dónde viene cada mitad va escrito: la geometría la segmentó un modelo (Layer 3) y
  // lo clínico lo dice un informe que firmó una persona (Layer 1). Son dos fuentes con dos
  // regímenes distintos, y presentarlas juntas sin decirlo las igualaría.
  ficha.innerHTML =
    `<button id="quita-pieza" class="cerrar" title="ver la arcada entera">✕</button>` +
    fichaDe(fdi, piezas.get(String(fdi)), true) +
    `<p class="nota">segmentada por ${segmentador || '—'} · <span class="l3">Layer 3</span></p>`;
  ficha
    .querySelector<HTMLButtonElement>('#quita-pieza')
    ?.addEventListener('click', () => seleccionar(null));
}

/**
 * Falso color por capa. NO significa tejido: sirve para distinguir dos capas encendidas
 * a la vez, y el panel lo dice al lado de cada interruptor.
 */
const TONOS: Record<string, [number, number, number]> = {
  'asset.field': [0.35, 0.62, 0.95],
  'asset.composite': [0.95, 0.72, 0.35],
  'asset.gs': [0.55, 0.9, 0.65],
};

interface DescriptorGS {
  readonly role?: string;
  readonly measured?: boolean;
  readonly note?: string;
  readonly profile?: string;
  readonly n_primitives?: number;
}

/**
 * Carga las capas de gaussianas que el contenedor declare.
 *
 * ⚠️ **Se elige por `media_type`, y el perfil se comprueba contra el sidecar.** Un `.ply`
 * de 3DGS de facto comparte nombres de columna con éste y no su semántica: allí `density`
 * es opacidad aprendida y las escalas van en logaritmo. Pintarlo con este shader daría una
 * imagen plausible y falsa, así que si el perfil no es el que se espera la capa se salta
 * **diciéndolo**, en vez de dibujarla como si tal cosa.
 */
async function ponCapas(uos: UosLoader): Promise<string[]> {
  const avisos: string[] = [];
  for (const a of uos.de('mesh_gs_scene')) {
    // ⚠️ **La autoridad sobre qué es cada asset es su SIDECAR, no un tipo MIME.** Aquí
    // había un filtro por `application/x-ply` que me inventé: el manifiesto declara
    // `application/octet-stream`, así que no entraba ninguna capa y el panel salía sin la
    // sección entera, sin decir por qué. Un `.ply` no tiene tipo MIME registrado y el
    // formato no lo exige; lo que sí exige es el `.gs.json` que declara el perfil.
    if (a.media_type === 'model/gltf-binary') continue;
    const d = await uos.sidecar<DescriptorGS>(a);
    if (!d?.profile) continue;
    if (d.profile !== 'ash-twin/1.0') {
      avisos.push(
        `${a.id}: perfil \`${d.profile}\`, que no es \`ash-twin/1.0\`. No se pinta: sus ` +
          'columnas se llaman igual y no significan lo mismo.',
      );
      continue;
    }
    try {
      const campo = leePly(await uos.bytes(a));
      // El campo sale centrado en su propio centroide y la malla está en el marco del
      // twin: sin `origin` la nube aparece a ocho centímetros de la arcada.
      const o = campo.comentarios['origin']?.split(/[\s,]+/).map(Number);
      splats.añade(
        a.id,
        d.role ?? a.id,
        campo,
        TONOS[a.id] ?? [0.8, 0.8, 0.8],
        {
          origen: o && o.length === 3 && o.every(Number.isFinite)
            ? [o[0]!, o[1]!, o[2]!]
            : undefined,
          medida: d.measured === true,
          nota: d.note ?? '',
        },
      );
    } catch (e) {
      avisos.push(`${a.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return avisos;
}

/** Enciende una pieza y apaga el resto, y pone su ficha arriba. `null` las devuelve todas. */
function seleccionar(fdi: number | null): void {
  escena.resalta(fdi);
  dibujaFicha(fdi);
}

// Picking semántico (§11.3): raycast a la malla → código FDI por vértice. Va aquí y no
// dentro de `abre` para que no se acumule un listener por cada contenedor abierto.
lienzo.addEventListener('click', (ev) => {
  if (!hayEtiquetas) return;
  seleccionar(escena.pieza(ev.clientX, ev.clientY));
});

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

async function abre(fichero: File): Promise<void> {
  // Estado del contenedor ANTERIOR. Sin esto, abrir un segundo `.uos` dejaba la ficha de
  // una pieza del primero arriba y el resaltado encendido sobre una malla que ya no es esa.
  piezas = new Map();
  segmentador = '';
  hayEtiquetas = false;
  escena.resalta(null);
  splats.limpia();
  ficha.innerHTML = '';
  panel.innerHTML = `<p>Abriendo <code>${fichero.name}</code>…</p>`;
  try {
    const uos = await UosLoader.abrir(new BlobReader(fichero));
    const m = uos.manifiesto;
    const vistas = await uos.vistas<VistaJSON>();

    // La escena primero: es lo que permite enseñar algo habiendo leído sólo el manifiesto
    // y el asset más ligero. El volumen ni se toca (§11.1, carga perezosa).
    // ⚠️ Se elige por `media_type`, no por el orden ni por la extensión de la uri. El
    // contenedor puede traer la escena convertida (glTF) Y el fichero original del escáner
    // (STL) como assets distintos; el primero es para mirar y el segundo es el reversible.
    const porTipo = (t: string): Asset | undefined =>
      uos.de('mesh_gs_scene').find((a) => a.media_type === t);
    const glb = porTipo('model/gltf-binary');
    const stl = porTipo('model/stl');
    if (glb) {
      escena.ponMalla(await leeGLB(await uos.bytes(glb)));
    } else if (stl) {
      escena.ponMalla(leeSTL(await uos.bytes(stl)));
    }
    if (glb ?? stl) {
      if (vistas[0]) escena.aplicaVista(vistas[0].camera);
      else escena.encuadraTodo();
    }

    // Las capas GAUSSIANAS. Van después de la malla porque son lo pesado y lo opcional:
    // si un contenedor no las trae —o si son de otro perfil— el visor ya ha enseñado algo.
    const avisosCapas = await ponCapas(uos);

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

    // `derived/` — Layer 3, cargado pero APAGADO (§5.5).
    // `reparos` del loader es de solo lectura a proposito —es lo que el contenedor
    // incumple— asi que lo que falle AL PINTAR se acumula aparte y se muestra junto.
    const reparos = [...uos.reparos, ...avisosCapas.map((t) => ({ grave: false, texto: t }))];
    let meta: MetaSegmentacion | null = null;
    const seg = uos.de('derived_seg')[0];
    if (seg) {
      meta = await uos.sidecar<MetaSegmentacion>(seg);
      if (meta) {
        try {
          escena.ponEtiquetas(decodificaEtiquetas(await uos.bytes(seg), meta));
        } catch (e) {
          reparos.push({ grave: true, texto: String(e) });
          meta = null;
        }
      }
    }

    panel.innerHTML = `
      <h2>${m.case_id}</h2>
      <p class="phi phi-${m.phi_state}">${m.phi_state}</p>
      <dl>
        <dt>uos_version</dt><dd>${m.uos_version}</dd>
        <dt>generador</dt><dd>${m.generator['name'] ?? '—'} ${m.generator['version'] ?? ''}</dd>
        <dt>marco canónico</dt><dd>${m.canonical_frame.id} (${m.canonical_frame.units})</dd>
        <dt>visitas</dt><dd>${m.visits.map((v) => v.id).join(', ') || '—'}</dd>
      </dl>
      <h3>Assets · por prioridad de carga</h3>
      <ul class="assets">${uos.porPrioridad
        .map(
          (a) => `<li><b>${a.id}</b> <span class="k">${a.kind}</span>
            <code>${a.uri}</code>
            <span class="b">${(a.bytes / 1e6).toFixed(1)} MB</span>
            ${a.parts ? `<span class="b">${a.parts.length} partes</span>` : ''}
            <span class="f">${a.frame}</span>
            ${
              a.uri.endsWith('/')
                ? ''
                : `<button class="guardar" data-guardar="${a.id}">guardar</button>`
            }</li>`,
        )
        .join('')}</ul>
      <h3>Registraciones</h3>
      <ul>${
        m.registrations
          .map(
            (r) =>
              // ⚠️ Dos etiquetas distintas y no una. El spec (§6) llama PROVISIONAL a la
              // registración automática por aprendizaje que nadie ha mirado, y pide que el
              // visor lo indique. Una `icp_surface` sin verificar tampoco está firmada,
              // pero no es lo mismo: un ajuste geométrico converge o no, y se puede leer
              // su residuo. Meterlas en el mismo cajón perdería esa diferencia.
              `<li>${r.id}: ${r.source_frame} → ${r.target_frame}
               <span class="k">${r.method}</span>
               ${r.rms_error_mm != null ? `<span class="b">rms ${r.rms_error_mm.toFixed(3)} mm</span>` : ''}
               ${
                 esProvisional(r)
                   ? '<span class="prov">provisional</span>'
                   : r.verified_by
                     ? `<span class="b">verificada por ${r.verified_by}</span>`
                     : '<span class="sinver">sin verificar</span>'
               }</li>`,
          )
          .join('') || '<li>ninguna</li>'
      }</ul>
      ${
        splats.capas.length
          ? `<details class="capas-caja">
             <summary>Capas del campo · ${splats.capas.length}</summary>
             <div class="capas">
               <p class="nota">⚠️ Vista previa cruda: falso color, suma sin ordenar y
                 sprites inflados en vez de integración a lo largo del rayo. Sirve para
                 comprobar que el campo se lee, <b>no</b> para mirarlo. El porqué, medido,
                 en el README.</p>
               ${splats.capas
                 .map(
                   (c) => `<label><input type="checkbox" data-capa="${c.id}"> ${c.nombre}
                     <span class="b">${c.n.toLocaleString()}</span>
                     ${c.medida ? '<span class="med">medida</span>' : '<span class="l3">no medida</span>'}
                     ${c.dibujadas < c.n ? `<span class="b">muestreada a ${c.dibujadas.toLocaleString()}</span>` : ''}
                     ${c.nota ? `<small>${c.nota}</small>` : ''}</label>`,
                 )
                 .join('')}
               <label for="ganancia">ganancia de visualización</label>
               <input type="range" id="ganancia" min="0.02" max="1.5" step="0.02" value="0.15">
             </div>
             </details>`
          : ''
      }
      <h3>Vistas</h3>
      <ul class="vistas">${
        vistas
          .map((v) => `<li><button data-v="${v.id}">${v.label}</button></li>`)
          .join('') || '<li>ninguna</li>'
      }</ul>
      ${
        meta
          ? `<h3>Derivados · inferencia</h3>
             <div class="derived">
               <p class="nota">⚠️ La malla se pinta de <b>un solo marfil</b>, encía
                 incluida. Pintar dos colores afirmaría saber dónde acaba uno y empieza el
                 otro, y estas etiquetas son inferencia: 11 de 14 piezas se pasan de su
                 caja anatómica. Un STL no lleva color; medir esa frontera exige las fotos
                 intraorales, que el contenedor ya trae. Las etiquetas se usan sólo para
                 encender la pieza seleccionada, que es lo que sí sostienen.</p>
               <p class="l3">Layer ${meta.regulatory.layer} · ${meta.regulatory.status}</p>
               <p class="nota">${meta.model.name} ${meta.model.version} ·
                 ${meta.labels.present.length} piezas ·
                 ${meta.labels.n_labelled.toLocaleString()} de
                 ${meta.labels.n_total.toLocaleString()} vértices</p>
               <p class="nota">${meta.encoding.vocabulary} · pesos
                 ${meta.model.weights_sha256 ? meta.model.weights_sha256.slice(0, 12) + '…' : 'no declarados'}</p>
             </div>`
          : ''
      }
      ${
        clinico
          ? `<h3>Clínico · ${clinico.teeth.length} piezas</h3>
             <p class="nota">${clinico.schema} — extensión del emisor, no UOS v0.2 ·
               Layer ${clinico.regulatory.layer} · ${clinico.vocabulary}</p>
             ${
               clinico.measurements.length
                 ? `<ul class="medidas">${clinico.measurements
                     .map(
                       (m) =>
                         `<li class="${m.out_of_range ? 'fuera' : ''}">${m.name}
                          ${m.side ? `<span class="b">${m.side}</span>` : ''}
                          <b>${m.value}${m.unit}</b>
                          <span class="b">${m.normal_min ?? '—'}–${m.normal_max ?? '—'}</span>
                          ${m.out_of_range ? '<span class="l3">fuera</span>' : ''}</li>`,
                     )
                     .join('')}</ul>`
                 : ''
             }
             ${
               clinico.review.reasons.length
                 ? `<h3>Revisión humana · ${clinico.review.reasons.length}</h3>
                    <ul class="gate">${clinico.review.reasons
                      .map((r) => `<li>${r}</li>`)
                      .join('')}</ul>`
                 : ''
             }`
          : ''
      }
      <p class="nota">arrastrar: rotar · rueda: zoom · clic derecho: desplazar</p>
      ${
        reparos.length
          ? `<h3>Reparos</h3><ul class="reparos">${reparos
              .map((r) => `<li class="${r.grave ? 'grave' : ''}">${r.texto}</li>`)
              .join('')}</ul>`
          : ''
      }`;

    for (const cb of panel.querySelectorAll<HTMLInputElement>('input[data-capa]')) {
      cb.addEventListener('change', () => splats.enciende(cb.dataset['capa']!, cb.checked));
    }
    for (const b of panel.querySelectorAll<HTMLButtonElement>('button[data-guardar]')) {
      b.addEventListener('click', () => void guarda(uos, b));
    }

    const ganancia = panel.querySelector<HTMLInputElement>('#ganancia');
    ganancia?.addEventListener('input', () => splats.ponGanancia(Number(ganancia.value)));

    segmentador = meta?.model.name ?? '';
    hayEtiquetas = meta !== null;
    dibujaFicha(null);

    for (const b of panel.querySelectorAll<HTMLButtonElement>('button[data-v]')) {
      b.addEventListener('click', () => {
        const v = vistas.find((x) => x.id === b.dataset['v']);
        if (v) escena.aplicaVista(v.camera);
      });
    }
  } catch (err) {
    // Se enseña el mensaje entero: los del loader dicen QUÉ regla del spec no se cumple,
    // que es lo único útil cuando el contenedor lo escribió otro.
    panel.innerHTML = `<p class="error">${
      err instanceof Error ? err.message : String(err)
    }</p>`;
  }
}

/**
 * STL binario → geometría. Cara a cara, sin deduplicar vértices.
 *
 * ⚠️ El spec (§5.1) quiere `scene.glb` con la extensión de gaussianas; nuestro emisor
 * todavía escribe STL, así que se lee STL. Cuando el glTF llegue, esto es un `switch` por
 * `media_type` y no un cambio de arquitectura — por eso el loader devuelve bytes y no
 * geometría: **qué** es un asset lo dice el manifiesto, no el que lo abre.
 */
function leeSTL(bytes: Uint8Array): BufferGeometry {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const caras = dv.getUint32(80, true);
  if (84 + caras * 50 !== bytes.length) {
    throw new Error(
      `El STL declara ${caras} caras, que son ${84 + caras * 50} bytes, y trae ` +
        `${bytes.length}. O está truncado o es un STL de texto, que este lector no abre.`,
    );
  }
  const pos = new Float32Array(caras * 9);
  for (let i = 0, o = 84; i < caras; i++, o += 50) {
    for (let v = 0; v < 3; v++) {
      const b = o + 12 + v * 12;
      pos[i * 9 + v * 3] = dv.getFloat32(b, true);
      pos[i * 9 + v * 3 + 1] = dv.getFloat32(b + 4, true);
      pos[i * 9 + v * 3 + 2] = dv.getFloat32(b + 8, true);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  return g;
}


/**
 * glTF binario → una geometría con TODOS los primitives.
 *
 * ⚠️ **Un `scene.glb` de este formato viene partido en un primitive por diente**, con su
 * `extras.uos_fdi`, que es como el §5.1 define el picking semántico. Este lector se
 * quedaba con **la primera malla que encontraba** y tiraba las demás: sobre un contenedor
 * con quince piezas eso dejaba en pantalla el 32% de la superficie, desgarrada. Funcionó
 * mientras los contenedores traían un primitive único y dejó de funcionar en cuanto la
 * segmentación empezó a viajar dentro de la escena.
 *
 * Se concatenan los ÍNDICES y se conserva el buffer de posiciones tal cual, porque los
 * primitives del glTF **comparten el mismo accesor de POSITION**. Fusionar duplicando
 * vértices también «se vería bien» y rompería lo que no se ve: `derived/seg_teeth.bin`
 * trae una etiqueta por vértice de la malla original, y con el recuento cambiado deja de
 * poder cruzarse por índice — que es justo lo que `ponEtiquetas` comprueba y por lo que
 * fallaría en voz alta en vez de pintar la segmentación corrida.
 *
 * `GLTFLoader.parse` no toca la red: recibe el buffer.
 */
async function leeGLB(bytes: Uint8Array): Promise<BufferGeometry> {
  const copia = bytes.slice().buffer;
  const gltf = await new GLTFLoader().parseAsync(copia, '');
  const trozos: BufferGeometry[] = [];
  gltf.scene.traverse((o) => {
    const m = o as Mesh;
    if (m.isMesh && m.geometry) trozos.push(m.geometry as BufferGeometry);
  });
  if (trozos.length === 0) {
    throw new Error('El glTF no trae ninguna malla: no hay escena que enseñar.');
  }
  if (trozos.length === 1) return trozos[0]!;

  const base = trozos[0]!;
  const vertices = base.getAttribute('position').count;
  for (const g of trozos) {
    if (g.getAttribute('position').count !== vertices) {
      throw new Error(
        `El glTF trae primitives con ${vertices} y ${g.getAttribute('position').count} ` +
          'vértices: no comparten el buffer de posiciones y unirlos exigiría duplicarlos, ' +
          'lo que rompería el cruce por índice con `derived/`.',
      );
    }
  }

  const total = trozos.reduce((s, g) => s + (g.getIndex()?.count ?? 0), 0);
  const indices = vertices > 65535 ? new Uint32Array(total) : new Uint16Array(total);
  let o = 0;
  for (const g of trozos) {
    const i = g.getIndex();
    if (!i) continue;
    indices.set(i.array as ArrayLike<number>, o);
    o += i.count;
  }
  const unida = base.clone();
  unida.setIndex(new BufferAttribute(indices, 1));
  return unida;
}
