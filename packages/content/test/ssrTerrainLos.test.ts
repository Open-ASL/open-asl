import { describe, expect, it } from 'vitest';
import { terrainOf, type ScenarioDef } from '@asl/rules';
import { newGame } from '../src';
import { SK_S19, SK_S8 } from '../src/scenarios/skFree';

/*
 * S19 SSR 1: "The CC6 woods mass is considered Open Ground (ignore the woods illustrations)". Open Ground is neither an
 * obstacle nor a Hindrance (SK1 3.2), so a LOS down hexrow CC through the mass is clear. S8 plays the same board y with no
 * such rule: there the woods block it.
 */
describe('a terrain-override SSR changes the LOS too (S19 SSR 1: the CC6 woods mass is Open Ground)', () => {
  const envOf = (sc: ScenarioDef) => {
    const { engine, state } = newGame(sc, 'ssr-los', { los: 'pixel' });
    return engine.env(state);
  };
  const s19 = envOf(SK_S19);
  const s8 = envOf(SK_S8);
  const trace = (env: typeof s19, from: string, to: string) => env.query('los.trace', { from, to }, { clear: true, hindrance: 0, parts: [] });
  const PAIRS: [string, string][] = [
    ['yCC1', 'yCC7'],
    ['yCC4', 'yCC8'],
  ];

  it('S19: the CC6 woods hexes are Open Ground; S8: they are woods', () => {
    for (const h of ['yCC2', 'yCC3', 'yCC5', 'yCC6']) {
      expect(terrainOf(s19, h).id, h).toBe('open');
      expect(terrainOf(s8, h).id, h).toBe('woods');
    }
  });

  for (const [from, to] of PAIRS) {
    it(`S19: ${from} sees ${to} across the CC6 mass, both ways (ASLRB A6.5), with no Hindrance`, () => {
      for (const [a, b] of [
        [from, to],
        [to, from],
      ] as const) {
        const t = trace(s19, a, b);
        expect(t.blockedBy, `${a}>${b}`).toBeUndefined();
        expect(t.clear, `${a}>${b}`).toBe(true);
        expect(t.hindrance, `${a}>${b}`).toBe(0);
      }
    });

    it(`S8 (no such SSR): the CC6 woods block ${from} to ${to}`, () => {
      expect(trace(s8, from, to).clear).toBe(false);
      expect(trace(s8, to, from).clear).toBe(false);
    });
  }

  // The same SSR's other half: "All grain hexes are flooded hexes and ... [do not] act as an obstacle/hindrance".
  it('S19: the grain of yBB5 is flooded, no Hindrance from yBB4 to yCC8; S8: +1 grain Hindrance', () => {
    const t = trace(s19, 'yBB4', 'yCC8');
    expect(t.clear).toBe(true);
    expect(t.hindrance).toBe(0);
    const u = trace(s8, 'yBB4', 'yCC8');
    expect(u.clear).toBe(true);
    expect(u.parts).toEqual([expect.objectContaining({ hex: 'yBB5', terrain: 'grain', drm: 1 })]);
  });
});
