import type { QueryEnv, RuleModule } from '@asl/engine';
import { statics } from '../common/pieces';
import type { FireAttackCtx } from './fire';

/*
 * A Hindrance by range alone, by SSR (LMA5 SSR 3: "As it is still snowing, fire at more than 6 hexes has a +1
 * hindrance; at more than 12 hexes +2; at more than 18 hexes +3"). It is the snow of ASL's Falling Snow, which brings
 * Mist (E3.711), a Low Visibility Hindrance (E3.1): "treated exactly like a LOS Hindrance except that a LV Hindrance
 * DRM is cumulative with other Hindrances regardless of range and does not by itself negate the FFMO DRM or
 * Interdiction, or affect the placement of (or attack by) Residual FP". So: added to every IFT attack (the farthest
 * firer of a Fire Group sets it, as the worst Hindrance of a Fire Group does) and to every To Hit DR, never to a Residual
 * FP attack nor to an ordnance hit's effects roll, and FFMO stands unless `negatesFfmo` (an SK reading of "hindrance",
 * SK1 3.3.1) is set. The DRM of the highest band reached applies, not their sum.
 */

export const RANGE_HINDRANCE_MODULE = 'range-hindrance';
export interface RangeHindranceParams {
  /** `drm` applies at a range of more than `over` hexes; the highest band reached applies. */
  bands: { over: number; drm: number }[];
  /** What hinders, for the attack's explanation ("falling snow"). */
  label: string;
  /** The card's name for the rule, e.g. 'SSR 3'. */
  rule?: string;
  /** A LOS Hindrance after SK1 3.3.1 that negates FFMO, rather than a full ASL LV Hindrance that does not. */
  negatesFfmo?: boolean;
}

const paramsOf = (env: QueryEnv): RangeHindranceParams[] =>
  statics(env)
    .scenario.ssr.filter((s) => s.module === RANGE_HINDRANCE_MODULE && s.params)
    .map((s) => s.params as unknown as RangeHindranceParams);

/** The DRM one rule gives at a range. */
const bandDrm = (q: RangeHindranceParams, range: number) =>
  Math.max(0, ...q.bands.filter((b) => range > b.over).map((b) => b.drm));
/** The range-hindrance DRM at `range`, every such rule together, and what to call it. */
export function rangeHindrance(
  env: QueryEnv,
  range: number | null,
  ffmoOnly = false,
): { drm: number; label: string } {
  if (range === null) return { drm: 0, label: '' };
  const rules = paramsOf(env).filter((q) => (!ffmoOnly || q.negatesFfmo) && bandDrm(q, range) > 0);
  return {
    drm: rules.reduce((a, q) => a + bandDrm(q, range), 0),
    label: rules
      .map(
        (q) =>
          `+${bandDrm(q, range)} ${q.label} beyond ${Math.max(...q.bands.filter((b) => range > b.over).map((b) => b.over))} hexes (${q.rule ?? 'SSR'})`,
      )
      .join(', '),
  };
}
/** An IFT attack's range for a Hindrance: its farthest firer's (null for Residual FP, which has none). */
const attackRange = (attack: FireAttackCtx) =>
  attack.residual || !attack.parts.length ? null : Math.max(...attack.parts.map((p) => p.dist));

export const rangeHindranceModule: RuleModule = {
  id: 'ssr.range-hindrance',
  ref: 'ASLRB E3.1',
  summary:
    'A Hindrance DRM by range alone (SSR snow): every IFT attack and To Hit DR beyond so many hexes.',
  requires: ['sk1.fire'],
  install(r) {
    r.contribute({
      id: 'ssr.range-hindrance.ift',
      query: 'fire.drm',
      label: ({ attack }, env) => rangeHindrance(env, attackRange(attack)).label,
      // An ordnance hit's effects roll is part of the shot that already took the DRM To Hit.
      when: ({ attack }, env) =>
        !attack.ordnance && rangeHindrance(env, attackRange(attack)).drm > 0,
      apply: (v, { attack }, env) => v + rangeHindrance(env, attackRange(attack)).drm,
    });
    r.contribute({
      id: 'ssr.range-hindrance.th',
      query: 'ordnance.thDrm',
      label: (sc, env) => rangeHindrance(env, sc.range).label,
      when: (sc, env) => rangeHindrance(env, sc.range).drm > 0,
      apply: (v, sc, env) => v + rangeHindrance(env, sc.range).drm,
    });
    // Only where the card's hindrance is read as a LOS Hindrance (SK1 3.3.1) does it negate FFMO.
    r.suppress({
      id: 'ssr.range-hindrance.no-ffmo',
      query: 'fire.drm',
      target: 'sk1.drm.ffmo',
      label: 'range hindrance (SSR)',
      when: ({ attack }, env) => rangeHindrance(env, attackRange(attack), true).drm > 0,
    });
    r.suppress({
      id: 'ssr.range-hindrance.no-ffmo-th',
      query: 'ordnance.thDrm',
      target: 'sk2.th.ffmo',
      label: 'range hindrance (SSR)',
      when: (sc, env) => rangeHindrance(env, sc.range, true).drm > 0,
    });
  },
};
