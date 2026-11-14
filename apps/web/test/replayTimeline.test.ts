import { describe, expect, it } from 'vitest';
import type { GameState } from '@asl/engine';
import { makeEngine } from '../../../packages/rules/test/fixtures';
import { extendReplay, nextTurnStep, prevTurnStep, turnMarks, type ReplayFrame } from '../src/match/replayTimeline';

/** Frames carrying only what the timeline reads: the phase, the Game Turn and the ATTACKER. */
const frames = (spec: [phase: string, turn: number, attacker: string][]): ReplayFrame[] =>
  spec.map(([phase, turn, attacker]) => ({ state: { phase, turn, attacker } as GameState, logLen: 0 }));

describe('the replay timeline', () => {
  const game = frames([
    ['setup', 0, 'ge'],
    ['setup', 0, 'ge'],
    ['RPh', 1, 'ge'],
    ['MPh', 1, 'ge'],
    ['RPh', 1, 'ru'],
    ['MPh', 1, 'ru'],
    ['RPh', 2, 'ge'],
    ['PFPh', 2, 'ge'],
  ]);
  const marks = turnMarks(game);

  it('marks where each Player Turn begins, the first of each Game Turn as a turn, and nothing during setup', () => {
    expect(marks).toEqual([
      { step: 2, turn: 1, side: 'ge', gameTurn: true },
      { step: 4, turn: 1, side: 'ru', gameTurn: false },
      { step: 6, turn: 2, side: 'ge', gameTurn: true },
    ]);
  });

  it('a previous-turn jump goes to the start of this Player Turn, or the one before when already there', () => {
    expect(prevTurnStep(marks, 5)).toBe(4);
    expect(prevTurnStep(marks, 4)).toBe(2);
    expect(prevTurnStep(marks, 2)).toBe(0);
    expect(prevTurnStep(marks, 1)).toBe(0);
  });

  it('a next-turn jump goes to the start of the next Player Turn, or the end after the last', () => {
    expect(nextTurnStep(marks, 0, 7)).toBe(2);
    expect(nextTurnStep(marks, 2, 7)).toBe(4);
    expect(nextTurnStep(marks, 6, 7)).toBe(7);
  });
});

describe('a replay carried on through newly recorded actions', () => {
  it('replays only the new actions, keeping every earlier step', () => {
    const { engine, state } = makeEngine({ startPhase: 'RPh', pieces: [{ id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP5' }] });
    const created = engine.createGame({ scenarioId: 'test', sides: state.sides, attacker: state.attacker, seed: 'test' });
    const start = { engine, frames: [{ state, logLen: created.events.length }], log: [...created.events], error: null };
    const end = (s: GameState) => ({ type: 'endPhase', side: engine.currentDecision(s)!.owner, decisionId: engine.currentDecision(s)!.id });
    const one = extendReplay(start, [end(state)]);
    expect(one.frames).toHaveLength(2);
    expect(one.frames[1]!.state.seq).toBeGreaterThan(state.seq);
    expect(extendReplay(one, [end(state)])).toBe(one);
    const two = extendReplay(one, [end(state), end(one.frames[1]!.state)]);
    expect(two.frames).toHaveLength(3);
    expect(two.frames[1]).toBe(one.frames[1]);
    expect(two.frames[2]!.logLen).toBe(two.log.length);
    expect(two.error).toBeNull();
  });

  it('stops before an action that no longer replays, keeping the steps before it', () => {
    const { engine, state } = makeEngine({ startPhase: 'RPh', pieces: [{ id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP5' }] });
    const created = engine.createGame({ scenarioId: 'test', sides: state.sides, attacker: state.attacker, seed: 'test' });
    const start = { engine, frames: [{ state, logLen: created.events.length }], log: [...created.events], error: null };
    const r = extendReplay(start, [{ type: 'endPhase', side: state.attacker, decisionId: 'nope' }]);
    expect(r.frames).toHaveLength(1);
    expect(r.error).toMatch(/does not replay/);
  });
});
