import type { QueryEnv, RuleModule, SideId } from '@asl/engine';
import { statics } from '../common/pieces';
import { pieceOf } from '../sk1/status';
import { terrainOf } from '../sk1/terrain';
import { vehicle } from './status';

/*
 * Soggy ground by SSR (S30 SSR 1: "Due to the soggy ground, the Americans tanks may only use a maximum of half of their
 * printed MP per MPh. An AFV expending half of its printed MP when entering woods is considered to have expended "all"
 * for Bog purposes."): a side's vehicles get a fraction of their printed MP each MPh, and entering woods at half MP
 * takes no half-MP Bog DRM.
 */

export const MP_LIMIT_MODULE = 'mp-limit';
export interface MpLimitParams {
  side: SideId;
  /** The share of the printed MP a vehicle may use each MPh. */
  fraction: number;
  /** Entering woods at half MP counts as all MP for its Bog Check. */
  woodsHalfIsAll?: boolean;
  /** The card's name for the rule, e.g. 'SSR 1'. */
  rule?: string;
}

const paramsOf = (env: QueryEnv): MpLimitParams[] =>
  statics(env)
    .scenario.ssr.filter((s) => s.module === MP_LIMIT_MODULE && s.params)
    .map((s) => s.params as unknown as MpLimitParams);

/** The MP limit on a side's vehicles, if any. */
export const mpLimitFor = (env: QueryEnv, side: SideId): MpLimitParams | undefined => paramsOf(env).find((p) => p.side === side);

export const mpLimitModule: RuleModule = {
  id: 'ssr.mp-limit',
  ref: 'S30 SSR 1',
  summary: 'A side’s vehicles may use only part of their printed MP each MPh; entering woods at half MP is "all" for Bog (SSR).',
  requires: ['sk3.vehicleMove'],
  install(r) {
    r.contribute({
      id: 'ssr.mp-limit.mp',
      query: 'unit.mf',
      layer: 6,
      label: (c, env) => `${mpLimitFor(env, pieceOf(env, c.unit).side)!.fraction === 0.5 ? 'half' : `${mpLimitFor(env, pieceOf(env, c.unit).side)!.fraction} ×`} printed MP (${mpLimitFor(env, pieceOf(env, c.unit).side)!.rule ?? 'SSR'})`,
      when: ({ unit }, env) => !!vehicle(env, pieceOf(env, unit)) && !!mpLimitFor(env, pieceOf(env, unit).side),
      apply: (_v, { unit }, env) => vehicle(env, pieceOf(env, unit))!.mp * mpLimitFor(env, pieceOf(env, unit).side)!.fraction,
    });
    r.suppress({
      id: 'ssr.mp-limit.woods-bog',
      query: 'vehicle.bogDrm',
      target: 'sk3.bog.half-mp',
      label: 'half MP into woods counts as all (SSR)',
      when: ({ vehicle: id, hex }, env) => !!mpLimitFor(env, pieceOf(env, id).side)?.woodsHalfIsAll && terrainOf(env, hex).id === 'woods' && !statics(env).map.hex(hex)?.buildingId,
    });
  },
};
