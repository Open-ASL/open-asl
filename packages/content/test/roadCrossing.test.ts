import { describe, expect, it } from 'vitest';
import { buildMap } from '../src';

/*
 * A road hexside is one the road crosses anywhere along it, not only at its midpoint. On board v the road from the
 * GG5 edge runs through FF5 off its center and crosses EE5|FF5 and FF5|GG5 away from their midpoints; the import
 * missed both, so a vehicle on that road paid Open Ground (and +4 for the Crest Line) instead of the road rate
 * (SK4 3.3.2: ½ MP CE, 1 MP BU; +2 across a Crest Line via a road hexside, SK4 1.1.1). The vehicle costs are
 * checked in test/commercial.
 */
describe('road hexsides crossed off their midpoint', () => {
  const v = buildMap([{ board: 'v', x: 0, y: 0 }], { los: 'grid' });

  it('board v: the road runs GG5 – FF5 – EE5 – DD5, and FF5 is a road hex', () => {
    expect(v.roadHexside('vFF5', 'vGG5')).toBe(true);
    expect(v.roadHexside('vEE5', 'vFF5')).toBe(true);
    expect(v.roadHexside('vDD5', 'vEE5')).toBe(true);
    expect(v.hex('vFF5')!.features).toContain('road:dirt');
  });

  it('a road branching at a hex corner still crosses the hexside (board v I1 into J1)', () => {
    expect(v.roadHexside('vI1', 'vJ1')).toBe(true);
    expect(v.roadHexside('vI1', 'vI2')).toBe(true);
  });

  it('a road beside a hexside does not cross it', () => {
    // Board v DD5's road leaves through CC6, not along DD5|DD6 or into EE6.
    expect(v.roadHexside('vDD5', 'vDD6')).toBe(false);
    expect(v.roadHexside('vEE5', 'vEE6')).toBe(false);
  });
});
