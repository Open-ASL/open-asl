import type { HexId, PieceId, QueryEnv } from '@asl/engine';
import { hexOf, statics } from '../common/pieces';
import type { VictoryCondition } from '../common/statics';
import { isGoodOrder, mmc, smc } from './status';

/*
 * Victory points of Good Order Infantry standing in an area (S17's victory conditions: "The British win at
 * game end if they have ≥ 9 VP of Good Order infantry on/east-of hexrow xK. Each squad and crew is worth 2
 * VP, each HS is worth 1 VP, and each leader is worth 1 VP plus 1 VP for each minus modifier (i.e., a 9-2
 * leader is worth 3 VP).") A leader is valued by its counter's printed modifier.
 */

export type AreaVpVc = VictoryCondition & { kind: 'goodOrderVp' };

export interface AreaVpUnit {
  unit: PieceId;
  hex: HexId;
  vp: number;
}

export interface AreaVp {
  total: number;
  units: AreaVpUnit[];
}

/** The side's Good Order Infantry in the area, each with its worth, and the total. */
export function areaVp(env: QueryEnv, vc: AreaVpVc): AreaVp {
  const map = statics(env).map;
  const area = new Set(vc.hexes.map((h) => map.hex(h)?.id ?? h));
  const units: AreaVpUnit[] = [];
  const mine = Object.values(env.state.pieces)
    .filter((p) => p.side === vc.side && p.loc.kind === 'hex' && area.has(p.loc.hex) && isGoodOrder(env, p))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const p of mine) {
    const m = mmc(env, p);
    const l = m ? null : smc(env, p);
    const vp = m ? (m.kind === 'hs' ? 1 : 2) : l ? 1 + Math.max(0, -l.leadership) : 0;
    if (vp > 0) units.push({ unit: p.id, hex: hexOf(env.state, p)!, vp });
  }
  return { total: units.reduce((a, u) => a + u.vp, 0), units };
}
