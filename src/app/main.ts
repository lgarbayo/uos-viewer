/**
 * App de demostración: arrastra un `.uos` y se abre.
 *
 * Es el mínimo que demuestra lo que este repositorio existe para demostrar — que un `.uos`
 * se puede abrir **sin saber nada de quién lo escribió**: se lee el manifiesto, se ordenan
 * los assets por prioridad, se carga la escena y se aplica una vista guardada. Todo lo
 * demás que pide el §11 está por hacer, y el `README` dice cuál es cuál.
 */

import { BufferGeometry, Float32BufferAttribute } from 'three';

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
    const escenaAsset = uos.de('mesh_gs_scene')[0];
    if (escenaAsset && escenaAsset.media_type === 'model/stl') {
      escena.ponMalla(leeSTL(await uos.bytes(escenaAsset)));
      if (vistas[0]) escena.aplicaVista(vistas[0].camera);
      else escena.encuadraTodo();
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
              `<li>${r.id}: ${r.source_frame} → ${r.target_frame}
               <span class="k">${r.method}</span>
               ${r.verified_by ? '' : '<span class="prov">provisional</span>'}</li>`,
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
        uos.reparos.length
          ? `<h3>Reparos</h3><ul class="reparos">${uos.reparos
              .map((r) => `<li class="${r.grave ? 'grave' : ''}">${r.texto}</li>`)
              .join('')}</ul>`
          : ''
      }`;

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
