/**
 * Hex math for ASL maps. ASL boards use vertical hex columns (flat-topped hexes),
 * so we use "flat" cube coordinates. Board-specific naming (yK2 -> col/row) lives
 * in the map layer; this file is pure geometry.
 */

export interface Cube {
  q: number;
  r: number;
  s: number;
}

export interface Offset {
  col: number;
  row: number;
}

/**
 * How odd/even columns are shifted. In "odd-q" odd columns sit half a hex lower;
 * in "even-q" even columns do.
 */
export type ColumnParity = 'odd-q' | 'even-q';

export function offsetToCube({ col, row }: Offset, parity: ColumnParity): Cube {
  const shift = parity === 'odd-q' ? col & 1 : (col + 1) & 1;
  const q = col;
  const r = row - (col - shift) / 2;
  return { q, r, s: -q - r };
}

export function cubeToOffset({ q, r }: Cube, parity: ColumnParity): Offset {
  const shift = parity === 'odd-q' ? q & 1 : (q + 1) & 1;
  return { col: q, row: r + (q - shift) / 2 };
}

export function cubeDistance(a: Cube, b: Cube): number {
  return Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(a.s - b.s));
}

const DIRECTIONS: Cube[] = [
  { q: 0, r: -1, s: 1 }, // N
  { q: 1, r: -1, s: 0 }, // NE
  { q: 1, r: 0, s: -1 }, // SE
  { q: 0, r: 1, s: -1 }, // S
  { q: -1, r: 1, s: 0 }, // SW
  { q: -1, r: 0, s: 1 }, // NW
];

export function cubeNeighbors(c: Cube): Cube[] {
  return DIRECTIONS.map((d) => ({ q: c.q + d.q, r: c.r + d.r, s: c.s + d.s }));
}

export function cubeEquals(a: Cube, b: Cube): boolean {
  return a.q === b.q && a.r === b.r;
}

function cubeRound(q: number, r: number, s: number): Cube {
  let rq = Math.round(q);
  let rr = Math.round(r);
  let rs = Math.round(s);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  else rs = -rq - rr;
  return { q: rq + 0, r: rr + 0, s: rs + 0 };
}

/**
 * Hexes whose interiors a straight center-to-center line passes through. Lines
 * running exactly along a hexside are nudged both ways; `alongHexside` reports
 * which steps were ambiguous so LOS rules can treat both neighbours.
 */
export function cubeLine(a: Cube, b: Cube): { hexes: Cube[]; alt: (Cube | null)[] } {
  const n = cubeDistance(a, b);
  const hexes: Cube[] = [];
  const alt: (Cube | null)[] = [];
  const eps = 1e-6;
  for (let i = 0; i <= n; i++) {
    const t = n === 0 ? 0 : i / n;
    const q = a.q + (b.q - a.q) * t;
    const r = a.r + (b.r - a.r) * t;
    const s = a.s + (b.s - a.s) * t;
    const plus = cubeRound(q + eps, r + eps, s - 2 * eps);
    const minus = cubeRound(q - eps, r - eps, s + 2 * eps);
    hexes.push(plus);
    alt.push(cubeEquals(plus, minus) ? null : minus);
  }
  return { hexes, alt };
}

/** True when a and b lie on a common hex grain (straight line through hex centers). */
export function onHexGrain(a: Cube, b: Cube): boolean {
  return a.q === b.q || a.r === b.r || a.s === b.s;
}

/** Center of a flat-topped hex in units where hex width (flat-to-flat... point-to-point) = 2*size. */
export function cubeToPixel(c: Cube, size: number): { x: number; y: number } {
  return {
    x: size * 1.5 * c.q,
    y: size * Math.sqrt(3) * (c.r + c.q / 2),
  };
}
