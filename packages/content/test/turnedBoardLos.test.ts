import { describe, expect, it } from 'vitest';
import { buildMap } from '../src/maps';

/*
 * A board turned 180° keeps its hexes' printed names (BoardPlacement.rotation): the pixel LOS between two of them must
 * read the same art as on the board as printed. Its hex centre dots are the printed ones mirrored through the board's
 * centre, so the thread must be mirrored before it is rounded to a pixel; a pixel or two off, a thread running along a
 * Crest Line or the edge of a grain field reads other art.
 */
describe('pixel LOS on a board turned 180°', () => {
  const printed = (board: string) => buildMap([{ board, x: 0, y: 0 }]);
  const turned = (board: string) => buildMap([{ board, x: 0, y: 0, rotation: 180 }]);
  const read = (map: ReturnType<typeof printed>, a: string, b: string) => {
    const r = map.los(a, b);
    return { clear: r.clear, crossed: r.crossed.map((c) => c.hex).sort() };
  };

  it('a hill hex beyond the firer blocks a LOS from the hill down past it, the board turned or not (SK4 3.2.1)', () => {
    // AA3 and BB2 are on board v's hill, CC1 below it: the thread leaves AA3 into BB2 and crosses the Crest Line there,
    // not as it leaves the higher unit's hex.
    for (const map of [printed('v'), turned('v')]) {
      expect([map.hex('vAA3')!.elevation, map.hex('vBB2')!.elevation, map.hex('vCC1')!.elevation ?? 0]).toEqual([1, 1, 0]);
      for (const [a, b] of [['vAA3', 'vCC1'], ['vCC1', 'vAA3']] as const) expect(map.los(a, b)).toMatchObject({ clear: false, crest: true });
    }
  });

  it('reads the same obstacles and Hindrances as the board as printed', () => {
    const pairs: Record<string, [string, string][]> = {
      v: [['vA6', 'vD3'], ['vC4', 'vG3'], ['vC5', 'vE7'], ['vD6', 'vG7']],
      y: [['yA6', 'yB8'], ['yA6', 'yC5'], ['yA6', 'yC6'], ['yA6', 'yD4']],
      x: [['xA5', 'xD2'], ['xB3', 'xD5'], ['xB7', 'xF6'], ['xC4', 'xG5']],
    };
    for (const [board, list] of Object.entries(pairs)) {
      const p = printed(board);
      const t = turned(board);
      for (const [a, b] of list) expect(read(t, a, b), `${a}-${b}`).toEqual(read(p, a, b));
    }
  });
});
