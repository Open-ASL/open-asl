import { Layer, type RuleModule } from '@asl/engine';
import { smokeIn } from '../sk1/terrain';

/**
 * Chapter B terrain where the full rule differs from the Starter Kit's (first needed
 * for board u). Everything else the board-u terrain needs is shared code.
 *
 * - **B.2 COT:** the Cost of Terrain is the hex's entry cost plus its Artificial Terrain (SMOKE) cost, and it is the COT
 *   that a move to a higher elevation doubles (A4.133, B10.4): Infantry entering an uphill hex holding SMOKE pay
 *   2 × (1 + 1) = 4 MF, not 2 × 1 + 1 = 3 (B.2's own example). The Starter Kit adds the Smoke MF after the doubling
 *   (SK1 3.3 makes it a separate +1; SK4 1.1.1 doubles the "Cost of Terrain" without counting Smoke in it).
 */
export const aslTerrainModule: RuleModule = {
  id: 'asl.terrain',
  ref: 'ASLRB B.2, B10.4',
  summary: 'Chapter B terrain beyond the Starter Kit: SMOKE is part of the COT doubled uphill.',
  requires: ['sk1.terrain'],
  install(r) {
    r.suppress<'move.cost'>({ id: 'asl.move.not-sk-smoke-cost', query: 'move.cost', target: 'sk1.move.smoke-cost', ref: 'ASLRB B.2' });
    // Before the Crest Line doubling (Base + 50), so it doubles with the terrain.
    r.contribute({
      id: 'asl.move.smoke-cot',
      query: 'move.cost',
      layer: Layer.Base + 10,
      ref: 'ASLRB B.2, A24.7',
      label: '+1 MF entering SMOKE (part of the COT)',
      when: ({ to }, env) => smokeIn(env, to),
      apply: (v) => v + 1,
    });
  },
};
