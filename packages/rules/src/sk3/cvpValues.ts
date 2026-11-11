import type { RuleModule } from '@asl/engine';
import { statics } from '../common/pieces';

/*
 * Casualty VP a card sets for particular counters (S70 SSR 3: "M4A3 is worth 6 VP"). The default values stand for every
 * other unit (squad 2, HS 1, leader 1 plus 1 per point of negative leadership; an AFV 0 until the ASLRB table is adopted);
 * the card's values replace them for the counters it names, while the unit is not under Recall.
 */

export const CVP_VALUES_MODULE = 'cvp-values';

export interface CvpValuesParams {
  /** Counter id → its Casualty VP. */
  defs: Record<string, number>;
  /** The card's name for the rule, e.g. 'SSR 3'. */
  rule?: string;
}

export const cvpValuesModule: RuleModule = {
  id: 'ssr.cvp-values',
  ref: 'S70 SSR 3',
  summary: 'Casualty VP a card sets for particular counters (an AFV worth 6 VP).',
  requires: ['sk1.scenario'],
  install(r) {
    r.contribute({
      id: 'ssr.cvp-values',
      query: 'vp.casualty',
      ref: 'S70 SSR 3',
      layer: 500,
      apply(v, { unit }, env) {
        const p = env.state.pieces[unit];
        const q = statics(env).scenario.ssr.find((s) => s.module === CVP_VALUES_MODULE && s.params)?.params as CvpValuesParams | undefined;
        const vp = p && q?.defs[p.defId];
        if (!p || vp === undefined || p.tags['recall'] === true) return v;
        return vp;
      },
    });
  },
};
