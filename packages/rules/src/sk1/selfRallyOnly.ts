import type { RuleModule, SideId } from '@asl/engine';
import { defOf, statics } from '../common/pieces';
import { pieceOf } from './status';

export const SELF_RALLY_ONLY_MODULE = 'self-rally-only';

export interface SelfRallyOnlyParams {
  /** The side whose units the rule concerns; left out, both. */
  side?: SideId;
  /** Counter nationalities concerned, e.g. ['it']. */
  nationalities?: string[];
  /** Or counter defs concerned. */
  defs?: string[];
  /** The card's name for the rule, e.g. 'SSR 4'. */
  rule?: string;
}

/**
 * SSR "the Italian militia ... if broken, may only become Good Order upon a successful self-rally attempt" (LMA8 SSR 4):
 * no leader may rally the units concerned (`rally.byLeaderIllegal`), so a Good Order leader in their Location does not
 * stop their self-rally either (ASL A10.63's "he rallies the unit instead"). The self-rally itself is the ordinary one:
 * +1 DRM, and an MMC without a boxed broken morale only as the ATTACKER's one such attempt of the RPh (SK4 3.1e).
 */
export const selfRallyOnlyModule: RuleModule = {
  id: 'ssr.self-rally-only',
  summary: 'Units of listed nationalities or counters return to Good Order only by self-rally: no leader rallies them (SSR).',
  requires: ['sk1.rally'],
  install(r) {
    r.contribute({
      id: 'ssr.self-rally-only.no-leader',
      query: 'rally.byLeaderIllegal',
      layer: 10,
      label: 'self-rally only (SSR)',
      apply(v, { unit }, env) {
        if (v) return v;
        const p = pieceOf(env, unit);
        const nat = defOf(env, p).nationality;
        for (const s of statics(env).scenario.ssr) {
          if (s.module !== SELF_RALLY_ONLY_MODULE) continue;
          const q = (s.params ?? {}) as unknown as SelfRallyOnlyParams;
          if (q.side && q.side !== p.side) continue;
          if (q.nationalities?.includes(nat) || q.defs?.includes(p.defId)) return `Rallies only by self-rally (${q.rule ?? 'SSR'})`;
        }
        return v;
      },
    });
  },
};
