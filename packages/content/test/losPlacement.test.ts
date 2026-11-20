import { describe, expect, it } from 'vitest';
import { buildMap } from '../src';

describe('pixel LOS on a board placed half a board along', () => {
  it('reads the board’s own terrain: the same LOS at "0.5,0" as at "0,0"', () => {
    const at0 = buildMap([{ board: 'y', x: 0, y: 0 }], {});
    const half = buildMap([{ board: 'y', x: 0.5, y: 0 }], {});
    // Across the U3 stone building, past it, through the K5/K6 villages and over open ground.
    const pairs: [string, string][] = [['yU2', 'yU4'], ['yQ7', 'yV2'], ['yI5', 'yM5'], ['yA1', 'yG9'], ['yN2', 'yN8']];
    const verdicts = (m: typeof at0) => pairs.map(([a, b]) => m.los(a, b).clear);
    expect(verdicts(half)).toEqual(verdicts(at0));
    // At least one of them is blocked: the check is not passing on open ground everywhere.
    expect(verdicts(at0)).toContain(false);
  });

  it('reads the art of the far edge half hexes under a board placed half a board along beside it', () => {
    // A thread along board u's GG edge runs exactly on the board's last pixel column: the edge half hexes' woods
    // (GG4, GG7) block it there however the board above is placed.
    const alone = buildMap([{ board: 'u', x: 0, y: 0 }], {});
    const below = buildMap([{ board: 'y', x: 0.5, y: 0 }, { board: 'u', x: 0, y: 1 }], {});
    const pairs: [string, string][] = [['uGG1', 'uGG5'], ['uGG3', 'uGG6'], ['uGG5', 'uGG10'], ['uGG8', 'uGG10'], ['uGG1', 'uGG3']];
    const verdicts = (m: typeof alone) => pairs.map(([a, b]) => m.los(a, b).clear);
    expect(verdicts(below)).toEqual(verdicts(alone));
    expect(verdicts(alone)).toEqual([false, false, false, true, true]);
  });

  it('reads the art of the half hexes along a lone board’s last row', () => {
    // A thread between two hexrow-10 half hexes of board x runs on the board's last pixel row: V10's woods there blocks
    // it, whether the far hex is an odd or an even hexrow.
    const m = buildMap([{ board: 'x', x: 0, y: 0 }], {});
    const pairs: [string, string][] = [['xX10', 'xW10'], ['xX10', 'xV10'], ['xX10', 'xU10'], ['xX10', 'xT10'], ['xX10', 'xP10'], ['xX10', 'xJ10']];
    expect(pairs.map(([a, b]) => m.los(a, b).clear)).toEqual([true, true, false, false, false, false]);
  });
});
