/** Estado inicial, apertura en curso y errores. Desaparece en cuanto hay un contenedor. */

type Estado = { readonly abriendo: string } | { readonly error: string } | null;

export function Portada({ estado }: { estado: Estado }) {
  if (estado && 'abriendo' in estado) {
    return <div id="portada"><p>Abriendo <code>{estado.abriendo}</code>…</p></div>;
  }
  if (estado && 'error' in estado) {
    return <div id="portada"><p className="error">{estado.error}</p></div>;
  }
  return (
    <div id="portada">
      <div className="marca">Unified Oral Scene</div>
      <p className="titular">Arrastra un <b>.uos</b> aquí</p>
      <p>
        Visor de referencia del formato. Abre el contenedor sin saber nada de quién lo
        escribió: lee el manifiesto, ordena los assets y aplica una vista guardada.
      </p>
      <p className="nota">
        Nada sale de tu navegador: el contenedor se lee en local, por rangos, sin subirlo a
        ningún sitio.
      </p>
    </div>
  );
}
