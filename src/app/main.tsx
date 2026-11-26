/**
 * Entrada del visor. React pinta la interfaz; el render vive en `Visor` (ver `ui/useVisor`).
 *
 * ⚠️ **`StrictMode` se queda puesto a propósito.** En desarrollo monta y desmonta cada
 * efecto dos veces, y eso es justo la prueba de que `Visor.dispose` suelta el contexto
 * WebGL, el rasterizador de splats con sus workers y los listeners. Quitarlo escondería
 * una fuga en vez de arreglarla.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './style.css';
import { App } from './ui/App';

if (import.meta.env.DEV) await import('./diagnostico');

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
