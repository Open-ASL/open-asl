import type { RuleModule } from '@asl/engine';
import { mmc } from '../sk1/status';

/**
 * ASLRB A9.72: "Any Good Order unit may attempt to repair as many of its malfunctioned SW during any RPh as it can
 * fire in one phase, by making a dr for each": a squad two, any other unit one.
 *
 * The SK text (SK1/SK4 3.1) allows "each unit ... only one action per RPh", so one repair attempt (`sk1/rally.ts`).
 * Either way each SW gets one dr per Player Turn.
 */
export const aslSwRepairModule: RuleModule = {
  id: 'asl.swRepair',
  ref: 'ASLRB A9.72',
  summary: 'SW repair: a unit may try to repair as many SW as it could fire, a squad two.',
  requires: ['sk1.rally'],
  install(r) {
    r.contribute({
      id: 'asl.swRepair.squad',
      query: 'rally.repairs',
      ref: 'ASLRB A9.72',
      apply: (v, { unit }, env) => (mmc(env, env.state.pieces[unit]!)?.kind === 'squad' ? Math.max(v, 2) : v),
    });
  },
};
