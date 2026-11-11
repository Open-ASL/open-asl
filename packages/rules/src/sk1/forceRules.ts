import type { Piece, PieceId, QueryEnv, RuleModule, SideId } from '@asl/engine';
import { otherSide, personnelAt, statics } from '../common/pieces';
import type { UnitQuality } from '../common/statics';
import { mmc, pieceOf, smc } from './status';

/*
 * Special rules that single out the units of some of a side's forces (S27: the New Zealanders but not
 * the 3rd Hussars, the Gebirgsjäger but not Kampfgruppe Ramcke). A unit belongs to the force it was
 * created with (its `force` tag), whatever it has become since.
 */

/** The scenario force a unit was created with. */
export const forceOf = (env: QueryEnv, p: Piece): string | undefined => statics(env).scenario.forces[p.tags['force'] as number]?.id;

const paramsOf = <P>(env: QueryEnv, module: string): P[] =>
  statics(env)
    .scenario.ssr.filter((s) => s.module === module && s.params)
    .map((s) => s.params as unknown as P);

export const AMBUSH_DRM_MODULE = 'ambush-drm';
export interface AmbushDrmParams {
  /** Forces whose MMC and SMC take the drm. */
  forces?: string[];
  /** Or: a side's MMC of these qualities (S18 SSR 2: "Russian elite and 1st-Line units": ['E', '1']; crews are Elite). */
  side?: SideId;
  qualities?: UnitQuality[];
  /** Counters left out though of those qualities (S35: the 6-2-8/3-2-8 are 2nd-Line units by SSR). */
  exceptDefs?: string[];
  drm: number;
  /** The card's name for the rule, e.g. 'SSR 1'. */
  rule?: string;
}

const ambushDrmFor = (env: QueryEnv, q: AmbushDrmParams, p: Piece): boolean => {
  if (q.forces) return (!!mmc(env, p) || !!smc(env, p)) && q.forces.includes(forceOf(env, p) ?? '');
  const m = mmc(env, p);
  return p.side === q.side && !!m && !!q.qualities?.includes(m.quality) && !q.exceptDefs?.includes(p.defId);
};

/**
 * S27 SSR 1: "The New Zealand MMC and SMC receive a -1 drm on any Ambush die rolls." S18 SSR 2: "Russian elite and
 * 1st-Line units receive a -1 drm to their Ambush dr." Once per side, if any of its units in the CC qualifies (SK4 3.8).
 */
export const ambushDrmModule: RuleModule = {
  id: 'ssr.ambush-drm',
  summary: 'Ambush drm for the MMC and SMC of listed forces, or a side\'s MMC of listed qualities (SSR).',
  requires: ['sk1.cc'],
  install(r) {
    r.contribute({
      id: 'ssr.ambush-drm.apply',
      query: 'cc.ambushDrm',
      layer: 10,
      label: 'SSR Ambush drm',
      apply(v, { units }, env) {
        let out = v;
        for (const q of paramsOf<AmbushDrmParams>(env, AMBUSH_DRM_MODULE)) {
          const theirs = units.map((u) => pieceOf(env, u)).some((p) => ambushDrmFor(env, q, p));
          if (theirs) out += q.drm;
        }
        return out;
      },
    });
  },
};

export const TARGET_DRM_MODULE = 'target-drm';
export interface TargetDrmParams {
  /** Forces whose units, when attacked, add the DRM. */
  forces: string[];
  /** Game Turns it applies on. */
  turns: number[];
  drm: number;
  rule?: string;
}

const targetDrmFor = (env: QueryEnv, unit: Piece): number =>
  paramsOf<TargetDrmParams>(env, TARGET_DRM_MODULE)
    .filter((q) => q.turns.includes(env.state.turn) && q.forces.includes(forceOf(env, unit) ?? ''))
    .reduce((n, q) => n + q.drm, 0);

/**
 * S27 SSR 4: "During Turn 1 and Turn 2, a +1 DRM must be added to all fire attacks (To Hit for
 * ordnance, IFT otherwise) made against the German Gebirgsjäger troops. This DRM does not negate FFMO,
 * does not reduce the amount of residual firepower, and does not affect residual firepower attacks."
 * On the IFT it is a DRM against each such unit attacked (not ordnance's IFT effect roll, nor Residual
 * FP); on the To Hit DR it applies when the target hex holds such a unit.
 */
export const targetDrmModule: RuleModule = {
  id: 'ssr.target-drm',
  summary: 'A DRM on fire attacks against the units of listed forces on listed turns (SSR).',
  requires: ['sk1.fire'],
  install(r) {
    r.contribute({
      id: 'ssr.target-drm.ift',
      query: 'fire.unitDrm',
      layer: 10,
      label: (_c, env) => `SSR +DRM vs these troops (Turn ${env.state.turn})`,
      apply(v, { attack, unit }, env) {
        if (attack.residual || attack.parts.some((p) => p.kind === 'ordnance')) return v;
        const p = env.state.pieces[unit];
        return p ? v + targetDrmFor(env, p) : v;
      },
    });
  },
};

/** The To Hit DRM a shot at `hex` by `side` takes under the target-drm rule (the most any unit there gives). */
export function targetThDrm(env: QueryEnv, side: SideId, hex: string): number {
  if (!paramsOf<TargetDrmParams>(env, TARGET_DRM_MODULE).length) return 0;
  return Math.max(0, ...personnelAt(env, hex, otherSide(env.state, side)).map((p) => targetDrmFor(env, p)));
}

export const CAPTURED_USE_EXEMPT_MODULE = 'captured-use-exempt';
export interface CapturedUseExemptParams {
  side: SideId;
  /** The captured weapons concerned, e.g. ['it.AR75s_n9']. */
  defs: string[];
  /** Only crews (of the side) fire them without the penalties. */
  crewsOnly?: boolean;
  rule?: string;
}

/** Whether a captured weapon fired by `firer` is exempt from Captured Use penalties (S27 SSR 3). */
export function capturedUseExempt(env: QueryEnv, weapon: PieceId, firer: PieceId | undefined): boolean {
  const g = env.state.pieces[weapon];
  const f = firer ? env.state.pieces[firer] : undefined;
  if (!g) return false;
  return paramsOf<CapturedUseExemptParams>(env, CAPTURED_USE_EXEMPT_MODULE).some(
    (q) => q.side === g.side && q.defs.includes(g.defId) && (!q.crewsOnly || (!!f && mmc(env, f)?.kind === 'crew')),
  );
}

/** S27 SSR 3: "New Zealand crews do not pay Captured Use penalties when firing the Italian 75/27 ART." */
export const capturedUseExemptModule: RuleModule = {
  id: 'ssr.captured-use-exempt',
  summary: 'Listed captured weapons fired without Captured Use penalties (SSR).',
  requires: ['sk1.fire'],
  install() {},
};
