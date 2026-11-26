/**
 * Junta varios trozos de un mismo PLY binario (los que da `partePorColumna`) en uno.
 *
 * Los trozos comparten cabecera salvo el recuento de `element vertex`, así que basta con
 * sumar los recuentos y concatenar los cuerpos.
 */
export function fundePly(trozos: readonly Uint8Array[]): Uint8Array {
  const FIN = 'end_header';
  const partes = trozos.map((t) => {
    const texto = new TextDecoder('ascii').decode(t.subarray(0, Math.min(t.length, 65536)));
    const corte = texto.indexOf(FIN);
    if (corte < 0) throw new Error('un trozo del PLY no tiene `end_header`');
    const inicio = corte + FIN.length + (texto[corte + FIN.length] === '\r' ? 2 : 1);
    const n = Number(/element vertex (\d+)/.exec(texto.slice(0, corte))?.[1] ?? NaN);
    if (!Number.isFinite(n)) throw new Error('un trozo del PLY no declara `element vertex`');
    return { cabecera: texto.slice(0, inicio), cuerpo: t.subarray(inicio), n };
  });
  const total = partes.reduce((a, p) => a + p.n, 0);
  const cab = new TextEncoder().encode(
    partes[0]!.cabecera.replace(/element vertex \d+/, `element vertex ${total}`));
  const fuera = new Uint8Array(cab.length + partes.reduce((a, p) => a + p.cuerpo.length, 0));
  fuera.set(cab, 0);
  let o = cab.length;
  for (const p of partes) { fuera.set(p.cuerpo, o); o += p.cuerpo.length; }
  return fuera;
}
