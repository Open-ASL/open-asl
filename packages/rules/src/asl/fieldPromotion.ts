import type { QueryEnv, RuleModule } from '@asl/engine';
import { T, mmc } from '../sk1/status';

/** Whether the ATTACKER has yet made a MMC Rally attempt this RPh, by self-rally or with a leader (`rallyTried`). */
const attackerMmcRallied = (env: QueryEnv): boolean =>
  Object.values(env.state.pieces).some((p) => p.side === env.state.attacker && p.tags[T.rallyTried] && !!mmc(env, p));

/**
 * ASLRB A18.11: "The first MMC Rally attempt of a player's own RPh may be performed as Self-Rally regardless of
 * Self-Rally capability"; if that attempt rolls an Original 2, "the ATTACKER may roll on the Leader Creation Table".
 *
 * The SK text (SK1/SK4 5.3) only says "the first self-rally attempt of a RPh", naming neither side, so in SK each
 * side's first self-rally attempt may promote and a leader's own self-rally uses it up (`sk1/rally.ts`). Full ASL:
 * - only the ATTACKER promotes, and only on his first MMC Rally attempt of the RPh: a leader rallying a MMC uses it
 *   up, a leader's own self-rally does not (it is not a MMC Rally attempt);
 * - the self-rally of a MMC without self-rally capability is allowed only as that first MMC Rally attempt. SK1 3.1e
 *   lets the ATTACKER self-rally one such MMC with no such condition (its sequence merely puts self-rallies before
 *   leader rallies), so this is ASL-only.
 */
export const aslFieldPromotionModule: RuleModule = {
  id: 'asl.fieldPromotion',
  ref: 'ASLRB A18.11',
  summary: 'Field Promotion and the free MMC self-rally: the ATTACKER\'s first MMC Rally attempt of the RPh only.',
  requires: ['sk1.rally'],
  install(r) {
    r.contribute({
      id: 'asl.fieldPromotion.first',
      query: 'rally.promotes',
      ref: 'ASLRB A18.11',
      apply: (_v, { unit }, env) => env.state.pieces[unit]?.side === env.state.attacker && !attackerMmcRallied(env),
    });
    r.contribute({
      id: 'asl.fieldPromotion.freeSelfRally',
      query: 'rally.mmcSelfRallyIllegal',
      ref: 'ASLRB A18.11',
      when: (_c, env) => attackerMmcRallied(env),
      apply: (v) => v ?? 'A MMC without self-rally capability may self-rally only as the first MMC Rally attempt of the RPh (A18.11)',
    });
  },
};
