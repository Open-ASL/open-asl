import type { HexId, QueryEnv, RuleModule } from '@asl/engine';
import { hexOfLoc } from '../common/location';
import { statics } from '../common/pieces';
import type { LosResult } from '../common/statics';
import { grainInSeason, terrainOf, type LosTrace } from '../sk1/terrain';
import { heightOf } from '../sk2/elevation';
import { orchardsInSeason } from '../sk2/ssr';

/**
 * LOS with heights in full ASL (ASLRB A6.2, A6.4–A6.43, A6.5, A6.7, B10.2–B10.23, B12.2, B13.2, B14.2, B15.2,
 * B23.2, B23.22). The Starter Kit traces every LOS between hexes at their own elevation (`sk1.los.terrain`, with the
 * SK4 1.1.1 hill rules in `sk2.los.elevation`); here the terrain part of `'los.trace'` is the map's `losAt` between the
 * two Locations' heights (`heightOf`: hex elevation plus building level), so a unit on level 1 of a Two Story House sees
 * over ground-level woods to level 1 beyond, not past a 1½-level house, and a higher viewer has Blind Hexes. Smoke, SSR
 * terrain, the one-Hindrance-per-range rule and +6 blocking stay the shared contributions that follow.
 *
 * A vehicle or wreck hinders only a same-level LOS (A6.7, B10.22 "high enough to see over a wreck/AFV").
 */
export const aslLosModule: RuleModule = {
  id: 'asl.los',
  ref: 'ASLRB A6.2, A6.4, B10.2, B10.23, B14.2',
  summary: 'LOS between Location heights: obstacle heights, seeing over obstacles, Blind Hexes, same-level Hindrances.',
  requires: ['sk1.terrain', 'asl.locations'],
  install(r) {
    r.suppress<'los.trace'>({ id: 'asl.los.not-sk-terrain', query: 'los.trace', target: 'sk1.los.terrain', ref: 'ASLRB A6.2' });
    r.suppress<'los.trace'>({ id: 'asl.los.not-sk-elevation', query: 'los.trace', target: 'sk2.los.elevation', ref: 'ASLRB B10.2, B14.2' });
    r.contribute({
      id: 'asl.los.heights',
      query: 'los.trace',
      layer: 0,
      ref: 'ASLRB A6.2, A6.4, B10.2',
      apply(_v, c, env): LosTrace {
        const map = statics(env).map;
        const from = hexOfLoc(c.from);
        const to = hexOfLoc(c.to);
        if (!map.losAt) throw new Error('asl.los: the map has no LOS between heights');
        const res = map.losAt({ hex: from, height: heightOf(env, c.from), ...c.fromAt }, { hex: to, height: heightOf(env, c.to), ...c.toAt }, { orchardInSeason: orchardsInSeason(env) });
        if (!res.clear) {
          return {
            clear: false,
            hindrance: 0,
            parts: [],
            blockedBy: blockedBy(env, res),
            ...(res.near ? { near: true } : {}),
            ...(res.blockedAt ? { blockedAt: res.blockedAt } : {}),
          };
        }
        // `losAt` lists only the Hindrances that apply between these heights; grain is open ground out of season.
        const parts: LosTrace['parts'] = [];
        const seen = new Set<HexId>();
        for (const x of res.crossed) {
          if (seen.has(x.hex) || x.hex === from || x.hex === to) continue;
          if (x.terrain === 'grain' && !grainInSeason(env)) continue;
          const hind = statics(env).terrain[x.terrain] ?? terrainOf(env, x.hex);
          seen.add(x.hex);
          parts.push({ label: `+1 ${hind.name} hindrance`, hex: x.hex, drm: 1, terrain: hind.id });
        }
        return { clear: true, hindrance: parts.length, parts, ...(res.woods ? { woods: res.woods } : {}), ...(res.orchard ? { orchard: res.orchard } : {}) };
      },
    });
    // A6.7, B10.22: a vehicle or wreck is a Hindrance only between same-level firer and target.
    r.suppress<'los.trace'>({
      id: 'asl.los.vehicles-same-level',
      query: 'los.trace',
      target: 'sk3.los.vehicles',
      ref: 'ASLRB A6.7, B10.22',
      when: ({ from, to }, env) => heightOf(env, from) !== heightOf(env, to),
    });
  },
};

/** Why a LOS between heights is blocked, for the player: the obstacle, its hex, and whether it makes a Blind Hex. */
function blockedBy(env: QueryEnv, res: LosResult): string {
  const o = res.obstacle;
  if (!o) return res.crest ? 'higher ground (Crest Line)' : 'terrain obstacle';
  const h = statics(env).map.hex(o.hex);
  const name = o.terrain === 'hill' ? 'higher ground' : h?.obstacleHeight === 1.5 ? 'Two Story House' : (statics(env).terrain[o.terrain]?.name ?? o.terrain);
  if (o.blind) return o.terrain === 'hill' ? `a Blind Hex behind the Crest Line in ${o.hex} (ASLRB B10.23)` : `a Blind Hex behind the ${name} in ${o.hex} (ASLRB A6.4)`;
  return o.terrain === 'hill' ? `higher ground in ${o.hex} (Crest Line)` : `${name} in ${o.hex}`;
}
