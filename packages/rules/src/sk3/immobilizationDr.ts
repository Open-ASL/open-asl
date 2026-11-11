import type { Ctx, HexId, PieceId, QueryEnv, RuleModule } from '@asl/engine';
import { statics } from '../common/pieces';
import { MOVE_ENTERED, type MoveEnteredFn } from '../sk1/movement';
import { pieceOf } from '../sk1/status';
import { terrainOf } from '../sk1/terrain';
import { levelOf } from '../sk2/elevation';
import { isImmobile, vehicle } from './status';
import { applyVehicleEffect } from './vehicleStatus';

/*
 * Ground that may immobilize an AFV by SSR (S28 SSR 1: "AFV must make a DR for each non-Hill Open Ground, Brush, or
 * Grain hex entered. On a DR ≥ 11 that vehicle is immobilized in that hex."). A hex entered along a road is the road,
 * not the wet ground beside it, and takes no DR (the card's history: the drainage ditches and marshy farmland hindered
 * movement "when vehicles strayed from the road").
 */

export const IMMOBILIZATION_DR_MODULE = 'immobilization-dr';
export interface ImmobilizationDrParams {
  /** Terrain ids (as played, after any SSR) whose hexes call for the DR. */
  terrains: string[];
  /** Hill hexes (level ≥ 1) are exempt. */
  notHill?: boolean;
  /** The DR that immobilizes, or more. */
  atLeast: number;
  /** The card's name for the rule, e.g. 'SSR 1'. */
  rule?: string;
}

const paramsOf = (env: QueryEnv): ImmobilizationDrParams[] =>
  statics(env)
    .scenario.ssr.filter((s) => s.module === IMMOBILIZATION_DR_MODULE && s.params)
    .map((s) => s.params as unknown as ImmobilizationDrParams);

/** The rule calling for an immobilization DR when a vehicle enters `hex` other than along a road, if any. */
export function immobilizationRule(env: QueryEnv, hex: HexId): ImmobilizationDrParams | undefined {
  const t = terrainOf(env, hex).id;
  return paramsOf(env).find((p) => p.terrains.includes(t) && !(p.notHill && levelOf(env, hex) > 0));
}

export const immobilizationDrModule: RuleModule = {
  id: 'ssr.immobilization-dr',
  ref: 'S28 SSR 1',
  summary: 'An AFV entering listed terrain off a road makes a DR and is Immobilized on a high result (SSR).',
  requires: ['sk1.movement', 'sk3.vehicleMove', 'sk3.vehicleStatus'],
  install(r) {
    r.event<{ vehicle: PieceId; hex: HexId; dr: [number, number]; atLeast: number; immobilized: boolean; rule?: string }>({ type: 'ssr.immobilization.dr', apply() {} });
    r.procedure<MoveEnteredFn>(MOVE_ENTERED, (next) => (ctx: Ctx, ms) => {
      next?.(ctx, ms);
      if (!ms.vehicle || !ms.hex || ms.viaRoad) return;
      const p = pieceOf(ctx, ms.units[0]!);
      if (!vehicle(ctx, p) || isImmobile(p) || p.loc.kind !== 'hex' || p.loc.hex !== ms.hex) return;
      const rule = immobilizationRule(ctx, ms.hex);
      if (!rule) return;
      const roll = ctx.roll(`Immobilization DR for ${p.id} in ${ms.hex} (${rule.rule ?? 'SSR'}: ≥ ${rule.atLeast} immobilizes)`);
      const immobilized = roll.total >= rule.atLeast;
      ctx.emit('ssr.immobilization.dr', { vehicle: p.id, hex: ms.hex, dr: roll.dice as [number, number], atLeast: rule.atLeast, immobilized, ...(rule.rule ? { rule: rule.rule } : {}) });
      if (immobilized) applyVehicleEffect(ctx, p.id, 'immobilized', rule.rule ?? 'SSR');
    });
  },
};
