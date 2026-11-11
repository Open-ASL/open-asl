import type { HexId, QueryEnv, RuleModule } from '@asl/engine';
import { adjacentLocs, hexOfLoc, isGroundLoc, levelOfLoc, locOf, locationsOf, parseLoc, type LocId } from '../common/location';
import { statics } from '../common/pieces';
import { pieceOf, sw } from '../sk1/status';

/**
 * Multi-level buildings in full ASL: what an upper building level changes beyond the Location model
 * (`asl/locations.ts`) and the shared movement rules (`sk1/movement.ts`, `sk1/advance.ts`, `sk1/rout.ts`).
 *
 * - PBF between the levels of one hex (ASLRB A7.21): ground and level 1 of a Two Story House hex are ADJACENT.
 * - No LOS between non-ADJACENT Locations of the same building next to each other (B23.25).
 * - Indirect Fire (mortars, OBA; ASLRB C.1) on a building hex attacks every level with one DR, +1 DRM per non-rooftop
 *   level above the one attacked; an Interior Building Hex only at its highest level (B23.32).
 *
 * The Starter Kit has no upper levels ('hex.locations' gives one Location per hex), so none of these ever applies there.
 */
export const aslLevelsModule: RuleModule = {
  id: 'asl.levels',
  ref: 'ASLRB A7.21, B23.25, B23.32',
  summary: 'Upper building levels: PBF between levels, LOS within a building, Indirect Fire against every level.',
  requires: ['asl.locations', 'sk1.fire', 'sk1.terrain'],
  install(r) {
    // A7.21: "doubled while ADJACENT to its target"; the level above or below in the same hex is ADJACENT (B23.25),
    // though at hex distance 0, which the Starter Kit's PBF (distance 1) does not see. Not for FT and DC, as there.
    r.contribute({
      id: 'asl.levels.pbf-between-levels',
      query: 'fire.partFp',
      layer: 200,
      ref: 'ASLRB A7.21, B23.25',
      label: 'x2 Point Blank Fire (the level above or below)',
      when: ({ part, attack }, env) => {
        if (part.dist !== 0 || attack.residual) return false;
        if (part.kind === 'sw' && ['FT', 'DC'].includes(sw(env, pieceOf(env, part.piece))?.type ?? '')) return false;
        const from = locOf(env.state, pieceOf(env, part.firer));
        return !!from && from !== attack.target && adjacentLocs(env, from).includes(attack.target);
      },
      apply: (v) => v * 2,
    });

    // B23.25: inside a building, LOS exists only between ADJACENT Locations, unless traced clear of the building
    // depiction through intervening hexes, which two Locations of one hex, or of two adjacent hexes, never are.
    // Farther apart, the ground-level trace decides as before (`asl/los.ts` adds heights).
    r.contribute({
      id: 'asl.levels.los-within-building',
      query: 'los.trace',
      layer: 160,
      ref: 'ASLRB B23.25',
      apply(v, { from, to }, env) {
        if (!v.clear || from === to || (isGroundLoc(from) && isGroundLoc(to))) return v;
        const map = statics(env).map;
        const a = hexOfLoc(from);
        const b = hexOfLoc(to);
        const ba = map.hex(a)?.buildingId;
        if (!ba || ba !== map.hex(b)?.buildingId || (a !== b && map.distance(a, b) > 1)) return v;
        if (adjacentLocs(env, from).includes(to)) return v;
        return { ...v, clear: false, blockedBy: 'the building: not ADJACENT Locations of one building (ASLRB B23.25)' };
      },
    });

    // B23.32: one Original Resolution DR against each level of the building hex hit (only its highest in an Interior
    // Building Hex), with +1 DRM for each non-rooftop level above the one attacked.
    r.contribute({
      id: 'asl.levels.indirect-every-level',
      query: 'fire.indirectLocations',
      ref: 'ASLRB B23.32',
      apply(v, { target }, env) {
        const hex = hexOfLoc(target);
        const levels = locationsOf(env, hex).filter((l) => !parseLoc(l).sub);
        if (levels.length < 2) return v;
        return interiorBuildingHex(env, hex) ? [levels[levels.length - 1]!] : levels;
      },
    });
    r.contribute({
      id: 'asl.levels.indirect-levels-above',
      query: 'fire.drm',
      ref: 'ASLRB B23.32',
      label: ({ attack }, env) => `+${levelsAbove(env, attack.target)} Indirect Fire: ${levelsAbove(env, attack.target) === 1 ? 'a building level' : 'building levels'} above`,
      when: ({ attack }, env) => !!attack.ordnance?.indirect && levelsAbove(env, attack.target) > 0,
      apply: (v, { attack }, env) => v + levelsAbove(env, attack.target),
    });
  },
};

/** Non-rooftop building levels above a Location in its hex (ASLRB B23.32). */
function levelsAbove(env: QueryEnv, loc: LocId): number {
  const top = Math.max(0, ...locationsOf(env, hexOfLoc(loc)).filter((l) => !parseLoc(l).sub).map(levelOfLoc));
  return Math.max(0, top - levelOfLoc(loc));
}

/** A building hex completely surrounded by hexes of the same building (ASLRB B23.32, Index "Interior Building Hex"). */
export function interiorBuildingHex(env: QueryEnv, hex: HexId): boolean {
  const map = statics(env).map;
  const b = map.hex(hex)?.buildingId;
  const n = map.neighbors(hex);
  return !!b && n.length === 6 && n.every((h) => map.hex(h)?.buildingId === b);
}
