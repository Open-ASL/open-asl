import type { HexId, QueryEnv, RuleModule } from '@asl/engine';
import { statics } from '../common/pieces';
import { hexPixel } from '../common/map';
import { hexOfLoc } from '../common/location';
import type { LosTrace } from './terrain';

/*
 * An Embankment Railroad by SSR (S31 SSR 1: "The road Y10-DD6-GG6 is instead an Embankment Railroad (EmRR), and is a
 * "half level" obstacle. A unit not on an EmRR has its LOS blocked by the EmRR depiction in any non-adjacent hex to all
 * non-EmRR hexes beyond the first hex after the EmRR hex of the depiction crossed. The road hexes Y1-DD6 remain road
 * hexes. It costs 2MP to enter an EmRR hex unless entering from an adjacent EmRR hex in which case it costs 1MP. EmRR
 * hexes provide no TEM benefits.").
 *
 * The depiction is taken as the line through the EmRR hexes' centre dots in order. A LOS between two non-EmRR hexes
 * that crosses it is blocked when the EmRR hex where it crosses is neither adjacent to the viewer nor adjacent to the
 * target (the "first hex after" it): the embankment hides what lies beyond it, but not the ground right behind it.
 * Its road is no road (the map drops the road there, see `buildMap`'s `railroad`).
 */

export const EMBANKMENT_RAILROAD_MODULE = 'embankment-railroad';
export interface EmbankmentRailroadParams {
  /** The EmRR hexes in order along the line. */
  hexes: HexId[];
  /** Road hexes that stay road ("The road hexes Y1-DD6 remain road hexes"), where the two meet. */
  roads?: HexId[];
  /** MF/MP to enter an EmRR hex, and to enter one from an adjacent EmRR hex. */
  mf: number;
  alongMf: number;
  /** The card's name for the rule, e.g. 'SSR 1'. */
  rule?: string;
}

const paramsOf = (env: QueryEnv): EmbankmentRailroadParams[] =>
  statics(env)
    .scenario.ssr.filter((s) => s.module === EMBANKMENT_RAILROAD_MODULE && s.params)
    .map((s) => s.params as unknown as EmbankmentRailroadParams);

/** The EmRR rule a hex is on, if any (by the map's own name for the hex). */
function railroadAt(env: QueryEnv, hex: HexId): EmbankmentRailroadParams | undefined {
  const map = statics(env).map;
  const id = map.hex(hex)?.id ?? hex;
  return paramsOf(env).find((p) => p.hexes.some((h) => (map.hex(h)?.id ?? h) === id));
}

type Pt = { x: number; y: number };
const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
/** Where segments ab and cd meet (touching counts), as the share of the way along cd, or null. */
function meet(a: Pt, b: Pt, c: Pt, d: Pt): number | null {
  const d1 = cross(a, b, c);
  const d2 = cross(a, b, d);
  const d3 = cross(c, d, a);
  const d4 = cross(c, d, b);
  if (((d1 > 0 && d2 > 0) || (d1 < 0 && d2 < 0)) || ((d3 > 0 && d4 > 0) || (d3 < 0 && d4 < 0))) return null;
  if (d1 === d2) return null; // parallel: running along the embankment is not crossing it
  return d1 / (d1 - d2);
}

/** The EmRR hex whose depiction blocks the LOS from `from` to `to`, or null (SSR, see above). */
export function embankmentBlock(env: QueryEnv, from: HexId, to: HexId): { hex: HexId; rule?: string } | null {
  const map = statics(env).map;
  const f = map.hex(from);
  const t = map.hex(to);
  if (!f || !t || railroadAt(env, from) || railroadAt(env, to)) return null;
  const a = hexPixel(f.cube);
  const b = hexPixel(t.cube);
  for (const r of paramsOf(env)) {
    const line = r.hexes.map((h) => map.hex(h)).filter((h): h is NonNullable<typeof h> => !!h);
    for (let i = 0; i + 1 < line.length; i++) {
      const c = hexPixel(line[i]!.cube);
      const d = hexPixel(line[i + 1]!.cube);
      const s = meet(a, b, c, d);
      if (s === null) continue;
      // The crossing lies in the hex of the nearer centre dot.
      const e = s < 0.5 ? line[i]! : line[i + 1]!;
      if (map.distance(from, e.id) >= 2 && map.distance(e.id, to) >= 2) return { hex: e.id, ...(r.rule ? { rule: r.rule } : {}) };
    }
  }
  return null;
}

export const embankmentRailroadModule: RuleModule = {
  id: 'ssr.embankment-railroad',
  summary: 'An Embankment Railroad (SSR): a half-level LOS obstacle beyond the hex behind it, 2 MF to enter (1 along it), no TEM.',
  requires: ['sk1.terrain', 'sk1.movement'],
  install(r) {
    r.contribute({
      id: 'ssr.embankment-railroad.los',
      query: 'los.trace',
      layer: 150,
      apply(v, { from, to }, env): LosTrace {
        if (!v.clear) return v;
        const block = embankmentBlock(env, hexOfLoc(from), hexOfLoc(to));
        return block ? { ...v, clear: false, blockedBy: `Embankment Railroad in ${block.hex}${block.rule ? ` (${block.rule})` : ''}` } : v;
      },
    });
    r.contribute({
      id: 'ssr.embankment-railroad.mf',
      query: 'move.cost',
      layer: 1,
      label: (c, env) => `Embankment Railroad (${railroadAt(env, c.to)!.rule ?? 'SSR'})`,
      when: ({ to }, env) => !!railroadAt(env, to),
      apply: (_v, { from, to }, env) => {
        const rr = railroadAt(env, to)!;
        const along = !!from && railroadAt(env, from) === rr && statics(env).map.distance(from, to) === 1;
        return along ? rr.alongMf : rr.mf;
      },
    });
    r.contribute({
      id: 'ssr.embankment-railroad.tem',
      query: 'hex.tem',
      layer: 900,
      label: 'no TEM on the Embankment Railroad (SSR)',
      when: ({ hex }, env) => !!railroadAt(env, hexOfLoc(hex)),
      apply: () => 0,
    });
  },
};
