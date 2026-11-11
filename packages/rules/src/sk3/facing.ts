import type { Cube } from '@asl/engine';
import type { ArmorFacings } from '../common/statics';
import { inCoveredArc } from '../sk2/arc';

/*
 * Target facing (SK4 3.2.4): which Armor Factor a hit strikes. The front facing is the Covered Arc
 * of the hull (VCA) or turret (TCA) spine; the rear the arc of the opposite spine; the rest is the
 * side. A LOS running along a hexspine that bounds two facings uses the one least favourable to
 * the attacker: the higher Armor Factor.
 */

export type Facing = 'front' | 'side' | 'rear';

/** Whether `other` lies strictly inside the arc of `spine` (not on one of its bounding hexrows). */
const strictlyIn = (at: Cube, spine: number, other: Cube) =>
  inCoveredArc(at, spine, other) && !inCoveredArc(at, (spine + 1) % 6, other) && !inCoveredArc(at, (spine + 5) % 6, other);

/**
 * The facing a shot from `firer` strikes on a vehicle at `at` whose (hull or turret) arc points at
 * `spine`, given the Armor Factors of that aspect (ties on a bounding hexspine go to the higher AF).
 */
export function facingOf(at: Cube, spine: number, firer: Cube, af: ArmorFacings): Facing {
  const front = inCoveredArc(at, spine, firer);
  const rear = inCoveredArc(at, (spine + 3) % 6, firer);
  if (front && strictlyIn(at, spine, firer)) return 'front';
  if (rear && strictlyIn(at, (spine + 3) % 6, firer)) return 'rear';
  if (front) return af.front >= af.side ? 'front' : 'side';
  if (rear) return af.rear >= af.side ? 'rear' : 'side';
  return 'side';
}

/** Fire from within the target's own hex: the colored die of the To Hit DR decides (1-2 rear, 3-4 side, 5-6 front). */
export const facingBySameHexDie = (colored: number): Facing => (colored <= 2 ? 'rear' : colored <= 4 ? 'side' : 'front');

/** Turret if the colored die of the To Hit DR is less than the white, else hull (SK4 3.2.4). */
export const hitLocation = (white: number, colored: number): 'hull' | 'turret' => (colored < white ? 'turret' : 'hull');
