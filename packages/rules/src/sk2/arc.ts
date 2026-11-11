import { cubeNeighbors, type Cube } from '@asl/engine';
import type { Mount } from '../common/statics';

/*
 * Covered Arc geometry (SK4 3.2.4). A Gun points at one of the six hexspines of its hex; its
 * Covered Arc is its own hex, the two hexes joined by that hexspine, the two diagonal hexrows
 * running on from those hexes, and every hex between them. Spine `k` lies between neighbour
 * directions `k` and `k + 1` of the engine's direction order (N, NE, SE, S, SW, NW): spine 0 points
 * between the N and NE neighbours, spine 3 between S and SW.
 */

export const SPINES = 6;

/** The two neighbour directions a spine lies between. */
export const spineDirections = (spine: number): [number, number] => [((spine % 6) + 6) % 6, (((spine % 6) + 6) % 6 + 1) % 6];

const DIRS = cubeNeighbors({ q: 0, r: 0, s: 0 });

/** Whether `target` lies in the Covered Arc of a Gun at `gun` pointing at `spine`. */
export function inCoveredArc(gun: Cube, spine: number, target: Cube): boolean {
  const [i, j] = spineDirections(spine);
  const a = DIRS[i]!;
  const b = DIRS[j]!;
  const dq = target.q - gun.q;
  const dr = target.r - gun.r;
  // delta = x·a + y·b with x, y non-negative integers (the two bounding hexrows and the wedge between).
  const det = a.q * b.r - b.q * a.r;
  const x = (dq * b.r - dr * b.q) / det;
  const y = (a.q * dr - a.r * dq) / det;
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0;
}

/** Hexspine changes between two Covered Arcs (0–3). */
export function spineChange(from: number, to: number): number {
  const d = Math.abs((((to - from) % 6) + 6) % 6);
  return Math.min(d, 6 - d);
}

/**
 * To Hit DRM for changing the Covered Arc before firing (chart case 8): +1 per hexspine for a 360°
 * mount or a Fast Turret; +2 for the first hexspine and +1 for each further one for a Slow Turret
 * (RST and 1MT count as ST, SK4 7.2); +3 then +1 for a Non-Turreted Gun or bow-mounted MA.
 */
export function caChangeDrm(mount: Mount, spines: number): number {
  if (spines <= 0) return 0;
  if (mount === '360' || mount === 'T') return spines;
  if (mount === 'NT') return 3 + (spines - 1);
  return 2 + (spines - 1);
}

/** The chart's name for a mount in a Covered Arc change note. */
export const mountLabel = (mount: Mount): string =>
  mount === '360' ? '360° mount' : mount === 'T' ? 'Fast Turret' : mount === 'ST' ? 'Slow Turret' : mount === 'RST' ? 'Restricted Slow Turret' : mount === '1MT' ? 'One Man Turret' : 'NT';

/** The spine of a Gun at `gun` that covers `target` with the fewest hexspine changes from `current`. */
export function nearestSpine(gun: Cube, current: number, target: Cube): number | null {
  let best: number | null = null;
  for (let s = 0; s < SPINES; s++) {
    if (!inCoveredArc(gun, s, target)) continue;
    if (best === null || spineChange(current, s) < spineChange(current, best)) best = s;
  }
  return best;
}

/** The two hexes joined by a Gun's Covered Arc hexspine (the arc's bounding neighbours). */
export function arcNeighbours(gun: Cube, spine: number): [Cube, Cube] {
  const [i, j] = spineDirections(spine);
  const n = cubeNeighbors(gun);
  return [n[i]!, n[j]!];
}
