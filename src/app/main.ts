/**
 * App de demostración: arrastra un `.uos` y se abre.
 *
 * Es el mínimo que demuestra lo que este repositorio existe para demostrar — que un `.uos`
 * se puede abrir **sin saber nada de quién lo escribió**: se lee el manifiesto, se ordenan
 * los assets por prioridad, se carga la escena y se aplica una vista guardada. Todo lo
 * demás que pide el §11 está por hacer, y el `README` dice cuál es cuál.
 */

import { BufferGeometry, Float32BufferAttribute } from 'three';
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

interface VistaJSON {
  id: string;
  label: string;
  visit: string;
  camera: { position: number[]; target: number[]; up: number[]; fov?: number };
}

const lienzo = document.querySelector<HTMLCanvasElement>('#lienzo')!;
const panel = document.querySelector<HTMLDivElement>('#panel')!;
const escena = new Escena(lienzo);

function bucle(): void {
  escena.dibuja();
  requestAnimationFrame(bucle);
}
bucle();

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

    // La capa clínica, si el contenedor la trae. ⚠️ Se busca por NUESTRA convención
    // (`clinical/`), porque no es UOS v0.2: un `.uos` de otro emisor no la traerá y tiene
    // que abrirse igual. Por eso todo lo que sigue va tras un `if`.
    const docClinico = uos
      .de('document')
      .find((a) => a.uri.startsWith('clinical/') && a.media_type === 'application/json');
    let clinico: CapaClinica | null = null;
    let piezas = new Map<string, Pieza>();
    if (docClinico) {
      clinico = JSON.parse(new TextDecoder().decode(await uos.bytes(docClinico)));
      if (clinico) piezas = porPieza(clinico);
    }

    // `derived/` — Layer 3, cargado pero APAGADO (§5.5).
    // `reparos` del loader es de solo lectura a proposito —es lo que el contenedor
    // incumple— asi que lo que falle AL PINTAR se acumula aparte y se muestra junto.
    const reparos = [...uos.reparos];
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
            <span class="f">${a.frame}</span></li>`,
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
               <label><input type="checkbox" id="ver-seg"> pintar la segmentación</label>
               <p class="l3">Layer ${meta.regulatory.layer} · ${meta.regulatory.status}</p>
               <p class="nota">${meta.model.name} ${meta.model.version} ·
                 ${meta.labels.present.length} piezas ·
                 ${meta.labels.n_labelled.toLocaleString()} de
                 ${meta.labels.n_total.toLocaleString()} vértices</p>
               <p class="nota">${meta.encoding.vocabulary} · pesos
                 ${meta.model.weights_sha256 ? meta.model.weights_sha256.slice(0, 12) + '…' : 'no declarados'}</p>
             </div>
             <div id="pieza" class="pieza"><p class="nota">pincha un diente</p></div>`
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

    const ver = panel.querySelector<HTMLInputElement>('#ver-seg');
    ver?.addEventListener('change', () => escena.muestraEtiquetas(ver.checked));

    // Picking semántico (§11.3): raycast a la malla → código FDI por vértice.
    const salida = panel.querySelector<HTMLDivElement>('#pieza');
    if (salida) {
      lienzo.addEventListener('click', (ev) => {
        const fdi = escena.pieza(ev.clientX, ev.clientY);
        // ⚠️ Lo que se puede decir de la pieza es SOLO lo que el contenedor trae. Hoy eso
        // es su código y de qué modelo salió; el pH y los hallazgos que el pipeline extrae
        // no viajan porque el spec los manda a FHIR (§9), fuera del .uos.
        if (!fdi) {
          salida.innerHTML = '<p class="nota">ahí no hay ninguna pieza etiquetada</p>';
          return;
        }
        // Lo que se puede decir de la pieza es SOLO lo que el contenedor trae, y de dónde
        // viene cada mitad va escrito: la geometría la segmentó un modelo (Layer 3), lo
        // clínico lo dice un informe que firmó una persona (Layer 1).
        salida.innerHTML =
          fichaDe(fdi, piezas.get(String(fdi)), true) +
          `<p class="nota">segmentada por ${meta?.model.name ?? '—'} ·
             <span class="l3">Layer 3</span></p>`;
      });
    }

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


/** glTF binario → geometría. `GLTFLoader.parse` no toca la red: recibe el buffer. */
async function leeGLB(bytes: Uint8Array): Promise<BufferGeometry> {
  const copia = bytes.slice().buffer;
  const gltf = await new GLTFLoader().parseAsync(copia, '');
  let geometria: BufferGeometry | null = null;
  gltf.scene.traverse((o) => {
    if (!geometria && (o as Mesh).isMesh) geometria = (o as Mesh).geometry;
  });
  if (!geometria) {
    throw new Error('El glTF no trae ninguna malla: no hay escena que enseñar.');
  }
  return geometria;
}
