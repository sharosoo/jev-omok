/*
 * Decorative only, and deliberately not the real board: inline SVG costs no
 * WebGL context and no `three` chunk on the one route that has to paint fast.
 */

const LINES = [0, 1, 2, 3, 4, 5, 6, 7, 8];
const STEP = 24;
const EDGE = STEP * (LINES.length - 1);

/** A won diagonal, so the picture says "five in a row" without any copy. */
const BLACK = [
  [2, 6],
  [3, 5],
  [4, 4],
  [5, 3],
  [6, 2],
] as const;

const WHITE = [
  [4, 6],
  [5, 5],
  [3, 2],
  [6, 5],
] as const;

export function BoardMotif() {
  return (
    <svg
      aria-hidden="true"
      className="motif"
      viewBox={`-12 -12 ${String(EDGE + 24)} ${String(EDGE + 24)}`}
      role="presentation"
    >
      <g className="motif__grid">
        {LINES.map((i) => (
          <line key={`h${String(i)}`} x1={0} y1={i * STEP} x2={EDGE} y2={i * STEP} />
        ))}
        {LINES.map((i) => (
          <line key={`v${String(i)}`} x1={i * STEP} y1={0} x2={i * STEP} y2={EDGE} />
        ))}
      </g>
      {WHITE.map(([x, y]) => (
        <circle
          className="motif__stone motif__stone--white"
          cx={x * STEP}
          cy={y * STEP}
          key={`w${String(x)}-${String(y)}`}
          r={8}
        />
      ))}
      {BLACK.map(([x, y]) => (
        <circle
          className="motif__stone motif__stone--black"
          cx={x * STEP}
          cy={y * STEP}
          key={`b${String(x)}-${String(y)}`}
          r={8}
        />
      ))}
    </svg>
  );
}
