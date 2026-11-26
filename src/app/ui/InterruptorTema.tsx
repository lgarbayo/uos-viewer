/**
 * El interruptor de modo claro / oscuro.
 *
 * Una píldora con sombra interior y un botón cuadrado de esquinas redondeadas que se
 * desliza: a la derecha en claro, con un sol de matriz de puntos y brillo naranja; a la
 * izquierda en oscuro, con una luna creciente, estrellas y brillo azul violeta. El icono no
 * se funde entero: **se disuelve punto a punto**, cada punto con su propio retardo.
 *
 * ⚠️ **Los iconos son nuestros y van aquí como mapas de puntos**, sin dependencia ni
 * recurso de terceros: así la licencia no es una pregunta abierta, y el dibujo se puede
 * leer en el propio código.
 */

import { useId, type CSSProperties } from 'react';

import type { Tema } from './useTema';

const SOL = [
  '......#......',
  '......#......',
  '.............',
  '...#.....#...',
  '.....###.....',
  '....#####....',
  '##..#####..##',
  '....#####....',
  '.....###.....',
  '...#.....#...',
  '.............',
  '......#......',
  '......#......',
];

const LUNA = [
  '.............',
  '........#..#.',
  '....#........',
  '..###........',
  '..###........',
  '.####.......#',
  '.#####.......',
  '.######......',
  '.#######.....',
  '..#########..',
  '..#########..',
  '...#######...',
  '.............',
];

const LADO = 13;
const PASO = 2;

/** Los puntos encendidos de un mapa, con un retardo pseudoaleatorio pero FIJO por punto. */
function puntos(mapa: readonly string[], semilla: number): { x: number; y: number; d: number }[] {
  const fuera: { x: number; y: number; d: number }[] = [];
  mapa.forEach((fila, y) => {
    [...fila].forEach((c, x) => {
      if (c !== '#') return;
      // Un hash entero de (x, y): el mismo punto se disuelve siempre en el mismo orden, y
      // nada depende de `Math.random` durante el render, que React podría repetir.
      const h = Math.imul(x * 73856093 ^ y * 19349663 ^ semilla, 2654435761) >>> 0;
      fuera.push({ x, y, d: (h % 1000) / 1000 });
    });
  });
  return fuera;
}

const PUNTOS_SOL = puntos(SOL, 7);
const PUNTOS_LUNA = puntos(LUNA, 13);

function Icono({ lista, clase }: { lista: typeof PUNTOS_SOL; clase: string }) {
  return (
    <g className={clase}>
      {lista.map(({ x, y, d }) => (
        <rect key={`${x}-${y}`} x={x * PASO + 0.3} y={y * PASO + 0.3} width={PASO - 0.6}
          height={PASO - 0.6} rx={0.35}
          style={{ '--retardo': `${Math.round(d * 260)}ms` } as CSSProperties} />
      ))}
    </g>
  );
}

export function InterruptorTema({ tema, alCambiar }: {
  tema: Tema; alCambiar: (t: Tema) => void;
}) {
  const id = useId();
  const destino = tema === 'claro' ? 'oscuro' : 'claro';
  const texto = `Cambiar a modo ${destino}`;
  return (
    <span className="interruptor-tema">
      <button type="button" role="switch" aria-checked={tema === 'oscuro'}
        aria-label="Modo oscuro" aria-describedby={id} data-tema={tema}
        onClick={() => alCambiar(destino)}>
        <span className="pomo" aria-hidden="true">
          <svg viewBox={`0 0 ${LADO * PASO} ${LADO * PASO}`} width="100%" height="100%">
            <Icono lista={PUNTOS_SOL} clase="sol" />
            <Icono lista={PUNTOS_LUNA} clase="luna" />
          </svg>
        </span>
      </button>
      <span role="tooltip" id={id} className="tooltip">{texto}</span>
    </span>
  );
}
