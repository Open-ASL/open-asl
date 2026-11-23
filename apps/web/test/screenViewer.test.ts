import { describe, expect, it } from 'vitest';
import { screenViewer } from '../src/game/visibility';

/*
 * Whose hidden units a game screen draws. A hotseat screen shows whoever is deciding, so neither player sees the
 * other's HIP Gun (SK4 6.4) during play; once the game is over there is nothing left to hide, and reviewing the board
 * shows every unit, the Gun the victory conditions turned on included.
 */
describe('who a game screen shows the game to', () => {
  it('a hotseat screen shows the deciding side while the game is on', () => {
    expect(screenViewer({}, 'am', false)).toBe('am');
    expect(screenViewer({}, 'ja', false)).toBe('ja');
    expect(screenViewer({}, undefined, false)).toBeNull();
  });

  it('a hotseat screen shows everything once the game is over', () => {
    expect(screenViewer({}, undefined, true)).toBe('all');
  });

  it('an online or computer seat keeps its own view after the game, and a commentator keeps their choice', () => {
    expect(screenViewer({ mySide: 'am' }, undefined, true)).toBe('am');
    expect(screenViewer({ mySide: null }, undefined, true)).toBeNull();
    expect(screenViewer({ mySide: 'am', seeAs: 'ja' }, 'am', false)).toBe('ja');
    expect(screenViewer({ mySide: null, seeAs: 'all' }, undefined, false)).toBe('all');
  });
});
