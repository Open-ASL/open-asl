import { describe, expect, it } from 'vitest';
import { SS_COLORS, emptySsRoom, freeSsColor, ssColor, thinStroke } from '../src/superSpectator';

describe("the commentators' room", () => {
  it('starts following the live game with nothing hidden shown, no ink and no checks', () => {
    expect(emptySsRoom()).toEqual({ cursor: 'live', virtual: null, show: {}, epoch: 0, check: null, heat: null, play: null, speed: 0 });
  });

  it('gives a newcomer the lowest colour no one present is using, and cycles once all are taken', () => {
    expect(freeSsColor([])).toBe(0);
    expect(freeSsColor([0, 1, 3])).toBe(2);
    const all = SS_COLORS.map((_, i) => i);
    expect(freeSsColor(all)).toBe(0);
    expect(ssColor(SS_COLORS.length + 1)).toBe(SS_COLORS[1]);
  });

  it('thins a stroke: points the pointer barely moved are dropped, the ends are kept, and a long one is cut to the limit', () => {
    expect(thinStroke([0, 0, 0.5, 0.5, 10, 0, 10.2, 0, 20, 0])).toEqual([0, 0, 10, 0, 20, 0]);
    const long = Array.from({ length: 2000 }, (_, i) => [i * 3, 0]).flat();
    const thin = thinStroke(long, 100);
    expect(thin.length).toBe(200);
    expect(thin.slice(0, 2)).toEqual([0, 0]);
    expect(thin.slice(-2)).toEqual([1999 * 3, 0]);
  });
});
