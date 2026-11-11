import { describe, expect, it } from 'vitest';
import { newGame, scenarioById } from '@asl/content';
import { visibleState } from '../src/game/visibility';

describe('visibleState', () => {
  it('hides HIP pieces from the other side and from spectators, never from the owner', () => {
    const game = newGame(scenarioById('demo-gun-line')!, '1');
    const state = game.state;
    const env = game.engine.env(state);
    const gun = Object.values(state.pieces).find((p) => p.defId === 'ge.AT75L')!;
    const hidden = { ...state, pieces: { ...state.pieces, [gun.id]: { ...gun, tags: { ...gun.tags, hip: true } } } };
    const hEnv = game.engine.env(hidden);
    expect(visibleState(hEnv, hidden, 'ge').pieces[gun.id]).toBeDefined();
    expect(visibleState(hEnv, hidden, 'am').pieces[gun.id]).toBeUndefined();
    expect(visibleState(hEnv, hidden, null).pieces[gun.id]).toBeUndefined();
    // Nothing hidden: the same state object comes back (no rebuild of the board).
    expect(visibleState(env, state, 'am')).toBe(state);
  });
});
