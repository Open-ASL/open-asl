import type { RuleModule } from '@asl/engine';
import { ppCarried } from '../sk1/movement';

/*
 * Voluntary Rout (ASLRB A10.711) with the leader's own portage (A4.42), full ASL only:
 *
 * - "The leader, if already in possession of a SW, may portage it, but cannot improve the broken unit's portage
 *   capacity." What a SMC may portage is A4.42's: an IPC of one PP, one MF lost for each PP carried beyond it, and
 *   never more than two PP. So a leader carrying two PP may rout with the unit, one MF short; one carrying more may not
 *   (he could not move with it at all).
 * - "He must remain with the broken unit throughout the RtPh": the two rout on the fewer MF of the two. A rout that
 *   could not reach its shelter on the leader's MF is not one they may make together; the unit routs alone.
 * - The broken unit keeps only what its own IPC allows (A4.42 "even if accompanied by a leader"): the shared rout
 *   rules already drop the rest.
 */
export const aslVoluntaryRoutModule: RuleModule = {
  id: 'asl.voluntaryRout',
  ref: 'ASLRB A10.711, A4.42',
  summary: 'A leader routing with a broken unit portages his own SW (at most two PP, one MF less beyond his IPC) and the rout keeps to his MF.',
  requires: ['sk1.rout'],
  install(r) {
    r.contribute({
      id: 'asl.voluntaryRout.mf',
      query: 'rout.escortMf',
      ref: 'ASLRB A10.711, A4.42',
      apply(_v, { leader }, env) {
        const excess = Math.max(0, ppCarried(env, leader) - env.query('unit.ipc', { unit: leader }, 1));
        return env.query('rout.mf', { unit: leader }, 6) - excess;
      },
    });
    r.contribute({
      id: 'asl.voluntaryRout.portage',
      query: 'rout.escortIllegal',
      ref: 'ASLRB A10.711, A4.42',
      apply: (v, { leader }, env) => v ?? (ppCarried(env, leader) > 2 ? `${leader} carries more than two PP, more than a SMC may ever portage (ASLRB A4.42): he cannot rout with the unit (A10.711)` : null),
    });
  },
};
