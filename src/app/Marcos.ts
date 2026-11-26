/**
 * Llevar un marco al canónico con las registraciones que DECLARA el manifiesto (§6).
 *
 * ⚠️ **Esto no es registrar nada: es leer.** El visor es Layer 1 y no alinea dos
 * modalidades por su cuenta; aplica la matriz que el emisor escribió, con el método, el
 * residuo y la verificación que el emisor declaró, y la interfaz enseña las tres cosas al
 * lado de lo que se dibuja con ella. Si no hay camino de registraciones hasta el canónico,
 * la capa no se coloca: dibujarla «donde caiga» sería inventar un alineamiento.
 */

import { Matrix4 } from 'three';

import { esProvisional, type Manifiesto, type Registro } from '../uos/Manifest';

export interface Paso {
  readonly registro: Registro;
  /** Se recorrió de `target` a `source`, así que se aplicó su inversa. */
  readonly invertido: boolean;
}

export interface Colocacion {
  /** Lleva puntos del marco de origen al canónico. */
  readonly matriz: Matrix4;
  readonly pasos: readonly Paso[];
  /** Alguna registración de la cadena es provisional (§6: automática y sin firmar). */
  readonly provisional: boolean;
  /** Ninguna registración de la cadena la ha verificado una persona. */
  readonly sinVerificar: boolean;
}

/** La matriz de una registración. El manifiesto la escribe por filas; three la quiere así en `set`. */
function matrizDe(r: Registro): Matrix4 {
  const t = r.transform_4x4_row_major;
  if (t.length !== 16 || !t.every(Number.isFinite)) {
    throw new Error(`La registración \`${r.id}\` no trae una matriz 4×4 válida`);
  }
  return new Matrix4().set(
    t[0]!, t[1]!, t[2]!, t[3]!,
    t[4]!, t[5]!, t[6]!, t[7]!,
    t[8]!, t[9]!, t[10]!, t[11]!,
    t[12]!, t[13]!, t[14]!, t[15]!,
  );
}

/**
 * La colocación de `marco` en el canónico, o `null` si ninguna cadena de registraciones
 * los une. El camino es el MÁS CORTO: cada salto añade el error de una registración.
 */
export function colocaEnCanonico(m: Manifiesto, marco: string): Colocacion | null {
  const canonico = m.canonical_frame.id;
  if (marco === canonico) {
    return { matriz: new Matrix4(), pasos: [], provisional: false, sinVerificar: false };
  }
  // Búsqueda en anchura desde el canónico: `previo[f]` es cómo se llegó a `f`.
  const previo = new Map<string, { desde: string; paso: Paso }>();
  const visto = new Set([canonico]);
  let frontera = [canonico];
  while (frontera.length && !visto.has(marco)) {
    const siguiente: string[] = [];
    for (const f of frontera) {
      for (const r of m.registrations) {
        // Desde el canónico hacia fuera: si la registración llega a `f`, su origen se
        // alcanza aplicándola tal cual; si sale de `f`, su destino se alcanza invertida.
        const vecinos: [string, boolean][] = [];
        if (r.target_frame === f) vecinos.push([r.source_frame, false]);
        if (r.source_frame === f) vecinos.push([r.target_frame, true]);
        for (const [otro, invertido] of vecinos) {
          if (visto.has(otro)) continue;
          visto.add(otro);
          previo.set(otro, { desde: f, paso: { registro: r, invertido } });
          siguiente.push(otro);
        }
      }
    }
    frontera = siguiente;
  }
  if (!visto.has(marco)) return null;

  // De `marco` hacia el canónico, componiendo en el orden en que se aplican.
  const pasos: Paso[] = [];
  const matriz = new Matrix4();
  for (let f = marco; f !== canonico;) {
    const p = previo.get(f)!;
    const mm = matrizDe(p.paso.registro);
    if (p.paso.invertido) mm.invert();
    matriz.premultiply(mm);
    pasos.push(p.paso);
    f = p.desde;
  }
  return {
    matriz,
    pasos,
    provisional: pasos.some((p) => esProvisional(p.registro)),
    sinVerificar: pasos.some((p) => !p.registro.verified_by),
  };
}
