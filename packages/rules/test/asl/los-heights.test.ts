import { describe, expect, it } from 'vitest';
import { blindHexCount, blindHexesBehind, crestBlindHexCount, obstacleEffect, orchardHinders, SK1_TERRAIN, type HexTerrainSpec } from '../../src';
import { testMap } from '../fixtures';

/*
 * LOS with heights: the height rules themselves (ASLRB A6.2, A6.4–A6.43, B10.22, B10.23, B14.2) and the
 * hex-level tracer `HexGridMap.losAt` on synthetic maps, where hills of any level can be drawn. Board u has none above
 * level 1, so the Blind Hex examples of the rulebook are rebuilt here; the real boards are in content/test.
 * Column K of board y runs straight from K1 to K10, so the range from K1 is the row number less one.
 */

const map = (terrain: Record<string, HexTerrainSpec>) => {
  const m = testMap(terrain, 'y');
  return m;
};
const at = (hex: string, height: number) => ({ hex, height });

describe('The height test (ASLRB A6.2, B10.22, B23.2)', () => {
  it('an obstacle below both ends has no effect, one at or above the higher end blocks, one between is seen over', () => {
    // Ground-level woods (top 1): level 1 to level 1 sees over it (B10.22); level 1 to the ground does not (A6.2 EX).
    expect(obstacleEffect(1, 1, 1)).toBe('none');
    expect(obstacleEffect(1, 0, 1)).toBe('blocks');
    expect(obstacleEffect(1, 0, 0)).toBe('blocks');
    // A Two Story House (1½): level 1 cannot see past it at all, level 2 sees over it.
    expect(obstacleEffect(1.5, 1, 1)).toBe('blocks');
    expect(obstacleEffect(1.5, 0, 2)).toBe('over');
    // A half-level obstacle never blocks a higher Location (A6.21).
    expect(obstacleEffect(0.5, 0, 1)).toBe('over');
  });

  it('A6.41/A6.42 EX: a 1½-level obstacle 12 hexes away makes 3 Blind Hexes from level 2, 2 from level 3, 1 from level 4 up', () => {
    const o = { top: 1.5, range: 12 };
    expect([2, 3, 4, 5].map((hi) => blindHexCount(o, hi))).toEqual([3, 2, 1, 1]);
    // Within five hexes one Blind Hex, whatever the advantage (minimum one).
    expect(blindHexCount({ top: 1, range: 3 }, 6)).toBe(1);
  });

  it('A6.4: a hex at or above the full-level height of the obstacle is never blind (the ½ level is ignored)', () => {
    const house = { hex: 'yK3', terrain: 'building-stone', top: 1.5, hexLevel: 0, range: 2 };
    expect(blindHexesBehind(house, 2, 0, 0, 1)).toBe(true);
    expect(blindHexesBehind(house, 2, 1, 0, 1)).toBe(false);
  });

  it('B10.23 EX (C), (D), (E): Crest Line Blind Hexes', () => {
    // (C) level 4 Y6 sees EE3 over the level 1 Crest Line in DD3, five hexes away: the advantage takes its one Blind Hex.
    expect(crestBlindHexCount({ top: 1, range: 5 }, 4, 0)).toBe(0);
    // (D) the level 3 Crest Line in DD5 at five hexes keeps its Blind Hex against level 4.
    expect(crestBlindHexCount({ top: 3, range: 5 }, 4, 2)).toBe(1);
    // (E) the level 2 Crest Line in M7: two Blind Hexes from level 3 X6 at 11 hexes, one from level 4 Y6 at 12.
    expect(crestBlindHexCount({ top: 2, range: 11 }, 3, 1)).toBe(2);
    expect(crestBlindHexCount({ top: 2, range: 12 }, 4, 1)).toBe(1);
    // None within four hexes for a one-level drop; a drop of two makes one even there (not when adjacent).
    expect(crestBlindHexCount({ top: 1, range: 4 }, 2, 0)).toBe(0);
    expect(crestBlindHexCount({ top: 2, range: 3 }, 3, 0)).toBe(1);
    expect(crestBlindHexCount({ top: 2, range: 1 }, 3, 0)).toBe(0);
  });

  it('B10.23 EX (F)/(G) and A6.43: the hex behind lower than the obstacle\'s adds to the Blind Hexes, higher takes off', () => {
    // (F) level 1 woods on a level 1 hill (top 2) two hexes from a level 3 viewer: two Blind Hexes over level 0 ground.
    const woods = { hex: 'yCC3', terrain: 'woods', top: 2, hexLevel: 1, range: 2 };
    expect(blindHexesBehind(woods, 3, 0, 0, 2)).toBe(true);
    // (G) a building on a level 1 hill seen over by a level 3 unit: a level 1 hex two hexes behind it is not blind...
    const building = { hex: 'yO3', terrain: 'building-wood', top: 2, hexLevel: 1, range: 2 };
    expect(blindHexesBehind(building, 3, 1, 1, 2)).toBe(false);
    // ...but would be at level 0.
    expect(blindHexesBehind(building, 3, 0, 0, 2)).toBe(true);
  });

  it('B14.2: an orchard is a same-level +1; between a higher Location and its base an obstacle in season, else +1', () => {
    expect(orchardHinders(0, 0, 0, true, false)).toBe(true);
    expect(orchardHinders(0, 0, 1, true, false)).toBe('obstacle');
    expect(orchardHinders(0, 0, 1, false, false)).toBe(true);
    // Both ends above its base: seen over in season (B10.22), and so no Hindrance out of season either (reading).
    expect(orchardHinders(0, 1, 1, false, false)).toBe(false);
    // From more than one level above: only an orchard next to the lower end hinders.
    expect(orchardHinders(0, 0, 2, false, false)).toBe(false);
    expect(orchardHinders(0, 0, 2, false, true)).toBe(true);
  });
});

describe('The hex-level tracer HexGridMap.losAt', () => {
  it('a level 1 viewer sees over ground woods to level 1 beyond, not to the ground (B10.22, A6.2 EX)', () => {
    const m = map({ yK3: { terrain: 'woods' } });
    expect(m.losAt(at('yK1', 1), at('yK5', 1)).clear).toBe(true);
    const low = m.losAt(at('yK1', 1), at('yK5', 0));
    expect(low.clear).toBe(false);
    expect(low.obstacle).toEqual({ hex: 'yK3', terrain: 'woods' });
    expect(m.losAt(at('yK1', 0), at('yK5', 0)).clear).toBe(false);
  });

  it('a level 2 viewer sees over ground woods, but the hex right behind them is a Blind Hex (A6.4)', () => {
    const m = map({ yK1: { terrain: 'open', elevation: 2 }, yK3: { terrain: 'woods' } });
    const blind = m.losAt(at('yK1', 2), at('yK4', 0));
    expect(blind.clear).toBe(false);
    expect(blind.obstacle).toEqual({ hex: 'yK3', terrain: 'woods', blind: true });
    expect(m.losAt(at('yK1', 2), at('yK5', 0)).clear).toBe(true);
    // A unit on level 1 of a house in the Blind Hex is at the woods' height: seen (A6.4, B10.22).
    expect(m.losAt(at('yK1', 2), at('yK4', 1)).clear).toBe(true);
  });

  it('A6.41: woods five hexes away make two Blind Hexes', () => {
    const m = map({ yK1: { terrain: 'open', elevation: 2 }, yK6: { terrain: 'woods' } });
    expect(['yK7', 'yK8', 'yK9'].map((h) => m.losAt(at('yK1', 2), at(h, 0)).clear)).toEqual([false, false, true]);
  });

  it('A6.43: a hex behind the obstacle lower than the obstacle\'s hex is blind farther out, a higher one less', () => {
    const m = map({ yK1: { terrain: 'open', elevation: 3 }, yK3: { terrain: 'woods', elevation: 1 }, yK4: { terrain: 'open', elevation: 1 } });
    // Woods on level 1 (top 2) seen from level 3: one Blind Hex over level 1 ground, two over level 0.
    expect(m.losAt(at('yK1', 3), at('yK4', 1)).clear).toBe(false);
    expect(m.losAt(at('yK1', 3), at('yK5', 0)).clear).toBe(false);
    expect(m.losAt(at('yK1', 3), at('yK6', 0)).clear).toBe(true);
  });

  it('a Two Story House (1½ levels) blocks a level 1 viewer even to level 1 beyond it; level 2 sees over it', () => {
    const house = { terrain: 'building-stone', obstacleHeight: 1.5 };
    const m = map({ yK1: { terrain: 'open', elevation: 1 }, yK3: house, yK8: { terrain: 'open', elevation: 1 } });
    expect(m.losAt(at('yK1', 1), at('yK5', 1)).clear).toBe(false);
    expect(m.losAt(at('yK1', 2), at('yK5', 1)).clear).toBe(true);
    expect(m.losAt(at('yK1', 2), at('yK4', 0)).obstacle).toEqual({ hex: 'yK3', terrain: 'building-stone', blind: true });
    // A Single Story House is only one level: level 1 sees level 1 beyond it.
    const flat = map({ yK3: { terrain: 'building-stone' } });
    expect(flat.losAt(at('yK1', 1), at('yK5', 1)).clear).toBe(true);
  });

  it('hill ground is an obstacle of its level: a ridge between two ground hexes blocks; hill ends see across it and across a valley (B10.2, B10.21)', () => {
    const m = map({ yK3: { terrain: 'open', elevation: 1 }, yK1: { terrain: 'open', elevation: 1 }, yK6: { terrain: 'open', elevation: 1 } });
    const ridge = m.losAt(at('yK2', 0), at('yK4', 0));
    expect(ridge.clear).toBe(false);
    expect(ridge.crest).toBe(true);
    // Same-level hill ends see across an equal Crest Line between them (B10.21).
    expect(m.losAt(at('yK1', 1), at('yK6', 1)).clear).toBe(true);
    const valley = map({ yK1: { terrain: 'open', elevation: 1 }, yK3: { terrain: 'woods' }, yK6: { terrain: 'open', elevation: 1 } });
    expect(valley.losAt(at('yK1', 1), at('yK6', 1)).clear).toBe(true);
  });

  it('Hindrances count only between same-level ends at their level (A6.7, B12.2, B15.2)', () => {
    const m = map({ yK3: { terrain: 'brush' } });
    expect(m.losAt(at('yK1', 0), at('yK5', 0)).crossed.map((c) => c.hex)).toEqual(['yK3']);
    expect(m.losAt(at('yK1', 1), at('yK5', 0)).crossed).toEqual([]);
    expect(m.losAt(at('yK1', 1), at('yK5', 1)).crossed).toEqual([]);
  });

  it('an orchard in season blocks a level 1 viewer looking down past it; out of season it is +1 (B14.2)', () => {
    const m = map({ yK3: { terrain: 'orchard' } });
    expect(m.losAt(at('yK1', 1), at('yK5', 0), { orchardInSeason: true }).clear).toBe(false);
    const out = m.losAt(at('yK1', 1), at('yK5', 0), { orchardInSeason: false });
    expect(out.clear).toBe(true);
    expect(out.crossed.map((c) => c.terrain)).toEqual(['orchard']);
    expect(m.losAt(at('yK1', 0), at('yK5', 0), { orchardInSeason: true }).crossed.map((c) => c.terrain)).toEqual(['orchard']);
  });

  it('is the same both ways (A6.5), from one cache entry', () => {
    const m = map({ yK1: { terrain: 'open', elevation: 2 }, yK3: { terrain: 'woods' } });
    expect(m.losAt(at('yK4', 0), at('yK1', 2))).toBe(m.losAt(at('yK1', 2), at('yK4', 0)));
    expect(m.losAt(at('yK5', 0), at('yK1', 0))).toBe(m.losAt(at('yK1', 0), at('yK5', 0)));
  });

  it('the terrain heights are data: woods and buildings 1, an orchard 1, stone rubble ½', () => {
    expect(['woods', 'building-stone', 'building-wood', 'orchard', 'rubble-stone'].map((t) => SK1_TERRAIN[t]!.height)).toEqual([1, 1, 1, 1, 0.5]);
  });
});
