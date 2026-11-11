import type { RuleModule } from '@asl/engine';
import { mmc, pieceOf } from '../sk1/status';

/**
 * ASLRB A18.2: when more than one type of MMC made the CC attack that created a leader, "the MMC with the highest
 * BPV involved is used to determine any Leader Creation drm". The SK text (SK1/SK4 5.3) says "use the best one", which
 * the SK rules read as the best Morale (`promotionBase` in `sk1/closeCombat.ts`), so this is ASL-only.
 *
 * A unit with no BPV on its counter def (none in the National Capabilities Chart) never outranks one with a BPV; when
 * no unit has one, or several share the highest, the SK choice stands among them (best Morale, then the first).
 */
export const aslLeaderCreationModule: RuleModule = {
  id: 'asl.leaderCreation',
  ref: 'ASLRB A18.2',
  summary: 'Leader Creation in CC is based on the attacking MMC with the highest BPV.',
  requires: ['sk1.cc'],
  install(r) {
    r.contribute({
      id: 'asl.leaderCreation.highestBpv',
      query: 'cc.promotionBase',
      ref: 'ASLRB A18.2',
      apply: (v, { units }, env) => {
        const bpv = (id: string) => mmc(env, pieceOf(env, id))?.bpv ?? -1;
        const top = Math.max(...units.map(bpv));
        if (top < 0 || (v && bpv(v) === top)) return v;
        const tied = units.filter((id) => bpv(id) === top);
        return [...tied].sort((a, b) => mmc(env, pieceOf(env, b))!.morale - mmc(env, pieceOf(env, a))!.morale)[0] ?? v;
      },
    });
  },
};
