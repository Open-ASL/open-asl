import { describe, expect, it } from 'vitest';
import type { LosEnd } from '@asl/rules';
import { buildMap } from '../src';

/*
 * SK4 1.1.1 Orchard-Road, ASLRB B14.6 (shared by both rulesets): on the pixel map an Orchard-Road hex (board u J5-J8, K8,
 * M6, N5, O5, P4, Q2-Q4) has no orchard effect on the part of a LOS that stays on its road art, at any height; off the
 * road it is an orchard in every respect.
 */

const u = buildMap([{ board: 'u', x: 0, y: 0 }]);
const at = (hex: string, height: number): LosEnd => ({ hex, height });
const AUGUST = { orchardInSeason: true };
const DECEMBER = { orchardInSeason: false };
const crossed = (r: { crossed: { hex: string }[] }) => r.crossed.map((c) => c.hex);

describe('Orchard-Road LOS on board u (SK4 1.1.1, ASLRB B14.6)', () => {
  it('a ground LOS down the J5-J7 road is not hindered by its Orchard-Road hexes', () => {
    expect(u.los('uJ3', 'uJ7')).toMatchObject({ clear: true, crossed: [] });
    expect(u.losAt(at('uJ3', 0), at('uJ7', 0), AUGUST)).toMatchObject({ clear: true, crossed: [] });
  });

  it('where the road bends the LOS leaves it, and that hex hinders as an orchard (J8 on the way to J9)', () => {
    expect(crossed(u.los('uJ4', 'uJ9'))).toEqual(['uJ8']);
    expect(crossed(u.los('uJ9', 'uJ4'))).toEqual(['uJ8']);
  });

  it('from level 1 of M7, in season, the ground along the K8-J8 road is in view: the road lifts the obstacle too', () => {
    expect(u.losAt(at('uM7', 1), at('uJ8', 0), AUGUST).clear).toBe(true);
    expect(u.losAt(at('uM7', 1), at('uI9', 0), AUGUST).clear).toBe(true);
  });

  it('a LOS crossing an Orchard-Road hex off its road is still blocked from level 1 in season, and hindered out of season', () => {
    const r = u.losAt(at('uP3', 1), at('uQ5', 0), AUGUST);
    expect(r.clear).toBe(false);
    expect(r.obstacle).toEqual({ hex: 'uQ4', terrain: 'orchard' });
    expect(u.losAt(at('uP3', 1), at('uQ5', 0), DECEMBER)).toMatchObject({ clear: true });
  });

  it('reports the end Orchard-Road hexes in which the thread leaves the road', () => {
    expect(u.los('uJ3', 'uJ6').orchard).toBeUndefined();
    expect(u.losAt(at('uJ3', 0), at('uJ6', 0), AUGUST).orchard).toBeUndefined();
    expect(u.los('uI5', 'uJ6').orchard).toEqual(['uJ6']);
    expect(u.losAt(at('uI5', 0), at('uJ6', 0), AUGUST).orchard).toEqual(['uJ6']);
  });
});
