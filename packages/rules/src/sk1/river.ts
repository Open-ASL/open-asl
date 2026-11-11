import type { HexId, QueryEnv, RuleModule } from '@asl/engine';
import { Layer } from '@asl/engine';
import { hexOf, statics } from '../common/pieces';
import { hexOfLoc } from '../common/location';
import { pieceOf } from './status';

/*
 * A river by SSR that may be crossed at one hex only (S66 SSR 1: "The nN5-BB5 road represents the Matanikau River.
 * There is a footbridge in V6 running from U6 to W7, which has a stacking capacity of one squad equivalent and up to
 * four leaders. Units may not enter/exit a river hex except across the U6 or W7 hexsides to/from hex V6. Unit[s] in V6
 * are considered to be one level lower for movement and Height Advantage purposes. LOS to/from V6 is limited to
 * adjacent hexes and hex R8.").
 *
 * No unit enters or leaves a river hex except the crossing hex, and that only across the hexsides of `crossing.from`:
 * in the MPh (`move.stepIllegal`), routing (the step costs more MF than any unit has: `move.cost`), advancing
 * (`advance.illegal`). The crossing hex has its own stacking limit (`stack.limit`). Its level (`level`) is set on the map
 * by the content package, so the hill rules give it the Crest Line cost uphill out of it and Height Advantage against it.
 * LOS to or from it exists only to adjacent hexes and the listed ones (`los.trace`).
 */

export const RIVER_MODULE = 'river';

export interface RiverParams {
  /** Every river hex, the crossing hex included. */
  hexes: HexId[];
  /** The one hex units may enter (the footbridge), and the hexes they may enter it from or leave it to. */
  crossing: { hex: HexId; from: HexId[] };
  /** Stacking limit in the crossing hex. */
  stack?: { se: number; smc: number };
  /** The crossing hex's level (applied by the map). */
  level?: number;
  /** Beyond adjacent hexes, the only hexes with a LOS to or from the crossing hex. */
  los?: HexId[];
  /** The card's name for the rule, e.g. 'SSR 1'. */
  rule?: string;
}

export const riverParams = (env: QueryEnv): RiverParams[] =>
  statics(env)
    .scenario.ssr.filter((s) => s.module === RIVER_MODULE && s.params)
    .map((s) => s.params as unknown as RiverParams);

/** Why a step from `from` (null: from offboard) into `to` crosses the river where it may not, or null. */
export function riverStepIllegal(env: QueryEnv, from: HexId | null | undefined, to: HexId): string | null {
  for (const q of riverParams(env)) {
    const rule = q.rule ?? 'SSR';
    const { hex, from: sides } = q.crossing;
    const label = (h: HexId) => h.replace(/^[a-z]/, '');
    const why = `${rule}: units enter or leave the river only at ${label(hex)}, across the ${sides.map(label).join(' or ')} hexsides`;
    if (q.hexes.includes(to) && (to !== hex || !from || !sides.includes(from))) return why;
    if (from && q.hexes.includes(from) && (from !== hex || !sides.includes(to))) return why;
  }
  return null;
}

export const riverModule: RuleModule = {
  id: 'ssr.river',
  summary: 'A river crossed only at one hex (a footbridge) with its own stacking limit, level and limited LOS (SSR).',
  requires: ['sk1.movement', 'sk1.advance', 'sk1.terrain'],
  install(r) {
    r.contribute({
      id: 'ssr.river.step',
      query: 'move.stepIllegal',
      apply: (v, { ms, to }, env) => v ?? riverStepIllegal(env, ms.hex ?? null, to),
    });
    // Routing judges a step by its MF: one into or out of the river where it may not be crossed is never affordable.
    r.contribute({
      id: 'ssr.river.cost',
      query: 'move.cost',
      layer: Layer.Multiply + 100,
      apply: (v, { from, to }, env) => (riverStepIllegal(env, from ?? null, to) ? Infinity : v),
    });
    r.contribute({
      id: 'ssr.river.advance',
      query: 'advance.illegal',
      apply(v, { units, to }, env) {
        if (v) return v;
        for (const u of units) {
          const why = riverStepIllegal(env, hexOf(env.state, pieceOf(env, u)) ?? null, hexOfLoc(to));
          if (why) return why;
        }
        return null;
      },
    });
    r.contribute({
      id: 'ssr.river.stacking',
      query: 'stack.limit',
      layer: Layer.Multiply + 100,
      apply(v, { hex }, env) {
        const q = riverParams(env).find((x) => x.stack && x.crossing.hex === hex);
        return q ? { se: Math.min(v.se, q.stack!.se), smc: Math.min(v.smc, q.stack!.smc) } : v;
      },
    });
    r.contribute({
      id: 'ssr.river.los',
      query: 'los.trace',
      layer: Layer.Multiply + 100,
      apply(v, { from, to }, env) {
        if (!v.clear) return v;
        const a = hexOfLoc(from);
        const b = hexOfLoc(to);
        const map = statics(env).map;
        for (const q of riverParams(env)) {
          const at = q.crossing.hex;
          if (a !== at && b !== at) continue;
          const other = a === at ? b : a;
          if (other === at || map.distance(at, other) <= 1 || (q.los ?? []).includes(other)) continue;
          return { ...v, clear: false, blockedBy: `${q.rule ?? 'SSR'}: LOS to/from ${at.replace(/^[a-z]/, '')} only from adjacent hexes${q.los?.length ? ` and ${q.los.map((h) => h.replace(/^[a-z]/, '')).join(', ')}` : ''}` };
        }
        return v;
      },
    });
  },
};
