import { describe, expect, it } from 'vitest';
import { cornerBetween, sideToward } from '@asl/rules';
import { boardHexes, buildMap } from '../src';

/*
 * Bypass on the real board: the hexsides of board u's woods and building hexes open to Bypass (ASLRB A4.3, A4.31), measured on the
 * VASL LOS raster (`bypassMask`), and a pixel LOS to a corner (A4.34). Read here as: any open ground
 * depicted between the obstacle and the hexside (or a neighbour's obstacle) leaves the hexside open.
 */

const u = buildMap([{ board: 'u', x: 0, y: 0 }]);
const sides = (hex: string) => [0, 1, 2, 3, 4, 5].filter((k) => u.bypassSides(hex) & (1 << k));

describe('Board u Bypass hexsides', () => {
  const hexes = Object.entries(boardHexes('u'));

  it('every building hex can be bypassed; 66 of the 68 woods hexes (not Y6, nor the Woods-Road hex DD4)', () => {
    const b = hexes.filter(([, h]) => h.terrain.startsWith('building'));
    const w = hexes.filter(([, h]) => h.terrain === 'woods');
    expect(b.filter(([id]) => u.bypassSides(id)).length).toBe(43);
    expect(w.filter(([id]) => !u.bypassSides(id)).map(([id]) => id).sort()).toEqual(['uDD4', 'uY6']);
  });

  it('a single-hex building is open all round; a Two Story House hex not on the hexside it shares with the next', () => {
    expect(sides('uR3')).toEqual([0, 1, 2, 3, 4, 5]);
    expect(sides('uP2')).not.toContain(sideToward(u, 'uP2', 'uP3'));
    expect(sides('uP3')).not.toContain(sideToward(u, 'uP3', 'uP2'));
    expect(sides('uP2').length).toBe(5);
  });

  it('open ground and orchards are never bypassed (no mask)', () => {
    expect(u.bypassSides('uQ5')).toBe(0);
    expect(u.bypassSides('uE5')).toBe(0);
  });

  it('a pixel LOS to a corner of R3: from P5 the near corner is open, the far one behind the building', () => {
    const near = cornerBetween(u, 'uR3', 'uR4', 'uQ4')!;
    const far = cornerBetween(u, 'uR3', 'uR2', 'uQ3')!;
    expect(u.losAt({ hex: 'uP5', height: 0 }, { hex: 'uR3', height: 0, vertex: near }).clear).toBe(true);
    expect(u.losAt({ hex: 'uS5', height: 0 }, { hex: 'uR3', height: 0, vertex: far }).clear).toBe(false);
  });
});
