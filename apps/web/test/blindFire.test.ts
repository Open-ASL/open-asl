import { describe, expect, it } from 'vitest';
import type { Engine, GameState } from '@asl/engine';
import { makeEngine } from '../../../packages/rules/test/fixtures';
import { beyondRange, blindFireOffered } from '../src/game/fireSelection';

describe('blind fire at a hex where no enemy is seen', () => {
  const pieces = [
    { id: 'a1', def: 'am.666', side: 'am', hex: 'yP5' },
    { id: 'aMMG', def: 'am.MMG', side: 'am', hex: 'yP7' },
    { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yN5' },
  ];
  const { engine, state } = makeEngine({ pieces, startPhase: 'PFPh' }) as { engine: Engine; state: GameState };
  const env = engine.env(state);

  it('is offered at an empty hex, and at one holding only an unpossessed weapon', () => {
    expect(blindFireOffered(env, 'yP6', 'am')).toBe(true);
    expect(blindFireOffered(env, 'yP7', 'am')).toBe(true);
  });

  it('is not offered at a hex holding the firer’s own unit: nothing hidden can be there (A12.15)', () => {
    expect(blindFireOffered(env, 'yP5', 'am')).toBe(false);
    expect(blindFireOffered(env, 'yN5', 'ge')).toBe(false);
  });

  it('is not offered at an off-board hex: fire attacks Locations on the map (ASLRB A2.6), and the range check does not throw', () => {
    // yP11 is the imaginary hex beyond the board edge, drawn for entry and exit but not a map hex.
    expect(blindFireOffered(env, 'yP11', 'am')).toBe(false);
    expect(() => beyondRange(env, { units: ['a1'], target: 'yP11' })).not.toThrow();
    expect(beyondRange(env, { units: ['a1'], target: 'yP11' })).toEqual([]);
  });
});
