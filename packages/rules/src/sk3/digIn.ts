import type { Ctx, Piece, PieceId, QueryEnv, RuleModule, SideId } from '@asl/engine';
import { statics, swHeldBy } from '../common/pieces';
import { SETUP_PLACED, type SetupPlacedFn } from '../sk1/scenario';
import { setTags } from '../sk1/status';
import { pieceOf } from '../sk1/status';
import { OP, type ResolveHitFn } from '../sk2/ordnance';
import { hitLocation } from './facing';
import { T3, vehicle } from './status';

/*
 * Dug-in AFV by SSR (S28 SSR 3: "The Russian player may elect to dig-in any of his AFV. Doing so means the vehicle may
 * never move from the setup hex or change its VCA. There is a +1 TH DRM for all attacks against a dug-in AFV, and any
 * hull hit is treated as a miss."). The choice is made at setup (the vehicle's `dugIn`); the vehicle movement rules keep
 * a dug-in vehicle from starting or attempting Motion. The +1 and the hull-hit miss apply to To Hit shots at the AFV
 * itself (Vehicle Target Type).
 */

export const DIG_IN_MODULE = 'dig-in';
export interface DigInParams {
  side: SideId;
  /** To Hit DRM for a shot at a dug-in AFV. */
  thDrm: number;
  /**
   * Counters that are always dug in (S35 SSR 3: "The T-34 M41 is a dug-in AFV ... It may setup only in road, open ground
   * or shellhole hexes. It leaves no wreck if eliminated, provides no TEM, and does not affect LOS. Place a "BMG Disabled"
   * marker on the dug-in AFV at start."): with `noWreck` (it is removed instead), `notTerrain` (no cover, no Hindrance)
   * and `bmgDisabled`. Where it may set up is the force's `onTerrain` setup constraint.
   */
  defs?: string[];
  noWreck?: boolean;
  notTerrain?: boolean;
  bmgDisabled?: boolean;
  /** The card's name for the rule, e.g. 'SSR 3'. */
  rule?: string;
}

const paramsOf = (env: QueryEnv): DigInParams[] =>
  statics(env)
    .scenario.ssr.filter((s) => s.module === DIG_IN_MODULE && s.params)
    .map((s) => s.params as unknown as DigInParams);

/** The rule letting a side dig in its AFV, if any. */
export const digInParams = (env: QueryEnv, side: SideId): DigInParams | undefined => paramsOf(env).find((p) => p.side === side);

/** Whether a piece is a dug-in vehicle. */
export const isDugIn = (env: QueryEnv, id: PieceId | undefined): boolean => {
  const p = id ? env.state.pieces[id] : undefined;
  return !!p && p.tags[T3.dugIn] === true && !!vehicle(env, p);
};

export const digInModule: RuleModule = {
  id: 'ssr.dig-in',
  ref: 'S28 SSR 3',
  summary: 'A side may dig in its AFV at setup: they never move or change VCA, +1 To Hit against them, and a hull hit misses (SSR).',
  requires: ['sk3.vehicles', 'sk2.ordnance', 'sk3.toKill'],
  install(r) {
    r.contribute({
      id: 'ssr.dig-in.allowed',
      query: 'vehicle.digIn',
      // A side that may elect to dig in its AFV (S28); not where the card names the counters that are (S35).
      apply: (v, { vehicle: id }, env) => {
        const q = digInParams(env, pieceOf(env, id).side);
        return q && !q.defs ? null : v;
      },
    });
    // Counters dug in by the card: where they may set up, then dug in, their BMG disabled.
    const forcedRule = (env: QueryEnv, p: Piece) => paramsOf(env).find((q) => q.side === p.side && q.defs?.includes(p.defId));
    r.procedure<SetupPlacedFn>(SETUP_PLACED, (next) => (ctx, action, decision) => {
      next?.(ctx, action, decision);
      for (const id of Object.keys(action.placements).sort()) {
        const p = ctx.state.pieces[id];
        const q = p && forcedRule(ctx, p);
        if (!p || !q || !vehicle(ctx, p)) continue;
        setTags(ctx, id, { [T3.dugIn]: true });
        if (q.bmgDisabled) for (const w of swHeldBy(ctx.state, id)) if (w.defId.endsWith('.bmg')) setTags(ctx, w.id, { [T3.mgDisabled]: true });
      }
    });
    r.contribute({
      id: 'ssr.dig-in.not-terrain',
      query: 'vehicle.isTerrain',
      when: ({ vehicle: id }, env) => isDugIn(env, id) && !!digInParams(env, pieceOf(env, id).side)?.notTerrain,
      apply: () => false,
    });
    // No wreck: the eliminated dug-in AFV is removed.
    r.on<{ vehicle: PieceId }>({
      id: 'ssr.dig-in.no-wreck',
      event: 'sk3.vehicle.wrecked',
      handler(ctx, ev) {
        const p = ctx.state.pieces[ev.payload.vehicle];
        if (!p || !isDugIn(ctx, p.id) || !digInParams(ctx, p.side)?.noWreck) return;
        for (const w of swHeldBy(ctx.state, p.id)) ctx.emit('piece.eliminated', { id: w.id, reason: 'no wreck (SSR)' });
        ctx.emit('piece.eliminated', { id: p.id, reason: 'no wreck (SSR)' });
      },
    });
    r.contribute({
      id: 'ssr.dig-in.th',
      query: 'ordnance.thDrm',
      label: (sc, env) => `+${digInParams(env, pieceOf(env, sc.targetVehicle!).side)!.thDrm} dug-in AFV (${digInParams(env, pieceOf(env, sc.targetVehicle!).side)!.rule ?? 'SSR'})`,
      when: (sc, env) => sc.shot.targetType === 'VTT' && isDugIn(env, sc.targetVehicle),
      apply: (v, sc, env) => v + digInParams(env, pieceOf(env, sc.targetVehicle!).side)!.thDrm,
    });
    r.event<{ weapon: PieceId; target: PieceId; dice: [number, number]; rule?: string }>({ type: 'ssr.dig-in.hullHit', apply() {} });
    // A hit on the hull of a dug-in AFV is a miss: no To Kill roll, no Collateral Attack, no Residual FP.
    r.procedure<ResolveHitFn>(OP.resolveHit, (next) => (ctx: Ctx, sc, hit, targets, results) => {
      if (sc.shot.targetType === 'VTT' && hit.hit && isDugIn(ctx, sc.targetVehicle) && hitLocation(hit.dice[0], hit.dice[1]) === 'hull') {
        const rule = digInParams(ctx, pieceOf(ctx, sc.targetVehicle!).side)?.rule;
        ctx.emit('ssr.dig-in.hullHit', { weapon: sc.weapon, target: sc.targetVehicle!, dice: hit.dice, ...(rule ? { rule } : {}) });
        return [];
      }
      return next!(ctx, sc, hit, targets, results);
    });
  },
};
