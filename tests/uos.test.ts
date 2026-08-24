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

  it('abre sin reparos y declara su marco canónico en milímetros', async () => {
    const uos = await abrir();
    expect(uos.reparos).toEqual([]);
    expect(uos.manifiesto.canonical_frame.units).toBe('mm');
    expect(uos.manifiesto.phi_state).toBe('pseudonymized');
  });

  it('ordena los assets por prioridad de carga: la escena antes que las fotos', async () => {
    const uos = await abrir();
    const prios = uos.porPrioridad.map((a) => a.load_priority);
    expect(prios).toEqual([...prios].sort((a, b) => a - b));
    expect(uos.porPrioridad[0]?.kind).toBe('mesh_gs_scene');
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
    const foto = uos.de('image2d')[0];
    expect(foto).toBeDefined();
    await uos.bytes(foto!);

    const total = await base.size();
    // Índice + manifiesto + una foto. Muy lejos del contenedor entero.
    expect(pedidos).toBeLessThan(total / 4);
  });

  it('el sha256 que declara el manifiesto es el del fichero', async () => {
    const uos = await abrir();
    const malla = uos.de('mesh_gs_scene')[0]!;
    await expect(uos.verifica(malla)).resolves.toBe(true);
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
