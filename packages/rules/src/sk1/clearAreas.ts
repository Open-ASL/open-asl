import type { PieceId, QueryEnv, SideId } from '@asl/engine';
import { byId, otherSide, statics } from '../common/pieces';
import type { VictoryCondition } from '../common/statics';
import { casualties } from './scenario';
import { isBroken, isGoodOrder, mmc, smc } from './status';

/*
 * Victory by clearing areas and by losses (LMA7: "Le joueur français gagne s'il n'y a plus d'unité allemande good order
 * sur 3 des 4 collines de chaque carte tout en perdant moins de squad (ou équivalent) que l'allemand"): `clearAreas`
 * holds when at least `atLeast` of the named areas hold no Good Order enemy unit; `fewerLosses` when the side has lost
 * fewer squad equivalents than the enemy.
 */

export type ClearAreasVc = Extract<VictoryCondition, { kind: 'clearAreas' }>;

export interface ClearAreaState {
  label: string;
  hexes: string[];
  /** No Good Order enemy unit is in the area. */
  clear: boolean;
  /** The enemy units that hold it. */
  holders: PieceId[];
}

/** Each area of a `clearAreas` condition, whether it is clear and who holds it. */
export function clearAreasTally(env: QueryEnv, vc: ClearAreasVc): { areas: ClearAreaState[]; clear: number } {
  const map = statics(env).map;
  const enemy = otherSide(env.state, vc.side);
  const holders = Object.values(env.state.pieces)
    .filter((p) => p.side === enemy && p.loc.kind === 'hex' && !!(mmc(env, p) || (!vc.mmcOnly && smc(env, p))) && (vc.unbroken ? !isBroken(p) : isGoodOrder(env, p)))
    .sort(byId);
  const areas = vc.areas.map((a) => {
    const hexes = new Set(a.hexes.map((h) => map.hex(h)?.id ?? h));
    const here = holders.filter((p) => p.loc.kind === 'hex' && hexes.has(p.loc.hex)).map((p) => p.id);
    return { label: a.label, hexes: a.hexes, clear: here.length === 0, holders: here };
  });
  return { areas, clear: areas.filter((a) => a.clear).length };
}

/**
 * Squad equivalents a side has lost (ASLRB A1.5: a half-squad or crew is half a squad): each squad eliminated counts 1,
 * each half-squad or crew eliminated ½, and each squad Casualty Reduced to a half-squad ½ (the half-squad's own loss is
 * the other ½). Leaders and weapons are not counted.
 */
export function squadEquivalentsLost(env: QueryEnv, side: SideId): number {
  const counters = statics(env).counters;
  let out = 0;
  for (const c of casualties(env, side)) {
    const d = counters[c.defId];
    if (!d || (d.kind !== 'squad' && d.kind !== 'hs' && d.kind !== 'crew')) continue;
    out += c.kind === 'reduced' ? 0.5 : d.kind === 'squad' ? 1 : 0.5;
  }
  return out;
}
