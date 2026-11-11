import { describe, expect, it } from 'vitest';
import { acrossSide, cornerBetween, cornerHexes, cornerLabel, sameCorner, sideToward } from '../../src';
import { testMap } from '../fixtures';

/*
 * Hex corners and hexsides (`common/hexCorners.ts`), and a LOS to or from a corner (ASLRB A4.34, A6.2, A6.12)
 * on the hex-level map. Board u's grid; R3 is a building.
 */

describe('Hex corners and hexsides', () => {
  const map = testMap({ uR3: { terrain: 'building-wood' } }, 'u');

  it('names each hexside by the hex across it, and each corner by the two hexes meeting it there (A2.2)', () => {
    const across = [0, 1, 2, 3, 4, 5].map((k) => acrossSide(map, 'uR3', k));
    expect(new Set(across)).toEqual(new Set(['uQ3', 'uQ4', 'uR2', 'uR4', 'uS3', 'uS4']));
    for (const [k, nb] of across.entries()) expect(sideToward(map, 'uR3', nb!)).toBe(k);
    const k = cornerBetween(map, 'uR3', 'uS3', 'uS4')!;
    expect(cornerHexes(map, 'uR3', k).sort()).toEqual(['uS3', 'uS4']);
    expect(cornerLabel(map, 'uR3', k)).toMatch(/^R3-S[34]-S[34]$/);
    // The same point is a corner of S3 and S4 too.
    const j = sameCorner(map, 'uR3', k, 'uS4')!;
    expect(cornerHexes(map, 'uS4', j).sort()).toEqual(['uR3', 'uS3']);
  });

  it('a LOS to a corner is blocked by the obstacle of that hex when it crosses it, not when it stays in the open (A4.34)', () => {
    const k0 = cornerBetween(map, 'uR3', 'uS3', 'uS4')!;
    const k2 = cornerBetween(map, 'uR3', 'uR4', 'uQ4')!;
    // From P4 the far corner lies behind the building; the near one does not.
    expect(map.losAt({ hex: 'uP4', height: 0 }, { hex: 'uR3', height: 0, vertex: k0 }).clear).toBe(false);
    expect(map.losAt({ hex: 'uP4', height: 0 }, { hex: 'uR3', height: 0, vertex: k2 }).clear).toBe(true);
    // To the centre the hex's own terrain never blocks (A6.2): the LOS enters the obstacle.
    expect(map.losAt({ hex: 'uP4', height: 0 }, { hex: 'uR3', height: 0 }).clear).toBe(true);
    // Reciprocal (A6.5): from the corner back to P4.
    expect(map.losAt({ hex: 'uR3', height: 0, vertex: k0 }, { hex: 'uP4', height: 0 }).clear).toBe(false);
  });
});
