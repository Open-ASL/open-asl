import type { RuleModule } from '@asl/engine';
import { advanceEntryCost } from '../sk1/advance';

/*
 * Advance vs Difficult Terrain (ASLRB A4.72): "An advance into any hex whose MF cost (excluding SMOKE) is ≥ four MF or all
 * of a unit's available non-Double Time MF allotment (whichever is less) may not be made if the unit is already CX ...;
 * otherwise it may advance but becomes CX in the process." The Starter Kit has only the second half ("If the unit uses all
 * of its MF to advance, it becomes CX", SK1 3.7), which stays the default of `advance.cx`.
 * - The cost is the advance's whole cost (`advance.cost`: the overstacking MF included, A5.11: the EX's squad "will have to
 *   become CX because the MF cost of the Location is now four MF"), less what SMOKE adds to the terrain.
 * Not here: the Climbing and Deep Stream exceptions (B11.432, B20.43: not on the boards in play).
 */
export const aslAdvanceDifficultModule: RuleModule = {
  id: 'asl.advanceDifficult',
  ref: 'ASLRB A4.72',
  summary: 'Advance vs Difficult Terrain: an advance costing four MF (or all the unit\'s MF) makes it CX, and is refused to a CX unit.',
  requires: ['sk1.advance'],
  install(r) {
    r.contribute({
      id: 'asl.advance.difficult',
      query: 'advance.cx',
      ref: 'ASLRB A4.72',
      apply(_v, { unit, to, cost, mf }, env) {
        const smoke = advanceEntryCost(env, unit, to) - advanceEntryCost(env, unit, to, true);
        return cost - smoke >= Math.min(4, mf);
      },
    });
  },
};
