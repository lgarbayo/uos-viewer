/**
 * El ZIP de un `.uos`, leído por el final: directorio central primero, datos a demanda.
 *
 * **Por qué esto y no una librería de ZIP.** Las que hay (`fflate`, `jszip`) están hechas
 * para descomprimir un buffer que ya tienes entero, que es justo lo contrario de lo que
 * hace falta aquí. El spec elige STORE y directorio central al final precisamente para que
 * un cliente lea el índice —unos pocos KB— y baje **sólo el asset que quiere**. En un caso
 * con CBCT eso es 4 KB frente a 299 MB.
 *
 * **Sólo STORE, y se falla si no.** El spec §3 lo exige: los payloads ya vienen
 * comprimidos (DICOM JPEG-LS, SPZ, GLB con Draco) y comprimir el ZIP sólo rompe el acceso
 * aleatorio. Un `.uos` con entradas deflate no es un `.uos`, y aceptarlo en silencio haría
 * que este visor tolerase ficheros que otro rechazaría.
 */

const FIRMA_EOCD = 0x06054b50;
const FIRMA_EOCD64 = 0x06064b50;
const FIRMA_CENTRAL = 0x02014b50;
const FIRMA_LOCAL = 0x04034b50;

/** El EOCD mide 22 bytes más el comentario, que puede llegar a 64 KB. */
const MAX_COMENTARIO = 0xffff;
const TAM_EOCD = 22;

export interface EntradaZip {
  readonly nombre: string;
  /** Offset de la cabecera LOCAL, no de los datos: entre medias va el nombre y los extras. */
  readonly offsetCabecera: number;
  readonly bytes: number;
  readonly comprimido: boolean;
}

export class ZipReader {
  private constructor(
    private readonly origen: { slice(i: number, f: number): Promise<Uint8Array> },
    readonly entradas: readonly EntradaZip[],
  ) {}

  /** Lee el directorio central. Es la única lectura obligatoria para abrir un `.uos`. */
  static async abrir(origen: {
    size(): Promise<number>;
    slice(i: number, f: number): Promise<Uint8Array>;
  }): Promise<ZipReader> {
    const total = await origen.size();
    const cola = Math.min(total, TAM_EOCD + MAX_COMENTARIO);
    const buf = await origen.slice(total - cola, total);
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

    // Hacia atrás: el EOCD es lo último, salvo por su propio comentario.
    let eocd = -1;
    for (let i = buf.length - TAM_EOCD; i >= 0; i--) {
      if (dv.getUint32(i, true) === FIRMA_EOCD) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) {
      throw new Error(
        'No se encontró el directorio central: esto no es un ZIP, así que tampoco un .uos.',
      );
    }

    const nEntradas = dv.getUint16(eocd + 10, true);
    const tamCentral = dv.getUint32(eocd + 12, true);
    const offCentral = dv.getUint32(eocd + 16, true);

    // ⚠️ ZIP64 se detecta y se DECLARA, no se adivina. Un contenedor con el volumen de
    // varias visitas pasa de 4 GB sin esfuerzo, y leerlo con los campos de 32 bits daría
    // offsets truncados: entradas que apuntan a mitad de otro fichero, sin error.
    if (offCentral === 0xffffffff || nEntradas === 0xffff) {
      let tieneEocd64 = false;
      for (let i = eocd - 4; i >= 0 && !tieneEocd64; i--) {
        tieneEocd64 = dv.getUint32(i, true) === FIRMA_EOCD64;
      }
      throw new Error(
        'Este .uos usa ZIP64 (más de 4 GB o más de 65.535 entradas) y este lector ' +
          `todavía no lo soporta${tieneEocd64 ? '' : ', y además no trae su EOCD64'}. ` +
          'Se falla en vez de leer offsets truncados, que apuntarían a mitad de otro ' +
          'fichero sin dar error.',
      );
    }

    const central = await origen.slice(offCentral, offCentral + tamCentral);
    return new ZipReader(origen, leeCentral(central, nEntradas));
  }

  /** La primera entrada FÍSICA del ZIP. El spec exige que sea `manifest.json` (§3). */
  get primera(): EntradaZip | undefined {
    return [...this.entradas].sort((a, b) => a.offsetCabecera - b.offsetCabecera)[0];
  }

  entrada(nombre: string): EntradaZip | undefined {
    return this.entradas.find((e) => e.nombre === nombre);
  }

  /**
   * Los bytes de una entrada. **Dos peticiones**: la cabecera local y luego los datos.
   *
   * Hacen falta las dos porque el directorio central da el offset de la cabecera, y el
   * tamaño de sus campos variables —nombre y extras— sólo está en la cabecera misma. Los
   * ZIP escritos por herramientas distintas ponen extras distintos ahí, así que deducirlo
   * del nombre que da el central es una suposición que falla con `zip -X` y con Info-ZIP.
   */
  async leer(nombre: string): Promise<Uint8Array> {
    const e = this.entrada(nombre);
    if (!e) throw new Error(`El contenedor no lleva \`${nombre}\`.`);
    if (e.comprimido) {
      throw new Error(
        `\`${nombre}\` está comprimido y el spec §3 exige STORE. Un .uos con entradas ` +
          'deflate rompe el acceso aleatorio por rangos, que es el motivo de que el ' +
          'formato sea un ZIP y no un tar.',
      );
    }
    const cab = await this.origen.slice(e.offsetCabecera, e.offsetCabecera + 30);
    const dv = new DataView(cab.buffer, cab.byteOffset, cab.byteLength);
    if (dv.getUint32(0, true) !== FIRMA_LOCAL) {
      throw new Error(
        `La cabecera local de \`${nombre}\` no tiene la firma que toca: el directorio ` +
          'central apunta a un sitio que no es el principio de una entrada.',
      );
    }
    const inicio =
      e.offsetCabecera + 30 + dv.getUint16(26, true) + dv.getUint16(28, true);
    return this.origen.slice(inicio, inicio + e.bytes);
  }

  async leerTexto(nombre: string): Promise<string> {
    return new TextDecoder('utf-8').decode(await this.leer(nombre));
  }

  async leerJSON<T>(nombre: string): Promise<T> {
    return JSON.parse(await this.leerTexto(nombre)) as T;
  }
}

function leeCentral(buf: Uint8Array, n: number): EntradaZip[] {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const decodifica = new TextDecoder('utf-8');
  const fuera: EntradaZip[] = [];
  let p = 0;
  for (let i = 0; i < n; i++) {
    if (dv.getUint32(p, true) !== FIRMA_CENTRAL) {
      throw new Error(
        `El directorio central se rompe en la entrada ${i + 1} de ${n}: el fichero está ` +
          'truncado o la cabecera miente sobre cuántas hay.',
      );
    }
    const metodo = dv.getUint16(p + 10, true);
    const tamNombre = dv.getUint16(p + 28, true);
    const tamExtra = dv.getUint16(p + 30, true);
    const tamComentario = dv.getUint16(p + 32, true);
    fuera.push({
      nombre: decodifica.decode(buf.subarray(p + 46, p + 46 + tamNombre)),
      offsetCabecera: dv.getUint32(p + 42, true),
      bytes: dv.getUint32(p + 24, true),
      comprimido: metodo !== 0,
    });
    p += 46 + tamNombre + tamExtra + tamComentario;
  }
  return fuera;
}
