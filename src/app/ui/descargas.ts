/** Ofrecer bytes al disco. Es el mismo gesto para un asset verificado y para uno regenerado. */
export function baja(bytes: Uint8Array | string, nombre: string, tipo: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: tipo }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  a.click();
  // Revocar en el mismo tick cancela la descarga en algunos navegadores.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
