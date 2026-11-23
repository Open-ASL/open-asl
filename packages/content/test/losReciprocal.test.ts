import { describe, expect, it } from 'vitest';
import { buildMap } from '../src/maps';

/*
 * LOS is reciprocal (ASLRB A6.5): the thread between two hex centres is the same thread whichever end it is stretched
 * from, so the pixel LOS must read the same art both ways. And a thread blocked only by an obstacle depiction visible on
 * one side of it is not blocked (SK4 3.2.1; ASLRB A6.1: "with the obstruction visible on both sides of the thread").
 */
describe('pixel LOS is the same both ways (ASLRB A6.5)', () => {
  const read = (map: ReturnType<typeof buildMap>, a: string, b: string) => {
    // A blocked LOS has no Hindrances to speak of: the hexes it passed before the obstacle mean nothing.
    const r = map.los(a, b);
    return { clear: r.clear, crossed: r.clear ? r.crossed.map((c) => c.hex).sort() : [] };
  };

  it('a thread along the U4-Y4 hexsides of board u, woods on one side only at the Y4 vertex, is clear both ways', () => {
    // U4 and Y4 are in the same hexrow of even columns: the thread runs exactly along the V3|V4 and X3|X4 hexsides and
    // through their vertices. X4's woods come up to it at the vertex it shares with X3 and Y4: visible on one side only.
    const u = buildMap([{ board: 'u', x: 0, y: 0 }]);
    expect(read(u, 'uU4', 'uY4')).toEqual(read(u, 'uY4', 'uU4'));
    expect(u.los('uU4', 'uY4').clear).toBe(true);
  });

  // Board u had over 3,000 pairs within 8 hexes reading differently the two ways; within 4 hexes is enough to keep them out.
  it('every pair within 4 hexes of board u reads the same both ways', { timeout: 180_000 }, () => {
    for (const board of ['u']) {
      const map = buildMap([{ board, x: 0, y: 0 }]);
      const ids = [...map.hexes()].map((h) => h.id).sort();
      const diffs: string[] = [];
      for (const a of ids)
        for (const b of ids) {
          if (a >= b || map.distance(a, b) > 4) continue;
          const ab = read(map, a, b);
          const ba = read(map, b, a);
          if (ab.clear !== ba.clear || ab.crossed.join() !== ba.crossed.join()) diffs.push(`${a}-${b}`);
        }
      expect(diffs, board).toEqual([]);
    }
  });
});
