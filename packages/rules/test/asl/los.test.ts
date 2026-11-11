import { describe, expect, it } from 'vitest';
import type { RuleModule } from '@asl/engine';
import { aslCoreModules, heightAdvantageHex, interdicted, piecesModule, turnModule, type HexTerrainSpec } from '../../src';
import { sk1CoreModules } from '../../src/sk1';
import { sk2CoreModules } from '../../src/sk2';
import { sk3CoreModules } from '../../src/sk3';
import { RU_VS_GE, act, makeEngine, type PieceSpec } from '../fixtures';
import { testFire } from './helpers';

/*
 * LOS with heights in the full ASL ruleset (asl/los.ts): 'los.trace' between the Locations' heights, and
 * every LOS a unit traces (fire, Defensive First Fire, Interdiction, victory LOS) starting from its own Location. Board
 * u's hexrow K with its K4–K5 Two Story House (B23.22), another house at K9–K10, woods, brush and a level 1 hill, on
 * the hex-level map (the pixel map is content/test/losHeights.test.ts).
 */

const TWO = { upper: 1 as const, stairwell: 'inherent' as const };
const MAP: Record<string, HexTerrainSpec> = {
  uK1: { terrain: 'open', elevation: 1 },
  uK2: { terrain: 'open', elevation: 1 },
  uK4: { terrain: 'building-stone', buildingId: 'u-B16', building: TWO, obstacleHeight: 1.5 },
  uK5: { terrain: 'building-stone', buildingId: 'u-B16', building: TWO, obstacleHeight: 1.5 },
  uK7: { terrain: 'woods' },
  uK9: { terrain: 'building-wood', buildingId: 'u-B99', building: TWO, obstacleHeight: 1.5 },
  uK10: { terrain: 'building-wood', buildingId: 'u-B99', building: TWO, obstacleHeight: 1.5 },
  uM6: { terrain: 'brush' },
};
const SK: RuleModule[] = [piecesModule, turnModule, ...sk1CoreModules, ...sk2CoreModules, ...sk3CoreModules];
const ASL: RuleModule[] = [...SK, ...aslCoreModules];

const game = (pieces: PieceSpec[], opts: { asl?: boolean; terrain?: Record<string, HexTerrainSpec> } = {}) =>
  makeEngine({ board: 'u', terrain: opts.terrain ?? MAP, scenario: RU_VS_GE, modules: opts.asl === false ? SK : ASL, extra: [testFire], pieces });
const losOf = (pieces: PieceSpec[] = [], opts: { asl?: boolean; terrain?: Record<string, HexTerrainSpec> } = {}) => {
  const { engine, state } = game(pieces, opts);
  const env = engine.env(state);
  return (from: string, to: string) => env.query('los.trace', { from, to }, { clear: true, hindrance: 0, parts: [] });
};

describe('LOS between Location heights (ASLRB A6.2, B10.22, B23.2)', () => {
  it('level 1 sees over ground-level woods to level 1 beyond, not to the ground beyond', () => {
    const los = losOf();
    expect(los('uK5:1', 'uK9:1').clear).toBe(true);
    const low = los('uK5:1', 'uK8');
    expect(low.clear).toBe(false);
    expect(low.blockedBy).toBe('Woods in uK7');
    expect(los('uK5', 'uK9:1').clear).toBe(false);
  });

  it('a Two Story House is 1½ levels: level 1 cannot see past it, even to level 1 (B23.22)', () => {
    const los = losOf();
    const r = los('uK2', 'uK9:1');
    expect(r.clear).toBe(false);
    expect(r.blockedBy).toBe('Two Story House in uK4');
  });

  it('a level 1 hill hex and level 1 of a house see each other; ground-level brush between hinders neither (B12.2)', () => {
    const los = losOf();
    expect(los('uK2', 'uK4:1').clear).toBe(true);
    const brush = { ...MAP, uK3: { terrain: 'brush' } };
    expect(losOf([], { terrain: brush })('uK5:1', 'uK2').hindrance).toBe(0);
    expect(losOf([], { terrain: brush })('uK2', 'uK4').hindrance).toBe(0);
  });

  it('Blind Hex: from level 1 of a house on the hill (height 2) the ground right behind the K4–K5 house is blind (A6.4)', () => {
    const hillHouse = { ...MAP, uK1: { terrain: 'building-wood', buildingId: 'u-B98', building: TWO, obstacleHeight: 1.5, elevation: 1 }, uJ1: { terrain: 'building-wood', buildingId: 'u-B98', building: TWO, obstacleHeight: 1.5, elevation: 1 } };
    const los = losOf([], { terrain: hillHouse });
    const blind = los('uK1:1', 'uK6');
    expect(blind.clear).toBe(false);
    expect(blind.blockedBy).toBe('a Blind Hex behind the Two Story House in uK5 (ASLRB A6.4)');
    // Level 1 of K9, behind the woods in K7, is at the full-level height of both obstacles: seen (A6.4).
    expect(los('uK1:1', 'uK9:1').clear).toBe(true);
    // The ground of the hill house sees nothing past the K4–K5 house (height 1 < 1½).
    expect(los('uK1', 'uK6').clear).toBe(false);
  });

  it('Starter Kit: the same hexes are traced at ground level as before', () => {
    const los = losOf([], { asl: false });
    expect(los('uK5', 'uK8').clear).toBe(false);
    expect(los('uK2', 'uK9').clear).toBe(false);
  });
});

describe('Units trace LOS from their own Location (ASLRB A6.1)', () => {
  it('a squad on level 1 of K4 fires at level 1 of K5 (ADJACENT, B23.25): the attack is made, from K4:1', () => {
    const { engine, state } = game([
      { id: 'r', def: 'ru.447', side: 'ru', hex: 'uK4', level: 1 },
      { id: 'g', def: 'ge.467', side: 'ge', hex: 'uK5', level: 1 },
    ]);
    const t = act(engine, state, { type: 'test.fire', decl: { units: ['r'], sw: [], target: 'uK5:1' }, mode: 'prep' });
    const attack = t.events.find((e) => e.type === 'sk1.fire.attack');
    expect(t.events.some((e) => e.type === 'sk1.fire.noLos')).toBe(false);
    expect((attack?.payload as Record<string, unknown>)['from']).toEqual(['uK4:1']);
  });

  it('a squad on level 1 firing past ground woods at the ground beyond has no LOS, and the event names its Location', () => {
    const { engine, state } = game([
      { id: 'r', def: 'ru.447', side: 'ru', hex: 'uK5', level: 1 },
      { id: 'g', def: 'ge.467', side: 'ge', hex: 'uK8' },
    ]);
    const t = act(engine, state, { type: 'test.fire', decl: { units: ['r'], sw: [], target: 'uK8' }, mode: 'prep' });
    const noLos = t.events.find((e) => e.type === 'sk1.fire.noLos');
    expect((noLos?.payload as Record<string, unknown>)['from']).toEqual(['uK5:1']);
    expect((noLos?.payload as Record<string, unknown>)['blockedBy']).toEqual(['Woods in uK7']);
  });

  it('Interdiction from level 1: ground-level brush between does not hinder it, so it interdicts (A10.53, A6.7)', () => {
    const pieces = (level?: number): PieceSpec[] => [{ id: 'g', def: 'ge.467', side: 'ge', hex: 'uK5', ...(level ? { level } : {}) }];
    const env = (level?: number) => {
      const g = game(pieces(level));
      return g.engine.env(g.state);
    };
    // The thread K5–O7 runs through the brush in M6: a Hindrance from the ground (no FFMO, no Interdiction), not from level 1.
    expect(interdicted(env(), 'ru', 'uO7').map((p) => p.id)).toEqual([]);
    expect(interdicted(env(1), 'ru', 'uO7').map((p) => p.id)).toEqual(['g']);
  });

  it('Height Advantage compares Location heights (B10.31): level 1 of a ground-level house is not lower than a level 1 hill hex', () => {
    const { engine, state } = game([]);
    const env = engine.env(state);
    expect(heightAdvantageHex(env, 'uK2', ['uK4'])).toBe(true);
    expect(heightAdvantageHex(env, 'uK2', ['uK4:1'])).toBe(false);
  });
});
