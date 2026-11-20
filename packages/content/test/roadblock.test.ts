import { describe, expect, it } from 'vitest';
import { heightOf, roadblockObstacles, statics } from '@asl/rules';
import { ASL_TESTBED_SCENARIO, FixtureBuilder, fixtureActions, newGame } from '../src';

/*
 * The roadblock on the T1 test bed's O9–P8 road hexside against the board's own LOS data (ASLRB B29.2, B9.2, A6.21): a
 * same-level thread across the hexside is blocked at the bar where the terrain alone leaves it open, a thread from either
 * of its own hexes never is, and the Starter Kit (which passes no hexside obstacles) traces exactly as before.
 */

function fixture(id: string) {
  const g = newGame(ASL_TESTBED_SCENARIO, 'roadblock-test');
  let s = g.state;
  for (const a of fixtureActions(g.engine, s, id)) s = g.engine.submit(s, a).state;
  return new FixtureBuilder(g.engine, s);
}

describe('the roadblock on the board-u pixel LOS (B29.2)', () => {
  it('blocks same-level threads across it that the terrain leaves open; its hexside never blocks a thread from its own two hexes', () => {
    const f = fixture('fort-placed');
    const env = f.engine.env(f.state);
    const map = statics(env).map;
    const [o] = roadblockObstacles(env);
    expect(o).toMatchObject({ a: 'uO9', b: 'uP8' });
    const near = [...map.hexes()].filter((h) => map.distance(h.id, 'uO9') <= 4).map((h) => h.id);
    let blocked = 0;
    for (const x of near)
      for (const y of near) {
        if (x >= y || heightOf(env, x) !== heightOf(env, y) || heightOf(env, x) !== o!.level) continue;
        const ends = [{ hex: x, height: heightOf(env, x) }, { hex: y, height: heightOf(env, y) }] as const;
        const bare = map.losAt!(ends[0], ends[1], {});
        const withBar = map.losAt!(ends[0], ends[1], { hexsides: [o!] });
        if ([x, y].some((h) => h === o!.a || h === o!.b)) {
          // Its own hexside never blocks (B9.2); only the extension into a third hex can (B29.2: part of the obstacle).
          if (bare.clear && !withBar.clear) expect(withBar.hexsides?.some((c) => c.extension?.length), `${x}-${y}`).toBe(true);
          continue;
        }
        if (bare.clear && !withBar.clear) {
          blocked++;
          expect(withBar.obstacle).toMatchObject({ terrain: 'roadblock', hexside: ['uO9', 'uP8'] });
          expect(withBar.blockedAt).toBeDefined();
        }
        // Never clearer with the bar than without it.
        if (!bare.clear) expect(withBar.clear).toBe(false);
      }
    expect(blocked).toBeGreaterThan(0);
  });
});
