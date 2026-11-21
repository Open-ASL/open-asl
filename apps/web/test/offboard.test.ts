import { describe, expect, it } from 'vitest';
import type { Action, Engine, GameState } from '@asl/engine';
import { statics } from '@asl/rules';
import { sk2CoreModules } from '../../../packages/rules/src/sk2';
import { sk3CoreModules } from '../../../packages/rules/src/sk3';
import { RU_VS_GE, act, makeEngine } from '../../../packages/rules/test/fixtures';
import { offboardShown, offboardStepKey } from '../src/game/offboard';

/*
 * A Recalled AFV "must attempt to exit the playing area along a friendly board edge" (SK4 7.10), whatever the scenario's
 * exit rules. In a scenario with no entry edge and no exit hexes the board drew no offboard hex, so the step off the map
 * the rules allowed could not be clicked, and the AFV could only turn in place. Board y: the S edge is hexrow 10, the
 * Russians set up against it.
 */
describe('offboard hexes on the board', () => {
  const scenario = {
    ...RU_VS_GE,
    forces: [
      { id: 'ru', group: 'Russians', side: 'ru', units: [], setup: { kind: 'area', description: 'row 10', hexes: ['yM10'] } },
      { id: 'ge', group: 'Germans', side: 'ge', units: [], setup: { kind: 'area', description: 'row 1', hexes: ['yM1'] } },
    ],
  };
  const t34 = { id: 't34', def: 'ru.T34M43', side: 'ru', hex: 'yM10', tags: { vca: 3, ca: 3, recall: true, maDisabled: true } };
  const { engine, state } = makeEngine({ pieces: [t34, { id: 'ge1', def: 'ge.467', side: 'ge', hex: 'yGG2' }], scenario: scenario as never, extra: [...sk2CoreModules, ...sk3CoreModules], startPhase: 'MPh' }) as {
    engine: Engine;
    state: GameState;
  };
  const moving = act(engine, state, { type: 'vmove.start', vehicle: 't34' }).state;
  const map = statics(engine.env(moving)).map;
  const legal = (s: GameState) => engine.legalActions(s, s.attacker) as Action[];

  it('draws the offboard hex a Recalled AFV at its friendly board edge may step into, in a scenario with no exits (SK4 7.10)', () => {
    const steps = offboardStepKey(legal(moving), map).split(',').filter(Boolean);
    expect(steps.length).toBeGreaterThan(0);
    for (const o of steps) expect(map.offboardNeighbors(o).onboard).toContain('yM10');
    // Entry edges and exit hexes alone, as the board drew them before, give nothing here.
    expect(offboardShown(map, '', '', '')).toEqual([]);
    expect(offboardShown(map, '', '', steps.join(',')).map((h) => h.id)).toEqual(steps);
    // The step works: the AFV leaves the map.
    const off = act(engine, moving, { type: 'move.step', to: steps[0]! }).state;
    expect(off.pieces['t34']!.loc).toMatchObject({ kind: 'offboard' });
  });

  it('draws none before it moves, nor for any other unit', () => {
    expect(offboardStepKey(legal(state), map)).toBe('');
  });

  it('keeps the entry edges and the hexes beyond the exit hexes, each once', () => {
    const south = map.offboard('S').map((h) => h.id);
    const shown = offboardShown(map, 'S', 'yM10', south[0]!).map((h) => h.id);
    expect(shown).toEqual(south);
  });
});
