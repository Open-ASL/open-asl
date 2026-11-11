import { Layer, type HexId, type PieceId, type QueryEnv, type RuleModule } from '@asl/engine';
import { defOf, statics } from '../common/pieces';
import { hexPixel } from '../common/map';
import type { FireAttackCtx } from '../sk1/fire';
import type { LosTrace } from '../sk1/terrain';
import { emplacementDrm, emplacementThDrm, gunshieldDrm } from './guns';
import { orchardsInSeason } from './ssr';
import { hexOfLoc, levelOfLoc, locOf, type LocId } from '../common/location';

/** Full-level elevation of a hex (SK4 1.1.1: a hex is at the level of its centre dot). */
/**
 * A hex's level (its ground elevation; for a Location, that of its hex); an offboard hex is ground level unless
 * the map gives it its printed elevation (SSR).
 */
export const levelOf = (env: QueryEnv, loc: HexId | LocId): number => {
  const map = statics(env).map;
  const hex = hexOfLoc(loc);
  return map.hex(hex)?.elevation ?? map.offboardHex(hex)?.elevation ?? 0;
};

/**
 * Absolute height of a Location for LOS (ASLRB A6.2, B23.2): its hex's elevation plus its building level. A
 * rooftop will add ½ (rooftops are not modelled yet). The Starter Kit is always at ground level, where this is `levelOf`.
 */
export const heightOf = (env: QueryEnv, loc: LocId): number => env.query('loc.height', { loc }, levelOf(env, loc) + levelOfLoc(loc));

/**
 * The neighbour of `hex` whose shared hexside a straight thread from `from` enters `hex` through
 * (through a vertex: the first of the two by direction). Null when the hexes are the same or unknown.
 */
export function entryHexside(env: QueryEnv, hex: HexId, from: HexId): HexId | null {
  const map = statics(env).map;
  const h = map.hex(hex);
  const f = map.hex(from);
  if (!h || !f || hex === from) return null;
  const c = hexPixel(h.cube);
  const p = hexPixel(f.cube);
  const vx = p.x - c.x;
  const vy = p.y - c.y;
  const len = Math.hypot(vx, vy) || 1;
  let best: HexId | null = null;
  let bestCos = -2;
  for (const n of map.neighbors(hex)) {
    const nh = map.hex(n);
    if (!nh) continue;
    const q = hexPixel(nh.cube);
    const wx = q.x - c.x;
    const wy = q.y - c.y;
    const cos = (vx * wx + vy * wy) / (len * (Math.hypot(wx, wy) || 1));
    if (cos > bestCos + 1e-9) {
      bestCos = cos;
      best = n;
    }
  }
  return best;
}

/**
 * Whether a target Location is entitled to the +1 Height Advantage TEM against fire from `firerLocs`
 * (SK4 1.1.1): every firer is lower, the hex gives no other positive TEM, and a unit that entered
 * the hex this MPh/RtPh did not cross a Crest Line through the hexside the firers' LOS crosses.
 * Reading where SK4 is silent: with several firers the exception needs every firer's LOS to
 * cross that hexside; otherwise the unit is not silhouetted to the whole attack.
 * "From a lower elevation" (SK4 1.1.1, ASLRB B10.31) compares the Locations' heights (`heightOf`): a unit on level 1
 * of a ground-level house is not lower than a level 1 hill hex. In the Starter Kit a height is its hex's level.
 */
export function heightAdvantageHex(env: QueryEnv, targetLoc: HexId | LocId, firerLocs: (HexId | LocId)[], moving?: { from?: HexId | null } | undefined): boolean {
  const target = hexOfLoc(targetLoc);
  const lt = heightOf(env, targetLoc);
  if (firerLocs.length === 0 || !firerLocs.every((h) => heightOf(env, h) < lt)) return false;
  if (env.query('hex.tem', { hex: targetLoc }, 0) > 0) return false;
  // The Crest Line exception is about the hill: the hex levels.
  const from = moving?.from;
  if (from && levelOf(env, from) < levelOf(env, target) && firerLocs.every((h) => entryHexside(env, target, hexOfLoc(h)) === from)) return false;
  return true;
}

const isMortar = (env: QueryEnv, piece: PieceId): boolean => {
  const p = env.state.pieces[piece];
  if (!p) return false;
  const d = defOf(env, p);
  return (d.kind === 'sw' || d.kind === 'gun') && d.type === 'MTR';
};

/** Height Advantage for the target hex of an IFT attack: non-mortar fire from below. */
export function heightAdvantage(env: QueryEnv, attack: FireAttackCtx): boolean {
  if (attack.parts.some((p) => isMortar(env, p.piece))) return false;
  const firerLocs = [...new Set(attack.parts.map((p) => locOf(env.state, env.state.pieces[p.firer]!)).filter((h): h is LocId => !!h))];
  return heightAdvantageHex(env, attack.target, firerLocs, attack.moving);
}

/**
 * SK2 hills (SK4 1.1.1, 3.2.1): Crest Lines double the cost of entering higher terrain, Height
 * Advantage is a +1 TEM against fire from below that also denies FFMO and Interdiction, and LOS
 * between elevations sees over grain and brush but is blocked by orchards in season (+1 out of
 * season). Blocking by the hill mass itself (a hill in the way, a plateau the LOS cannot leave
 * through a Crest Line) is judged by the map's LOS: by pixel elevation on VASL boards, by hex
 * levels in the hex-level approximation (sk1.terrain).
 */
export const elevationModule: RuleModule = {
  id: 'sk2.elevation',
  ref: 'SK4 1.1.1',
  summary: 'Hills: Crest Line movement cost, Height Advantage TEM, LOS between elevations.',
  requires: ['sk1.terrain', 'sk1.fire', 'sk1.rout', 'sk2.guns', 'sk2.ordnance'],
  install(r) {
    // ---------------------------------------------------------------- movement
    // Between the terrain cost (Base) and the Smoke +1 (Add): it is the COT of the hex that doubles.
    r.contribute({
      id: 'sk2.move.crest',
      query: 'move.cost',
      ref: 'SK4 1.1.1',
      layer: Layer.Base + 50,
      label: 'x2 crossing a Crest Line uphill',
      when: ({ from, to }, env) => !!from && levelOf(env, to) > levelOf(env, from),
      apply: (v) => v * 2,
    });

    // ---------------------------------------------------------------- LOS between elevations
    r.contribute({
      id: 'sk2.los.elevation',
      query: 'los.trace',
      ref: 'SK4 1.1.1, 3.2.1',
      apply(v, { from, to }, env): LosTrace {
        if (!v.clear || levelOf(env, hexOfLoc(from)) === levelOf(env, hexOfLoc(to))) return v;
        const parts: LosTrace['parts'] = [];
        for (const p of v.parts) {
          if (!p.terrain) {
            parts.push(p);
            continue;
          }
          // A unit on a higher elevation sees over lower-level grain and brush without Hindrance.
          if (p.terrain === 'grain' || p.terrain === 'brush') continue;
          if (p.terrain === 'orchard') {
            if (orchardsInSeason(env)) return { clear: false, hindrance: 0, parts: [], blockedBy: `Orchard in ${p.hex} between elevations (in season)` };
            parts.push({ ...p, label: '+1 Orchard out of season, between elevations' });
            continue;
          }
          parts.push(p);
        }
        return { ...v, parts, hindrance: parts.reduce((a, p) => a + p.drm, 0) };
      },
    });

    // ---------------------------------------------------------------- Height Advantage
    r.contribute({
      id: 'sk2.drm.height-advantage',
      query: 'fire.unitDrm',
      ref: 'SK4 1.1.1',
      label: '+1 Height Advantage TEM',
      // Never on top of another positive TEM: an emplaced crew or a crew behind its gunshield keeps those.
      when: ({ attack, unit }, env) => heightAdvantage(env, attack) && emplacementDrm(env, unit) === 0 && gunshieldDrm(env, unit, attack) === 0,
      apply: (v) => v + 1,
    });
    // On the Infantry Target Type the TEM went on the To Hit DR.
    r.suppress<'fire.unitDrm'>({ id: 'sk2.drm.height-advantage.itt', query: 'fire.unitDrm', target: 'sk2.drm.height-advantage', ref: 'SK4 3.2.4', when: ({ attack }) => attack.ordnance?.targetType === 'ITT' });
    r.suppress<'fire.drm'>({
      id: 'sk2.drm.ffmo.height-advantage',
      query: 'fire.drm',
      target: 'sk1.drm.ffmo',
      ref: 'SK4 1.1.1',
      label: 'no FFMO: Height Advantage',
      when: ({ attack }, env) => heightAdvantage(env, attack),
    });
    r.contribute({
      id: 'sk2.th.heightAdvantage',
      query: 'ordnance.thDrm',
      ref: 'case 17',
      label: '+1 Height Advantage TEM',
      when: (sc, env) => sc.shot.targetType === 'ITT' && sc.def.type !== 'MTR' && emplacementThDrm(env, sc.target, sc.side) === 0 && heightAdvantageHex(env, sc.target, [sc.loc ?? sc.hex], sc.movingInfo),
      apply: (v) => v + 1,
    });
    r.suppress<'ordnance.thDrm'>({
      id: 'sk2.th.ffmo.height-advantage',
      query: 'ordnance.thDrm',
      target: 'sk2.th.ffmo',
      ref: 'SK4 1.1.1',
      label: 'no FFMO: Height Advantage',
      when: (sc, env) => sc.def.type !== 'MTR' && heightAdvantageHex(env, sc.target, [sc.loc ?? sc.hex], sc.movingInfo),
    });
    r.contribute({
      id: 'sk2.rout.height-advantage',
      query: 'rout.canInterdict',
      ref: 'SK4 1.1.1',
      layer: Layer.Clamp,
      label: 'no Interdiction: Height Advantage',
      when: ({ interdictor, hex, from }, env) => {
        const eh = locOf(env.state, env.state.pieces[interdictor]!);
        return !!eh && heightAdvantageHex(env, hex, [eh], from ? { from } : undefined);
      },
      apply: () => false,
    });
  },
};
