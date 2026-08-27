/**
 * El lector, contra `.uos` de verdad.
 *
 * Los contenedores no se versionan —son datos clínicos— así que estos tests se **saltan**
 * si no están, en vez de fallar en el CI de alguien que clone el repositorio. Lo que sí
 * hacen, cuando están, es probar lo único que no se puede probar con un fixture inventado:
 * que un ZIP escrito por otra herramienta, con sus extras y su cabecera, se lee bien.
 */

import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { NodeFileReader } from '../src/uos/NodeReader';
import { UosLoader } from '../src/uos/UosLoader';
import { ZipReader } from '../src/uos/ZipReader';

const CORE = process.env.UOS_CORE ?? '';
const VOL = process.env.UOS_VOL ?? '';
const hay = (p: string) => p !== '' && existsSync(p);

describe.runIf(hay(CORE))('un .uos de nivel UOS-Core', () => {
  const abrir = () => UosLoader.abrir(new NodeFileReader(CORE));

  it('se identifica por su PRIMERA entrada, no por la extensión', async () => {
    const zip = await ZipReader.abrir(new NodeFileReader(CORE));
    expect(zip.primera?.nombre).toBe('manifest.json');
  });

  it('no lleva nada comprimido: el spec §3 exige STORE', async () => {
    const zip = await ZipReader.abrir(new NodeFileReader(CORE));
    expect(zip.entradas.filter((e) => e.comprimido)).toEqual([]);
  });

  it('abre y declara su marco canónico en milímetros', async () => {
    const uos = await abrir();
    // ⚠️ **Un asset `external` NO puede aparecer como reparo.** El perfil de solo
    // gaussianas deja fuera el escaneo, las fotos y los informes, y el loader reparaba por
    // cada uno: once líneas rojas encima de la escena por hacer exactamente lo que el
    // perfil promete. Un reparo es «esto se contradice»; que un original no viaje es lo
    // que el contenedor AFIRMA, y la ficha del asset ya lo dice con `FUERA · SÓLO SU HASH`.
    //
    // La versión anterior de este test exigía justo lo contrario —que TODO reparo hablara
    // de un asset externo— porque daba por buena esa lista. Confundir «lo explico» con «no
    // es un fallo» es como un aviso legítimo se pierde entre once que no lo son.
    const externos = new Set(uos.porPrioridad.filter((a) => a.external).map((a) => a.id));
    for (const r of uos.reparos) {
      expect([...externos].some((id) => r.texto.includes(id)), r.texto).toBe(false);
    }
    expect(uos.reparos.filter((r) => r.grave)).toEqual([]);
    expect(uos.manifiesto.canonical_frame.units).toBe('mm');
    expect(uos.manifiesto.phi_state).toBe('pseudonymized');
  });

  it('ordena los assets por prioridad de carga, y lo primero que se dibuja va primero', async () => {
    const uos = await abrir();
    const prios = uos.porPrioridad.map((a) => a.load_priority);
    expect(prios).toEqual([...prios].sort((a, b) => a - b));
    // ⚠️ **Esto decía «la escena antes que las fotos» y ya no puede decirlo.** El orden del
    // §4.1 es malla 10 → fotos 20 → GS 25 → volumen 30, y da por hecho que lo primero que
    // se enseña es una malla. En el perfil de solo gaussianas no hay malla: el campo es la
    // escena y carga en la 25, detrás de unas fotos que además son externas y no se bajan.
    //
    // Lo que sí se puede exigir —y es lo que el visor necesita— es que de lo que VIAJA y
    // se dibuja, el campo gaussiano sea lo primero.
    const dibujables = uos.porPrioridad.filter((a) => !a.external && a.bytes > 0);
    expect(dibujables[0]?.kind).toBeDefined();
    const primeraEscena = dibujables.findIndex((a) => a.kind === 'mesh_gs_scene');
    expect(primeraEscena, 'no viaja ninguna escena que dibujar').toBeGreaterThanOrEqual(0);
    for (const a of dibujables.slice(primeraEscena)) {
      expect(a.kind, 'algo que se dibuja carga DESPUÉS de la escena').not.toBe('image2d');
    }
  });

  it('baja un asset suelto SIN traerse el contenedor entero', async () => {
    // La prueba de que la lectura es por rangos: se cuenta cuántos bytes se piden.
    let pedidos = 0;
    const base = new NodeFileReader(CORE);
    const espia = {
      size: () => base.size(),
      slice: async (i: number, f: number) => {
        pedidos += f - i;
        return base.slice(i, f);
      },
    };
    const uos = await UosLoader.abrir(espia);
    // Uno que SÍ viaje: en el perfil de solo gaussianas las fotos son externas y pedirlas
    // no baja un byte — con lo que la prueba pasaría sin probar nada.
    const suelto = uos.porPrioridad.find(
      (a) => !a.external && !a.uri.endsWith('/') && a.bytes > 0,
    );
    expect(suelto).toBeDefined();
    await uos.bytes(suelto!);

    const total = await base.size();
    // Índice + manifiesto + una foto. Muy lejos del contenedor entero.
    expect(pedidos).toBeLessThan(total / 4);
  });

  it('el sha256 que declara el manifiesto es el del fichero', async () => {
    const uos = await abrir();
    const escena = uos.de('mesh_gs_scene').find((a) => !a.external)!;
    await expect(uos.verifica(escena)).resolves.toBe(true);
  });

  it('trae las vistas guardadas y todas apuntan a una visita declarada', async () => {
    const uos = await abrir();
    const vistas = await uos.vistas<{ id: string; visit: string }>();
    const visitas = new Set(uos.manifiesto.visits.map((v) => v.id));
    expect(vistas.length).toBeGreaterThan(0);
    for (const v of vistas) expect(visitas.has(v.visit)).toBe(true);
  });

  it('el marco del CBCT conecta con el canónico por una registración', async () => {
    const uos = await abrir();
    expect(uos.manifiesto.registrations.length).toBeGreaterThan(0);
    expect(uos.manifiesto.registrations[0]!.transform_4x4_row_major).toHaveLength(16);
  });
});

describe.runIf(hay(VOL))('un .uos de nivel UOS-Vol', () => {
  const abrir = () => UosLoader.abrir(new NodeFileReader(VOL));

  it('lleva la serie DICOM como asset-DIRECTORIO, con una parte por corte', async () => {
    const uos = await abrir();
    const volumen = uos.de('volume')[0];
    expect(volumen?.uri.endsWith('/')).toBe(true);
    expect(volumen!.parts!.length).toBeGreaterThan(300);
  });

  it('lee UN corte suelto de una serie de cientos de megas', async () => {
    let pedidos = 0;
    const base = new NodeFileReader(VOL);
    const espia = {
      size: () => base.size(),
      slice: async (i: number, f: number) => {
        pedidos += f - i;
        return base.slice(i, f);
      },
    };
    const uos = await UosLoader.abrir(espia);
    const volumen = uos.de('volume')[0]!;
    const corte = await uos.parte(volumen, volumen.parts![0]!.name);

    expect(corte.length).toBe(volumen.parts![0]!.bytes);
    // Un DICOM lleva `DICM` en el byte 128. Es la prueba de que se leyó el sitio correcto.
    expect(new TextDecoder().decode(corte.subarray(128, 132))).toBe('DICM');
    // Y de que no se bajó la serie entera para conseguirlo.
    expect(pedidos).toBeLessThan((await base.size()) / 10);
  });

  it('el sidecar del volumen evita necesitar un parser DICOM', async () => {
    const uos = await abrir();
    const volumen = uos.de('volume')[0]!;
    const sidecar = await uos.sidecar<{
      dimensions: number[];
      spacing_mm: number[];
      frame: string;
    }>(volumen);
    expect(sidecar!.dimensions).toHaveLength(3);
    expect(sidecar!.spacing_mm.every((s) => s > 0)).toBe(true);
    expect(sidecar!.frame).toBe(volumen.frame);
  });

  it('el volumen se carga el ÚLTIMO: su prioridad va detrás de la escena', async () => {
    const uos = await abrir();
    const volumen = uos.de('volume')[0]!;
    const escena = uos.de('mesh_gs_scene')[0]!;
    expect(escena.load_priority).toBeLessThan(volumen.load_priority);
  });
});
