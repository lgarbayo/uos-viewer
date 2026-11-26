/**
 * Contadores de SÓLO DESARROLLO: contextos WebGL y workers vivos.
 *
 * ⚠️ **Existe para poder afirmar que no hay fugas, no para suponerlo.** El modo estricto
 * monta y desmonta el visor dos veces al arrancar; si `Visor.dispose` se dejara un contexto
 * o un worker, aquí se vería un 2 donde tiene que haber un 1. Se consulta desde la consola:
 *
 *     __uosDiagnostico()   // { contextosVivos, contextosCreados, workersVivos, ... }
 *
 * No entra en el build de producción: `main.tsx` lo importa tras `import.meta.env.DEV`.
 */

const contextos = new Set<WebGLRenderingContext | WebGL2RenderingContext>();
let contextosCreados = 0;
let contextosPerdidos = 0;
const workers = new Set<Worker>();
let workersCreados = 0;

const getContextOriginal = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function (
  this: HTMLCanvasElement, tipo: string, ...resto: unknown[]
) {
  const ctx = (getContextOriginal as (...a: unknown[]) => RenderingContext | null)
    .call(this, tipo, ...resto);
  if (ctx && /webgl/.test(tipo) && !contextos.has(ctx as WebGL2RenderingContext)) {
    const gl = ctx as WebGL2RenderingContext;
    contextos.add(gl);
    contextosCreados++;
    this.addEventListener('webglcontextlost', () => {
      contextos.delete(gl);
      contextosPerdidos++;
    }, { once: true });
  }
  return ctx;
} as typeof HTMLCanvasElement.prototype.getContext;

const WorkerOriginal = globalThis.Worker;
globalThis.Worker = class extends WorkerOriginal {
  constructor(url: string | URL, opciones?: WorkerOptions) {
    super(url, opciones);
    workers.add(this);
    workersCreados++;
  }
  override terminate(): void {
    workers.delete(this);
    super.terminate();
  }
};

declare global {
  interface Window {
    __uosDiagnostico: () => {
      contextosVivos: number;
      contextosCreados: number;
      contextosPerdidos: number;
      workersVivos: number;
      workersCreados: number;
      lienzos: number;
    };
  }
}

window.__uosDiagnostico = () => ({
  contextosVivos: contextos.size,
  contextosCreados,
  contextosPerdidos,
  workersVivos: workers.size,
  workersCreados,
  lienzos: document.querySelectorAll('canvas').length,
});

export {};
