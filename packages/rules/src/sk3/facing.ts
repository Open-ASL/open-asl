import { cubeNeighbors, type Cube } from '@asl/engine';
import type { ArmorFacings } from '../common/statics';

/*
 * Target facing (SK4 3.2.4 and its diagram; ASLRB D3.2): which Armor Factor a hit strikes depends on the target hexside
 * the firer's LOS crosses. The hull (VCA) or turret (TCA) points at a hexspine: the two hexsides beside it are the front,
 * the two beside the opposite hexspine the rear, and the one hexside between on each hand a side. So the front is wider
 * than the Covered Arc: a firer anywhere within 60° of the facing hexspine, seen from the target, strikes it. A LOS
 * running exactly along a hexspine that bounds two facings (through that vertex of the target hex) uses the facing least
 * favourable to the attacker.
 */

export type Facing = 'front' | 'side' | 'rear';

const DIRS = cubeNeighbors({ q: 0, r: 0, s: 0 });

/** The direction of hexspine `k` from its hex's centre: between neighbour directions `k` and `k + 1` (N, NE, SE, S, SW, NW). */
const vertex = (k: number): Cube => {
  const a = DIRS[((k % 6) + 6) % 6]!;
  const b = DIRS[(((k % 6) + 6) % 6 + 1) % 6]!;
  return { q: a.q + b.q, r: a.r + b.r, s: a.s + b.s };
};

/**
 * Where `d` lies in the wedge between the hexspine directions `u` and `w` (less than 180° apart): strictly inside, along
 * one of its bounding hexspines, or outside.
 */
function wedge(d: Cube, u: Cube, w: Cube): 'in' | 'edge' | 'out' {
  // d = x·u + y·w, solved over (q, r) with integer numerators; the sign of det fixes their orientation.
  const det = u.q * w.r - w.q * u.r;
  const x = (d.q * w.r - d.r * w.q) * Math.sign(det);
  const y = (u.q * d.r - u.r * d.q) * Math.sign(det);
  if (x > 0 && y > 0) return 'in';
  if ((x === 0 && y > 0) || (y === 0 && x > 0)) return 'edge';
  return 'out';
}

/**
 * The facing a shot from `firer` strikes on a vehicle at `at` whose (hull or turret) points at hexspine `spine`, given
 * the Armor Factors of that aspect. On a bounding hexspine the facing least favourable to the attacker: the higher AF
 * between front and side; the rear only when its AF is more than 1 above the side's, as a rear hit raises the TK# by 1
 * (SK4 7.1).
 */
export function facingOf(at: Cube, spine: number, firer: Cube, af: ArmorFacings): Facing {
  const d = { q: firer.q - at.q, r: firer.r - at.r, s: firer.s - at.s };
  const front = wedge(d, vertex(spine - 1), vertex(spine + 1));
  const rear = wedge(d, vertex(spine + 2), vertex(spine + 4));
  if (front === 'in') return 'front';
  if (rear === 'in') return 'rear';
  if (front === 'edge') return af.front >= af.side ? 'front' : 'side';
  if (rear === 'edge') return af.rear - 1 > af.side ? 'rear' : 'side';
  return 'side';
}

/** Fire from within the target's own hex: the colored die of the To Hit DR decides (1-2 rear, 3-4 side, 5-6 front). */
export const facingBySameHexDie = (colored: number): Facing => (colored <= 2 ? 'rear' : colored <= 4 ? 'side' : 'front');

/** Turret if the colored die of the To Hit DR is less than the white, else hull (SK4 3.2.4). */
export const hitLocation = (white: number, colored: number): 'hull' | 'turret' => (colored < white ? 'turret' : 'hull');
