import type { QueryEnv, RuleModule } from '@asl/engine';
import { defOf, statics } from '../common/pieces';
import { pieceOf } from './status';
import { isRoadHex, isWoodsRoad, terrainOf } from './terrain';

/*
 * Terrain that costs something else to enter by SSR (S28 SSR 2: "All Grain/Brush represent wetland hexes and are
 * treated as Grain hexes for Hindrance purposes and cost 1.5MF for infantry to enter and 2MP for vehicles to enter").
 * Entering along a road keeps the road rate.
 */

export const TERRAIN_COST_MODULE = 'terrain-cost';
export interface TerrainCostParams {
  /** Terrain ids (as played, after any SSR) the costs apply to. */
  terrains: string[];
  /** MF for Infantry to enter. */
  mf?: number;
  /** MP for a vehicle to enter. */
  vehicleMp?: number;
  /** The card's name for the rule, e.g. 'SSR 2'. */
  rule?: string;
}

const paramsOf = (env: QueryEnv): TerrainCostParams[] =>
  statics(env)
    .scenario.ssr.filter((s) => s.module === TERRAIN_COST_MODULE && s.params)
    .map((s) => s.params as unknown as TerrainCostParams);

const ruleFor = (env: QueryEnv, hex: string, key: 'mf' | 'vehicleMp') => {
  if (!statics(env).map.hex(hex)) return undefined;
  const t = terrainOf(env, hex).id;
  return paramsOf(env).find((p) => p[key] !== undefined && p.terrains.includes(t));
};

export const terrainCostModule: RuleModule = {
  id: 'ssr.terrain-cost',
  summary: 'Terrain types cost other MF/MP to enter (SSR).',
  requires: ['sk1.terrain'],
  install(r) {
    // Replaces the terrain's own rate, before the Crest Line doubling and the Smoke +1.
    r.contribute({
      id: 'ssr.terrain-cost.mf',
      query: 'move.cost',
      layer: 1,
      label: (c, env) => `${ruleFor(env, c.to, 'mf')!.mf} MF (${ruleFor(env, c.to, 'mf')!.rule ?? 'SSR'})`,
      when: ({ unit, to, viaRoad }, env) => defOf(env, pieceOf(env, unit)).kind !== 'vehicle' && !(viaRoad && (isRoadHex(env, to) || isWoodsRoad(env, to))) && !!ruleFor(env, to, 'mf'),
      apply: (_v, { to }, env) => ruleFor(env, to, 'mf')!.mf!,
    });
    r.contribute({
      id: 'ssr.terrain-cost.vehicle',
      query: 'vehicle.terrainMp',
      when: ({ hex }, env) => !!ruleFor(env, hex, 'vehicleMp'),
      apply: (_v, { hex }, env) => ruleFor(env, hex, 'vehicleMp')!.vehicleMp!,
    });
  },
};
