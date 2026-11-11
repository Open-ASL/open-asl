import type { QueryEnv, RuleModule } from '@asl/engine';
import type { FireAttackCtx } from '../sk1/fire';
import { statics } from '../common/pieces';

/*
 * A DRM to every IFT and To Hit attack by SSR (S28 SSR 4: "Due to the pre-dawn darkness, all IFT/TH shots receive a +1
 * DRM which does not cancel FFMO or Interdiction"). Each shot takes it once: an ordnance shot on its To Hit DR, every
 * other attack on its IFT DR. It is no LOS Hindrance, so FFMO (judged on the Hindrance alone) still applies.
 * S34 SSR 1 limits it to long shots ("+1 DRM to all IFT/TH rolls at a range of ≥ 7 hexes ... It does not affect Residual
 * FP"): `minRange`, judged by the nearest firer of the attack, and `notResidual`.
 */

export const ATTACK_DRM_MODULE = 'attack-drm';
export interface AttackDrmParams {
  drm: number;
  /** What the DRM is for, in the attack's explanation ("pre-dawn darkness"). */
  label: string;
  /** The card's name for the rule, e.g. 'SSR 4'. */
  rule?: string;
  /** Only at this range or more. */
  minRange?: number;
  /** Not on a Residual FP attack. */
  notResidual?: boolean;
}

const paramsOf = (env: QueryEnv): AttackDrmParams[] =>
  statics(env)
    .scenario.ssr.filter((s) => s.module === ATTACK_DRM_MODULE && s.params)
    .map((s) => s.params as unknown as AttackDrmParams);

/** The rules that apply to an attack at `range` (null: range unknown), a Residual FP attack or not. */
const applying = (env: QueryEnv, range: number | null, residual: boolean) =>
  paramsOf(env).filter((p) => !(residual && p.notResidual) && (p.minRange === undefined || (range !== null && range >= p.minRange)));
const total = (rules: AttackDrmParams[]) => rules.reduce((a, p) => a + p.drm, 0);
const label = (rules: AttackDrmParams[]) => rules.map((p) => `${p.drm > 0 ? '+' : ''}${p.drm} ${p.label} (${p.rule ?? 'SSR'})`).join(', ');
/** An IFT attack's range: its nearest firer's. */
const iftRange = (attack: FireAttackCtx) => (attack.parts.length ? Math.min(...attack.parts.map((p) => p.dist)) : null);
const iftRules = (attack: FireAttackCtx, env: QueryEnv) => applying(env, iftRange(attack), !!attack.residual);

export const attackDrmModule: RuleModule = {
  id: 'ssr.attack-drm',
  summary: 'A DRM to every IFT and To Hit attack (SSR).',
  requires: ['sk1.fire', 'sk2.ordnance'],
  install(r) {
    r.contribute({
      id: 'ssr.attack-drm.ift',
      query: 'fire.drm',
      label: ({ attack }, env) => label(iftRules(attack, env)),
      // An ordnance hit's effects roll is part of the shot that already took the DRM To Hit.
      when: ({ attack }, env) => !attack.ordnance && total(iftRules(attack, env)) !== 0,
      apply: (v, { attack }, env) => v + total(iftRules(attack, env)),
    });
    r.contribute({
      id: 'ssr.attack-drm.th',
      query: 'ordnance.thDrm',
      label: (sc, env) => label(applying(env, sc.range, false)),
      when: (sc, env) => total(applying(env, sc.range, false)) !== 0,
      apply: (v, sc, env) => v + total(applying(env, sc.range, false)),
    });
  },
};
