import { describe, expect, it } from 'vitest';
import type { Engine, GameState, RuleModule } from '@asl/engine';
import { aslCoreModules, moveState, piecesModule, turnModule } from '../../src';
import { sk1CoreModules } from '../../src/sk1';
import { sk2CoreModules } from '../../src/sk2';
import { sk3CoreModules } from '../../src/sk3';
import { act, makeEngine, type PieceSpec } from '../fixtures';

/*
 * Double Time declared after MF were spent (ASLRB A4.5 EXC): one MF more, CX at once, with A4.5's limits. Board u, all Open
 * Ground; the Germans move first.
 */

const SK: RuleModule[] = [piecesModule, turnModule, ...sk1CoreModules, ...sk2CoreModules, ...sk3CoreModules];
const ASL: RuleModule[] = [...SK, ...aslCoreModules];
const GE_RU = { firstSide: 'ge', sides: [{ side: 'ge', name: 'German', nationality: 'ge', elr: 3 }, { side: 'ru', name: 'Russian', nationality: 'ru', elr: 3 }] };

function game(pieces: PieceSpec[], asl = true) {
  return makeEngine({ board: 'u', scenario: GE_RU, modules: asl ? ASL : SK, startPhase: 'MPh', pieces: [...pieces, { id: 'r', def: 'ru.447', side: 'ru', hex: 'uA1' }] });
}
const check = (engine: Engine, s: GameState, a: Record<string, unknown>) => {
  const d = engine.currentDecision(s)!;
  return engine.validate(s, { side: d.owner, decisionId: d.id, ...a } as never);
};
const passAll = (engine: Engine, s0: GameState) => {
  let s = s0;
  for (let i = 0; i < 20 && engine.currentDecision(s)?.owner === 'ru'; i++) s = act(engine, s, { type: 'defPass' }).state;
  return s;
};
const step = (engine: Engine, s: GameState, to: string) => passAll(engine, act(engine, s, { type: 'move.step', to }).state);

describe('A4.5 Double Time declared during the move', () => {
  it('a squad that has spent two MF declares it: one MF more (5), CX at once', () => {
    const { engine, state } = game([{ id: 'g', def: 'ge.467', side: 'ge', hex: 'uQ3' }]);
    let s = act(engine, state, { type: 'move.start', units: ['g'] }).state;
    s = step(engine, step(engine, s, 'uQ4'), 'uQ5');
    expect(engine.legalActions(s, 'ge')).toContainEqual(expect.objectContaining({ type: 'move.doubleTime', units: ['g'] }));
    s = act(engine, s, { type: 'move.doubleTime', units: ['g'] }).state;
    expect(s.pieces['g']!.tags['cx']).toBe(true);
    const ms = moveState(engine.env(s))!;
    expect(ms.allowance['g']).toBe(5);
    expect(ms.spent['g']).toBe(2);
    s = step(engine, step(engine, step(engine, s, 'uQ6'), 'uQ7'), 'uQ8');
    expect(check(engine, s, { type: 'move.step', to: 'uQ9' })).toMatch(/lacks the MF \(0\)/);
  });

  it('the CX IPC is one lower: a squad with a MMG (4 PP) gains nothing, the extra PP costing the MF it gains (A4.52)', () => {
    const { engine, state } = game([{ id: 'g', def: 'ge.467', side: 'ge', hex: 'uQ5' }, { id: 'mmg', def: 'ge.MMG', side: 'ge', heldBy: 'g' }]);
    let s = act(engine, state, { type: 'move.start', units: ['g'] }).state;
    expect(moveState(engine.env(s))!.allowance['g']).toBe(3);
    s = act(engine, step(engine, s, 'uQ6'), { type: 'move.doubleTime', units: ['g'] }).state;
    expect(moveState(engine.env(s))!.allowance['g']).toBe(3);
  });

  it('a leader and a squad with him: 6 + 1 = 7 each, never past eight (A4.5)', () => {
    const { engine, state } = game([{ id: 'l', def: 'ge.L91', side: 'ge', hex: 'uQ5' }, { id: 'g', def: 'ge.467', side: 'ge', hex: 'uQ5' }]);
    let s = act(engine, state, { type: 'move.start', units: ['g', 'l'] }).state;
    s = act(engine, step(engine, s, 'uQ6'), { type: 'move.doubleTime', units: ['g', 'l'] }).state;
    expect(moveState(engine.env(s))!.allowance).toEqual({ g: 7, l: 7 });
  });

  it('refused to a unit already CX by Double Time at the start, to an Assault Moving stack, and to a unit that was CX when the MPh began (A4.5, A4.51, A4.61)', () => {
    const { engine, state } = game([
      { id: 'g', def: 'ge.467', side: 'ge', hex: 'uQ5' },
      { id: 'h', def: 'ge.467', side: 'ge', hex: 'uK5' },
      { id: 'c', def: 'ge.467', side: 'ge', hex: 'uF5', tags: { cxPrev: true } },
    ]);
    let s = act(engine, state, { type: 'move.start', units: ['g'], doubleTime: true }).state;
    s = step(engine, s, 'uQ6');
    expect(check(engine, s, { type: 'move.doubleTime', units: ['g'] })).toMatch(/already Double Timing/);
    s = passAll(engine, act(engine, s, { type: 'move.end' }).state);
    s = act(engine, s, { type: 'move.start', units: ['h'], assault: true }).state;
    expect(check(engine, s, { type: 'move.doubleTime', units: ['h'] })).toBe('Assault Movement cannot be voluntarily voided (ASLRB A4.61)');
    s = passAll(engine, act(engine, s, { type: 'move.end' }).state);
    s = step(engine, act(engine, s, { type: 'move.start', units: ['c'] }).state, 'uF6');
    expect(check(engine, s, { type: 'move.doubleTime', units: ['c'] })).toMatch(/A4\.51/);
  });

  it('every start option is offered: the plain start, Double Time and Assault Movement (A4.5, A4.61); the Starter Kit list keeps the plain starts', () => {
    const starts = (asl: boolean) => {
      const { engine, state } = game([{ id: 'g', def: 'ge.467', side: 'ge', hex: 'uQ5' }], asl);
      return engine.legalActions(state, 'ge').filter((a) => a.type === 'move.start').map(({ units, doubleTime, assault }) => ({ units, ...(doubleTime ? { doubleTime } : {}), ...(assault ? { assault } : {}) }));
    };
    expect(starts(true)).toEqual([{ units: ['g'] }, { units: ['g'], doubleTime: true }, { units: ['g'], assault: true }]);
    expect(starts(false)).toEqual([{ units: ['g'] }]);
  });

  it('the Starter Kit has no such declaration (SK1 3.3: "at the beginning of that unit\'s MPh")', () => {
    const { engine, state } = game([{ id: 'g', def: 'ge.467', side: 'ge', hex: 'uQ5' }], false);
    const s = step(engine, act(engine, state, { type: 'move.start', units: ['g'] }).state, 'uQ6');
    expect(engine.legalActions(s, 'ge').some((a) => a.type === 'move.doubleTime')).toBe(false);
    expect(check(engine, s, { type: 'move.doubleTime', units: ['g'] })).toBeTruthy();
  });
});
