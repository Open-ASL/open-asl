import { describe, expect, it } from 'vitest';
import { hashValue } from '@asl/engine';
import { SCENARIO, makeGame, playRandom } from './selfplay-lib';

describe('random self-play', () => {
  it('completes many games without illegal states, stalls or exceptions', { timeout: 60_000 }, () => {
    let finished = 0;
    for (let seed = 1; seed <= 25; seed++) {
      const { state } = playRandom(seed);
      if (state.result) finished++;
    }
    expect(finished).toBe(25);
  });

  it('is deterministic and replayable from its event log', () => {
    const a = playRandom(7);
    const b = playRandom(7);
    expect(hashValue(a.state)).toEqual(hashValue(b.state));
    const init = { scenarioId: SCENARIO.id, sides: ['am', 'ge'], attacker: 'am', seed: 'seed-7' };
    expect(a.engine.applyEvents(a.engine.initialState(init), a.log)).toEqual(a.state);
  });

  it('re-running the recorded actions reproduces the same events (verifiable replay)', () => {
    const a = playRandom(11);
    const { engine, state: s0 } = makeGame('seed-11');
    let state = s0;
    for (const act of a.actions) state = engine.submit(state, act).state;
    expect(hashValue(state)).toEqual(hashValue(a.state));
  });
});
