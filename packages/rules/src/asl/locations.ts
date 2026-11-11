import type { RuleModule } from '@asl/engine';
import { hexOfLoc, levelOfLoc, locId, locationsOf, type LocId } from '../common/location';
import { statics } from '../common/pieces';

/**
 * Full ASL Locations (ASLRB A2.8): a building hex with upper levels has a Location per level (B23.21–23).
 * The Starter Kit plays at ground level only, so these contributions are what gives a full ASL hex more
 * than one Location; everything that asks "which Locations" or "which adjacent Locations" goes through
 * `'hex.locations'` and `'loc.adjacent'`.
 *
 * Upper levels exist only on maps that carry level data (`MapHex.building`, filled by the importer, or the
 * Location tests' synthetic buildings).
 */
export const aslLocationsModule: RuleModule = {
  id: 'asl.locations',
  ref: 'ASLRB A2.8, A.8, B23.25',
  summary: 'Upper building levels are Locations of their own; ADJACENT Locations follow levels and stairwells.',
  requires: ['common.pieces'],
  install(r) {
    r.contribute({
      id: 'asl.locations.upper-levels',
      query: 'hex.locations',
      ref: 'ASLRB A2.8, B23.21–23',
      apply(v, { hex }, env) {
        const upper = statics(env).map.hex(hex)?.building?.upper ?? 0;
        if (!upper) return v;
        const levels = Array.from({ length: upper }, (_, i) => locId(hex, i + 1));
        return [...v, ...levels.filter((l) => !v.includes(l))];
      },
    });
    // A.8: Locations are ADJACENT only if a unit could move between them in the APh. Within a building
    // (B23.25) that means the same level of an adjacent hex of the same building, or the level directly
    // above or below through a stairwell (printed, or a Two Story House's inherent one). From an upper
    // level the ground Locations of the neighbouring hexes are not ADJACENT.
    r.contribute({
      id: 'asl.locations.adjacent',
      query: 'loc.adjacent',
      ref: 'ASLRB A.8, B23.25',
      apply(v, { loc }, env) {
        const map = statics(env).map;
        const hex = hexOfLoc(loc);
        const level = levelOfLoc(loc);
        const h = map.hex(hex);
        const out: LocId[] = level === 0 ? [...v] : [];
        if (level > 0) {
          for (const n of map.neighbors(hex)) {
            const nh = map.hex(n);
            const there = locId(n, level);
            if (nh?.buildingId && nh.buildingId === h?.buildingId && locationsOf(env, n).includes(there)) out.push(there);
          }
        }
        if (h?.building?.stairwell) {
          if (level > 0) out.push(locId(hex, level - 1));
          if (locationsOf(env, hex).includes(locId(hex, level + 1))) out.push(locId(hex, level + 1));
        }
        return out;
      },
    });
  },
};
