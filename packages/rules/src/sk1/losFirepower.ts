import type { HexId, Piece, PieceId, QueryEnv } from '@asl/engine';
import { hexOf, statics, swHeldBy } from '../common/pieces';
import type { VictoryCondition } from '../common/statics';
import { locOf } from '../common/location';
import { isCaptured, isGoodOrder, isMalf, isPinned, mmc, smc, sw } from './status';

/*
 * The FP a side could bring against a set of hexes (S22's victory conditions: Good Order units with a
 * LOS, disregarding Smoke, to any hex of the road, "provided that all those units can also apply a
 * total of ≥ 15 FP (including use of their non-captured SW, but disregarding ROF, B#, and all
 * PBF/TPBF extra FP) to hypothetical attacks vs. those same hex(es). A mortar counts for 4 FP, and a
 * bazooka at a range of ≤ 3 counts for 8 FP.")
 *
 * Each unit counts its best single attack on one of the hexes it sees: its inherent FP and the SW it
 * may use with it (SK1 4.0: a squad its own FP and one SW, or two SW and not its own; a half-squad or
 * crew one or the other; a SMC one SW), each halved at long range (beyond normal range, out to twice
 * it; none for a FT, a Mortar or a LATW) and halved if pinned. Malfunctioned and captured SW, and DC,
 * do not count. A Light Mortar counts `mortarFp` within its printed range, a LATW `latw.fp` within
 * `latw.maxRange`.
 */

export type LosFirepowerVc = VictoryCondition & { kind: 'losFirepower' };

export interface LosFirepowerUnit {
  unit: PieceId;
  /** The hex its best attack is against. */
  target: HexId;
  fp: number;
}

export interface LosFirepower {
  total: number;
  units: LosFirepowerUnit[];
}

/** FP a SW adds to an attack at `dist`, under the card's counting. */
function swFp(env: QueryEnv, vc: LosFirepowerVc, s: Piece, dist: number): number {
  const d = sw(env, s);
  if (!d || isMalf(s) || isCaptured(env, s) || d.type === 'DC') return 0;
  if (d.type === 'MTR') {
    const o = d.ordnance;
    return vc.mortarFp !== undefined && (!o || (dist >= (o.minRange ?? 0) && dist <= (o.maxRange ?? d.range))) ? vc.mortarFp : 0;
  }
  if (d.latw) return vc.latw && dist <= vc.latw.maxRange ? vc.latw.fp : 0;
  if (d.type === 'FT') return dist <= d.range ? d.fp : 0;
  return (dist <= d.range ? d.fp : dist <= d.range * 2 && !vc.noAreaFire ? d.fp / 2 : 0) * pointBlank(vc, dist);
}

/** The card's Point Blank multiplier for Infantry, MG and ATR FP at `dist` (S31), else 1. */
function pointBlank(vc: LosFirepowerVc, dist: number): number {
  if (dist === 0 && vc.tpbf) return 3;
  if (dist === 1 && vc.pbf) return 2;
  return 1;
}

/** A unit's best attack on one hex: its own FP and the SW combination its kind may use. */
function unitFp(env: QueryEnv, vc: LosFirepowerVc, p: Piece, dist: number): number {
  const m = mmc(env, p);
  const own = m ? (dist <= m.range ? m.fp : dist <= m.range * 2 && !vc.noAreaFire ? m.fp / 2 : 0) * pointBlank(vc, dist) : 0;
  const weapons = swHeldBy(env.state, p.id)
    .map((s) => swFp(env, vc, s, dist))
    .sort((a, b) => b - a);
  const [w1 = 0, w2 = 0] = weapons;
  const best = m?.kind === 'squad' ? Math.max(own + w1, w1 + w2) : m ? Math.max(own, w1) : smc(env, p) ? w1 : 0;
  if (!isPinned(p)) return best;
  return vc.noAreaFire ? 0 : best / 2;
}

/** The side's Good Order units that see any of the hexes, each with its best attack, and the total. */
export function losFirepower(env: QueryEnv, vc: LosFirepowerVc): LosFirepower {
  const map = statics(env).map;
  const targets = [...new Set(vc.hexes.map((h) => map.hex(h)?.id).filter((h): h is HexId => !!h))].sort();
  const units: LosFirepowerUnit[] = [];
  const mine = Object.values(env.state.pieces)
    .filter((p) => p.side === vc.side && p.loc.kind === 'hex' && (mmc(env, p) || smc(env, p)) && isGoodOrder(env, p))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const p of mine) {
    const at = hexOf(env.state, p)!;
    // LOS from the unit's Location (its height in full ASL).
    const from = locOf(env.state, p)!;
    let best: LosFirepowerUnit | null = null;
    for (const t of targets) {
      const seen = from === t || env.query('los.trace', { from, to: t, ...(vc.noSmoke ? { noSmoke: true } : {}) }, { clear: true, hindrance: 0, parts: [] }).clear;
      if (!seen) continue;
      const fp = unitFp(env, vc, p, map.distance(at, t));
      if (!best || fp > best.fp) best = { unit: p.id, target: t, fp };
    }
    if (best) units.push(best);
  }
  return { total: units.reduce((a, u) => a + u.fp, 0), units };
}
