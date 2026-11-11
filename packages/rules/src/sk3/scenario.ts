import type { Piece, QueryEnv, RuleModule } from '@asl/engine';
import { byId, isVehicleDef, defOf, statics } from '../common/pieces';
import { exitVpCondition } from '../sk1/scenario';
import { T } from '../sk1/status';
import type { VictoryCondition } from '../common/statics';
import { T3, isImmobile, isRecalled, isWreck, vehicle } from './status';

/*
 * What the scenario cards say about vehicles: the AFV-count victory condition of S21 ("eliminate
 * more AFV than the enemy; each Russian AFV exited off the south edge counts as an eliminated
 * German AFV") and the Victory Points an AFV is worth (0 until the ASLRB vehicle CVP table is
 * adopted; Recall never earns any, SK4 7.10).
 */

/** A side's AFV that are wrecks or otherwise gone (eliminated), in id order. */
export function afvLost(env: QueryEnv, side: string): Piece[] {
  return Object.values(env.state.pieces)
    .filter((p) => p.side === side && isVehicleDef(defOf(env, p)) && (isWreck(p) || p.loc.kind === 'eliminated'))
    .sort(byId);
}

/** A side's AFV that have left the map by exiting (not under Recall), in id order. */
export function afvExited(env: QueryEnv, side: string): Piece[] {
  return Object.values(env.state.pieces)
    .filter((p) => p.side === side && vehicle(env, p) && p.loc.kind === 'offboard' && p.loc.edge === 'exited' && !isRecalled(p))
    .sort(byId);
}

/** The S21 tally: enemy AFV the side has eliminated, plus its own exited AFV when the card counts them. */
export function afvLeadTally(env: QueryEnv, vc: Extract<VictoryCondition, { kind: 'afvLead' }>): { eliminated: number; exited: number; lost: number } {
  const enemy = env.state.sides.find((s) => s !== vc.side)!;
  return {
    eliminated: afvLost(env, enemy).length,
    exited: vc.exitedCountAsEliminated ? afvExited(env, vc.side).length : 0,
    lost: afvLost(env, vc.side).length,
  };
}

/** A side's AFV on the map that are neither eliminated (wrecked) nor immobile (Immobilized or Bogged), in id order (S25). */
export function afvMobile(env: QueryEnv, side: string): Piece[] {
  return Object.values(env.state.pieces)
    .filter((p) => p.side === side && vehicle(env, p) && p.loc.kind === 'hex' && !isImmobile(p))
    .sort(byId);
}

export const vehicleScenarioModule: RuleModule = {
  id: 'sk3.scenario',
  ref: 'SK3 S21, SK4 7.10',
  summary: 'Vehicle victory conditions (AFV lead) and vehicle Victory Points.',
  requires: ['sk1.scenario', 'sk3.vehicles'],
  install(r) {
    r.contribute({
      id: 'sk3.vc.afvLead',
      query: 'vc.achieved',
      apply(v, { vc }, env) {
        if (v !== null || vc.kind !== 'afvLead') return v;
        const t = afvLeadTally(env, vc);
        return t.eliminated + t.exited > t.lost;
      },
    });
    r.contribute({
      id: 'sk3.vc.armed-mobile-afv',
      query: 'area.armedMobileAfv',
      apply: (_v, { side, hexes }, env) =>
        afvMobile(env, side).filter((p) => p.loc.kind === 'hex' && hexes.includes(p.loc.hex) && !!vehicle(env, p)?.ma && !p.tags[T.malf] && !p.tags[T3.maDisabled]).length,
    });
    r.contribute({
      id: 'sk3.vc.mobileAfv',
      query: 'vc.achieved',
      apply: (v, { vc }, env) => (v !== null || vc.kind !== 'mobileAfv' ? v : afvMobile(env, vc.side).length >= vc.atLeast),
    });
    // An exited AFV is worth what the card's exit VP condition says, by whether its MA still works (S23) or by its type (S28); never under Recall.
    r.contribute({
      id: 'sk3.vp.exit.afv',
      query: 'vp.exit',
      layer: 10,
      apply(v, { unit }, env) {
        const p = env.state.pieces[unit];
        const d = p && vehicle(env, p);
        if (!d) return v;
        const vc = exitVpCondition(statics(env).scenario, p.side);
        const working = !!d.ma && !p.tags[T.malf] && !p.tags[T3.maDisabled];
        const byDef = vc?.vehicleVp?.[p.defId];
        if (byDef !== undefined) return isRecalled(p) ? v : typeof byDef === 'number' ? byDef : working ? byDef.ma : byDef.noMa;
        if (!vc?.afvVp || isRecalled(p)) return v;
        return working ? vc.afvVp.ma : vc.afvVp.noMa;
      },
    });
    // No CVP or exit VP for an AFV yet (the def's `cvp`, 0 for every imported vehicle); none under Recall.
    r.contribute({
      id: 'sk3.vp.vehicle',
      query: 'vp.casualty',
      layer: 0,
      apply(v, { unit }, env) {
        const p = env.state.pieces[unit];
        const d = p && vehicle(env, p);
        if (!d) return v;
        return isRecalled(p) ? 0 : d.cvp;
      },
    });
  },
};
