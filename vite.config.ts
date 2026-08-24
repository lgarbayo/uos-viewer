import { defineConfig } from 'vite';

/**
 * `base: './'` y no `/uos-viewer/`: con rutas relativas el mismo `dist/` sirve desde
 * GitHub Pages bajo el nombre del repositorio, desde la raiz de un dominio propio y desde
 * `file://`. Una base absoluta ata el build a una URL concreta y rompe las otras dos.
 *
 * ⚠️ **Aqui NO hacen falta las cabeceras COOP/COEP** que sí lleva `dental-3dgs-viewer`.
 * Aquellas existen para que la pagina quede `crossOriginIsolated` y el rasterizador de
 * splats pueda usar `SharedArrayBuffer`. Este visor todavia no rasteriza splats —el paso 3
 * del §11.2 esta por hacer— asi que exigirlas seria pedir un privilegio que no se usa, y
 * de paso romperia el `fetch` por rangos contra un `.uos` alojado en otro origen, que es
 * justo lo que este visor existe para hacer.
 */
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    // three.js pesa y cambia poco; se separa para que el navegador lo cachee aparte del
    // codigo propio, que cambia en cada commit.
    rollupOptions: { output: { manualChunks: { three: ['three'] } } },
  },
});
