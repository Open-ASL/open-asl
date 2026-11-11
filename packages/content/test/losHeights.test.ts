import { describe, expect, it } from 'vitest';
import type { LosEnd } from '@asl/rules';
import { buildMap } from '../src';

/*
 * LOS with heights: the pixel LOS between heights on the real boards (ASLRB A6.2, A6.4, B10.2, B10.21, B10.22, B14.2, B23.2,
 * B23.22). Board u is the test bed: its Two Story Houses (1½-level obstacles) have a level 1 at height 1, its hill is
 * level 1. No Location on board u is above level 1, so its Blind Hexes are shown with a hypothetical level 2 viewer;
 * board w's Two Story Houses on the hill give real level 2 viewers.
 */

const u = buildMap([{ board: 'u', x: 0, y: 0 }]);
const w = buildMap([{ board: 'w', x: 0, y: 0 }]);
const at = (hex: string, height: number): LosEnd => ({ hex, height });
const AUGUST = { orchardInSeason: true };

describe('LOS from level 1 of a Two Story House (board u)', () => {
  it('level 1 of G2 sees the hill hexes its ground floor cannot (B10.21: level 1 over level 1 hill ground)', () => {
    expect(u.los('uG2', 'uG5').clear).toBe(false);
    expect(u.losAt(at('uG2', 1), at('uG5', 1), AUGUST).clear).toBe(true);
    expect(u.losAt(at('uG2', 1), at('uF6', 1), AUGUST).clear).toBe(true);
  });

  it('level 1 to the ground beyond ground-level woods is blocked: one level is not above the woods (A6.2 EX, B10.22)', () => {
    const r = u.losAt(at('uI3', 1), at('uA3', 0), AUGUST);
    expect(r.clear).toBe(false);
    expect(r.obstacle).toEqual({ hex: 'uC3', terrain: 'woods' });
  });

  it('level 1 to level 1 sees over Single Story Houses between (B23.2); the ground floors do not', () => {
    expect(u.los('uK4', 'uP3').clear).toBe(false);
    expect(u.losAt(at('uK4', 1), at('uP3', 1), AUGUST).clear).toBe(true);
  });

  it('level 1 to level 1 across another Two Story House is blocked: 1½ levels (B23.22)', () => {
    const r = u.losAt(at('uH1', 1), at('uI4', 1), AUGUST);
    expect(r.clear).toBe(false);
    expect(r.obstacle).toEqual({ hex: 'uI3', terrain: 'building-stone' });
    expect(u.losAt(at('uG2', 1), at('uK4', 1), AUGUST).obstacle?.hex).toBe('uI3');
  });

  it('the woods the thread meets is told, with where (for the map)', () => {
    const r = u.losAt(at('uG2', 1), at('uA1', 0), AUGUST);
    expect(r.obstacle).toEqual({ hex: 'uD1', terrain: 'woods' });
    expect(r.blockedAt).toBeDefined();
  });
});

describe('LOS between the hill and the houses (board u)', () => {
  it('a level 1 hill hex and level 1 of a house see each other over the open ground between', () => {
    expect(u.losAt(at('uF6', 1), at('uG2', 1), AUGUST).clear).toBe(true);
  });

  it('a Single Story House on the hill is a level 2 obstacle between them (B10.1, B23.2)', () => {
    const r = u.losAt(at('uH4', 1), at('uG2', 1), AUGUST);
    expect(r.clear).toBe(false);
    expect(r.obstacle).toEqual({ hex: 'uH3', terrain: 'building-wood' });
  });

  it('an orchard in season blocks level 1 looking down past it to the ground, out of season it hinders (B14.2)', () => {
    const blocked = u.losAt(at('uH9', 1), at('uP4', 0), AUGUST);
    expect(blocked.clear).toBe(false);
    expect(blocked.obstacle).toEqual({ hex: 'uJ8', terrain: 'orchard' });
    const winter = u.losAt(at('uH9', 1), at('uP4', 0), { orchardInSeason: false });
    expect(winter.clear).toBe(true);
    expect(winter.crossed.map((c) => c.terrain)).toContain('orchard');
  });
});

describe('Blind Hexes (A6.4)', () => {
  it('board u: from a hypothetical level 2, the hex right behind the G2–H1 Two Story House is blind; level 1 there is not', () => {
    const r = u.losAt(at('uC1', 2), at('uI2', 0), AUGUST);
    expect(r.clear).toBe(false);
    expect(r.obstacle).toEqual({ hex: 'uH1', terrain: 'building-wood', blind: true });
    // A unit at the obstacle's full-level height in that hex is not blind (A6.4).
    expect(u.losAt(at('uC1', 2), at('uI2', 1), AUGUST).clear).toBe(true);
  });

  it('board w: level 1 of the G4 Two Story House on the level 1 hill (height 2) cannot see the ground right behind a house', () => {
    const r = w.losAt(at('wG4', 2), at('wC2', 0), AUGUST);
    expect(r.clear).toBe(false);
    expect(r.obstacle).toEqual({ hex: 'wD2', terrain: 'building-wood', blind: true });
    expect(w.losAt(at('wG4', 2), at('wD1', 0), AUGUST).obstacle).toEqual({ hex: 'wE2', terrain: 'orchard', blind: true });
  });
});

describe('the height tracer and the Starter Kit LOS', () => {
  it('is the same both ways (A6.5)', () => {
    for (const [a, b] of [[at('uI3', 1), at('uA3', 0)], [at('uG2', 1), at('uG5', 1)], [at('uC1', 2), at('uI2', 0)]] as const) {
      expect(u.losAt(b, a, AUGUST)).toBe(u.losAt(a, b, AUGUST));
    }
  });

  it('on level ground at ground level it gives the Starter Kit LOS traced the same way (boards u and x, 400 pairs each)', () => {
    let seed = 99;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (const map of [u, buildMap([{ board: 'x', x: 0, y: 0 }])]) {
      const flat = [...map.hexes()].filter((h) => !h.elevation).map((h) => h.id);
      for (let i = 0; i < 400; i++) {
        const a = flat[Math.floor(rand() * flat.length)]!;
        const b = flat[Math.floor(rand() * flat.length)]!;
        if (a === b) continue;
        // The height tracer walks from the smaller hex id when the ends are level (A6.5); trace the SK LOS that way too.
        const [p, q] = a < b ? [a, b] : [b, a];
        const sk = map.los(p, q);
        const asl = map.losAt(at(p, 0), at(q, 0), AUGUST);
        expect(asl.clear, `${p}-${q}`).toBe(sk.clear);
        if (sk.clear) expect(asl.crossed.map((c) => c.hex), `${p}-${q}`).toEqual(sk.crossed.map((c) => c.hex));
      }
    }
    // 800 pixel traces each way: about 20 s on a loaded machine, so more than the default timeout.
  }, 120_000);
});
