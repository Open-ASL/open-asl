import { describe, expect, it } from 'vitest';
import type { LosEnd } from '@asl/rules';
import { boardHexes, buildMap } from '../src';

/*
 * The board-u Chapter B pass: the terrain of board u that the full ASL Chapter B rules were checked against,
 * and and the Woods-Road LOS on the real board (SK1 1.1.1, ASLRB B13.31).
 */

const u = buildMap([{ board: 'u', x: 0, y: 0 }]);
const at = (hex: string, height: number): LosEnd => ({ hex, height });

describe('Board u terrain inventory', () => {
  const hexes = Object.entries(boardHexes('u'));
  const where = (f: (h: (typeof hexes)[number][1]) => boolean) =>
    hexes
      .filter(([, h]) => f(h))
      .map(([id]) => id.slice(1))
      .sort();

  it('has open ground, woods, brush, orchards, stone and wooden buildings, and nothing else', () => {
    const count: Record<string, number> = {};
    for (const [, h] of hexes) count[h.terrain] = (count[h.terrain] ?? 0) + 1;
    expect(count).toEqual({ open: 207, woods: 68, orchard: 18, brush: 10, 'building-wood': 18, 'building-stone': 25 });
  });

  it('has twelve Orchard-Road and three Woods-Road hexes, on paved and dirt road respectively', () => {
    expect(where((h) => !!h.features?.includes('orchard-road'))).toEqual(['J5', 'J6', 'J7', 'J8', 'K8', 'M6', 'N5', 'O5', 'P4', 'Q2', 'Q3', 'Q4'].sort());
    expect(where((h) => !!h.features?.includes('orchard-road') && !h.features.includes('road:paved'))).toEqual([]);
    expect(where((h) => !!h.features?.includes('woods-road'))).toEqual(['CC4', 'DD4', 'EE5']);
    expect(where((h) => !!h.features?.includes('woods-road') && !h.features.includes('road:dirt'))).toEqual([]);
    // No road runs into a building or a brush hex.
    expect(where((h) => (h.terrain.startsWith('building') || h.terrain === 'brush') && !!h.features?.some((f) => f.startsWith('road')))).toEqual([]);
  });

  it('has one hill level, with plain orchards and Single Story Houses on it and no road, woods or brush', () => {
    expect(new Set(hexes.map(([, h]) => h.elevation ?? 0))).toEqual(new Set([0, 1]));
    const hill = hexes.filter(([, h]) => h.elevation === 1).map(([, h]) => h);
    expect(hill).toHaveLength(23);
    expect(new Set(hill.map((h) => h.terrain))).toEqual(new Set(['open', 'orchard', 'building-wood']));
    expect(hill.filter((h) => h.features?.length)).toEqual([]);
  });
});

describe('Woods-Road on board u (SK1 1.1.1, ASLRB B13.31)', () => {
  it('a LOS down the dirt road into DD4 does not cross its woods; one from the side does', () => {
    for (const from of ['uBB3', 'uAA3', 'uEE5', 'uGG6']) expect(u.los(from, 'uDD4').woods ?? [], from).not.toContain('uDD4');
    for (const from of ['uCC5', 'uDD3', 'uEE4']) expect(u.los(from, 'uDD4').woods, from).toContain('uDD4');
  });

  it('the height tracer reports the same woods, whatever the heights (B13.31 "regardless of the relative elevations")', () => {
    expect(u.losAt(at('uBB3', 0), at('uDD4', 0), { orchardInSeason: true }).woods ?? []).not.toContain('uDD4');
    expect(u.losAt(at('uDD3', 0), at('uDD4', 0), { orchardInSeason: true }).woods).toContain('uDD4');
  });
});
