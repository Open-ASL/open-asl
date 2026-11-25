import { describe, expect, it } from 'vitest';
import type { Engine, GameState } from '@asl/engine';
import { act, makeEngine } from '../../../packages/rules/test/fixtures';
import { addToGroupBlocked } from '../src/game/fireSelection';

/**
 * The wheel's "Add to fire group" on a stack that cannot join: every firing hex must be next to another holding a
 * squad, HS or crew of the group (SK1 3.2; a leader alone is no link). Offered as enabled, the engine refused the shot
 * only once the target was clicked. Two American stacks two hexes apart in one column, a German squad in range.
 */
describe('Add to fire group (SK1 3.2 contiguity)', () => {
  const base = [
    { id: 'a1', def: 'am.666', side: 'am', hex: 'yP3' },
    { id: 'a3', def: 'am.666', side: 'am', hex: 'yP5' },
    { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yL4' },
  ];
  const game = (extra: object[]) => makeEngine({ pieces: [...base, ...extra], dice: [6, 6, 6, 6], startPhase: 'PFPh' }) as { engine: Engine; state: GameState };
  const illegal = (engine: Engine, state: GameState, units: string[]) =>
    engine.env(state).query('fire.illegal', { decl: { units, sw: [], target: 'yL4' }, mode: 'prep', side: 'am' }, null);

  it('a stack two hexes from the group, with only broken units between, is greyed with the reason', () => {
    const { engine, state } = game([{ id: 'a2', def: 'am.666', side: 'am', hex: 'yP4', tags: { broken: true, dm: true } }]);
    const env = engine.env(state);
    expect(addToGroupBlocked(env, ['a1'], ['a3'])).toMatch(/adjacent.*SK1 3\.2/);
    // The wheel and the engine agree.
    expect(illegal(engine, state, ['a1', 'a3'])).toMatch(/contiguous/);
  });

  it('a leader alone between the stacks is no link, one firing a SW is (ASLRB A7.5)', () => {
    const { engine, state } = game([{ id: 'aL', def: 'am.L91', side: 'am', hex: 'yP4' }]);
    const env = engine.env(state);
    // The wheel's selection holds the leader with the units; he directs, he does not fire.
    expect(addToGroupBlocked(env, ['a1', 'aL'], ['a3'])).not.toBeNull();
    const withLmg = game([
      { id: 'aL', def: 'am.L91', side: 'am', hex: 'yP4' },
      { id: 'lmg', def: 'ge.LMG', side: 'am', heldBy: 'aL' },
    ]);
    expect(addToGroupBlocked(withLmg.engine.env(withLmg.state), ['a1', 'aL', 'lmg'], ['a3'])).toBeNull();
    expect(withLmg.engine.env(withLmg.state).query('fire.illegal', { decl: { units: ['a1', 'a3'], sw: ['lmg'], target: 'yL4' }, mode: 'prep', side: 'am' }, null)).toBeNull();
  });

  it('an adjacent stack may join, and one beyond it once the stack between has joined', () => {
    const { engine, state } = game([{ id: 'a2', def: 'am.666', side: 'am', hex: 'yP4' }]);
    const env = engine.env(state);
    expect(addToGroupBlocked(env, ['a1'], ['a2'])).toBeNull();
    expect(addToGroupBlocked(env, ['a1'], ['a3'])).not.toBeNull();
    expect(addToGroupBlocked(env, ['a1', 'a2'], ['a3'])).toBeNull();
    expect(illegal(engine, state, ['a1', 'a2', 'a3'])).toBeNull();
  });

  it('after the refusal the first stack still fires alone', () => {
    const { engine, state } = game([{ id: 'a2', def: 'am.666', side: 'am', hex: 'yP4', tags: { broken: true, dm: true } }]);
    const t = act(engine, state, { type: 'fire', decl: { units: ['a1'], sw: [], target: 'yL4' } });
    expect(t.state.pieces['a1']!.tags['fire']).toBe('prep');
    expect(t.state.pieces['a3']!.tags['fire']).toBeUndefined();
  });
});
