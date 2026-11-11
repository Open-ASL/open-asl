import { describe, expect, it } from 'vitest';
import type { QueryEnv } from '@asl/engine';
import { locationsOf, type Statics } from '@asl/rules';
import { ASL_TESTBED_SCENARIO, BUILDING_LEVELS, availableBoards, boardHexes, buildMap, newGame, scenarioById } from '../src';

/*
 * Multi-level buildings: building levels come from the reviewed per-board table (buildingLevels.ts, judged from the board art by
 * ASLRB B23.21–23), not from VASL's terrain codes.
 */

const TWO_STORY_U = ['uG2', 'uH1', 'uI3', 'uI4', 'uI5', 'uK4', 'uK5', 'uL3', 'uM3', 'uL5', 'uM5', 'uL8', 'uM9', 'uM7', 'uN7', 'uP2', 'uP3'];

describe('building levels table (ASLRB B23.21–23)', () => {
  it('lists every building of every board, with the same hexes as the import', () => {
    for (const board of availableBoards()) {
      const imported: Record<string, string[]> = {};
      for (const [h, spec] of Object.entries(boardHexes(board))) if (spec.buildingId) (imported[spec.buildingId] ??= []).push(h);
      const table = BUILDING_LEVELS[board] ?? {};
      expect(Object.keys(table).sort(), board).toEqual(Object.keys(imported).sort());
      for (const [id, b] of Object.entries(table)) expect([...b.hexes].sort(), id).toEqual(imported[id]!.sort());
    }
  });

  it('a building is a Two Story House exactly when it is multi-hex (no stairwell is drawn on boards t–z)', () => {
    for (const [board, table] of Object.entries(BUILDING_LEVELS)) {
      for (const [id, b] of Object.entries(table)) {
        expect(b.kind, `${board} ${id}`).toBe(b.hexes.length > 1 ? 'two' : 'single');
        expect(b.stairwells, id).toBeUndefined();
      }
    }
  });

  it('board u: the 17 hexes of its eight Two Story Houses have level 1 and an inherent stairwell', () => {
    const map = buildMap([{ board: 'u', x: 0, y: 0 }]);
    const withLevel = [...map.hexes()].filter((h) => h.building?.upper).map((h) => h.id);
    expect(withLevel.sort()).toEqual([...TWO_STORY_U].sort());
    expect(map.hex('uK4')?.building).toEqual({ upper: 1, stairwell: 'inherent' });
    expect(map.hex('uK4')?.obstacleHeight).toBe(1.5);
    expect(map.hex('uH5')?.building).toBeUndefined();
  });

  it('full ASL: a Two Story House hex has level 1; the Starter Kit keeps every hex at ground level', () => {
    const asl = newGame(ASL_TESTBED_SCENARIO, 'levels');
    const envOf = (g: ReturnType<typeof newGame>): QueryEnv => g.engine.env(g.state);
    expect(locationsOf(envOf(asl), 'uK4')).toEqual(['uK4', 'uK4:1']);
    expect(locationsOf(envOf(asl), 'uH5')).toEqual(['uH5']);
    const sk = newGame(scenarioById('lma-6')!, 'levels');
    expect((sk.engine.statics as Statics).map.hex('uK4')?.building).toEqual({ upper: 1, stairwell: 'inherent' });
    expect(locationsOf(envOf(sk), 'uK4')).toEqual(['uK4']);
  });

  it('a building redrawn as rubble loses its levels (ASLRB B24.1)', () => {
    const map = buildMap([{ board: 'u', x: 0, y: 0 }], { redraw: [{ terrain: { 'building-stone': 'rubble-stone' } }] });
    expect(map.hex('uK4')?.terrain).toBe('rubble-stone');
    expect(map.hex('uK4')?.building).toBeUndefined();
    expect(map.hex('uK4')?.obstacleHeight).toBeUndefined();
    expect(map.hex('uG2')?.building).toEqual({ upper: 1, stairwell: 'inherent' });
  });
});
