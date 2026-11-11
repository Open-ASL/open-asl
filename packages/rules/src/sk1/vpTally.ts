import type { HexId, QueryEnv } from '@asl/engine';
import { statics } from '../common/pieces';
import type { VictoryCondition } from '../common/statics';
import { casualties, casualtyVp, controlState } from './scenario';

/*
 * Victory points amassed from several sources, judged at game end (S32: "at game end by amassing ≥ 18 Victory Points.
 * VP are earned as follows: +2 VP per building hex Controlled within 6 hexes of vN9. +3 VP for each Russian ART Gun
 * eliminated."). Each source is a count times its VP.
 */

export type VpTallyVc = VictoryCondition & { kind: 'vpTally' };

export interface VpTallyItem {
  label: string;
  /** VP each. */
  each: number;
  /** What counts now: hexes Controlled, or pieces eliminated. */
  ids: string[];
  vp: number;
}

export interface VpTally {
  total: number;
  items: VpTallyItem[];
}

/** `midGame`: the tally an immediate win is judged by during play, without the sources counted only at game end. */
export function vpTally(env: QueryEnv, vc: VpTallyVc, opts: { midGame?: boolean } = {}): VpTally {
  const map = statics(env).map;
  // Hex Control alone (ASLRB A26.13): a building hex scores once entered, not with the rest of its building.
  const held = controlState(env).hexes;
  const items = vc.sources.map((s): VpTallyItem => {
    if (s.kind === 'casualtyVp') {
      const vp = casualtyVp(env, s.side);
      return { label: s.label, each: 1, ids: casualties(env, s.side).map((c) => c.unit), vp };
    }
    if (s.kind === 'controlledHexes' && s.atGameEnd && opts.midGame) return { label: s.label, each: s.vp, ids: [], vp: 0 };
    const ids =
      s.kind === 'controlledHexes'
        ? [...new Set(s.hexes.map((h) => map.hex(h)?.id ?? h))].filter((h: HexId) => held[h] === vc.side).sort()
        : Object.values(env.state.pieces)
            .filter((p) => s.defs.includes(p.defId) && p.loc.kind === 'eliminated')
            .map((p) => p.id)
            .sort();
    return { label: s.label, each: s.vp, ids, vp: ids.length * s.vp };
  });
  return { total: items.reduce((a, i) => a + i.vp, 0), items };
}
