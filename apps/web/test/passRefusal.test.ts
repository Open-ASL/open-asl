import { describe, expect, it } from 'vitest';
import type { Action, Engine, GameState } from '@asl/engine';
import { makeEngine } from '../../../packages/rules/test/fixtures';
import { passRefusal } from '../src/game/passRefusal';

/**
 * A SW changes hands only between Good Order units in the RPh (SK1 3.1d) or at the start of the APh (ASLRB A4.431). The
 * wheel keeps a "Pass" entry greyed with the engine's reason when a unit of ours here may not take it, so a SW held by a
 * broken squad is not simply missing from the menu.
 */
const refusal = (engine: Engine, s: GameState, sw: string, to: string) => {
  const d = engine.currentDecision(s)!;
  return engine.validate(s, { type: 'rally.transfer', sw, to, side: 'am', decisionId: d.id } as Action);
};

describe('the greyed Pass entry for a SW no unit here may take', () => {
  const game = (holderTags: Record<string, boolean>, startPhase = 'RPh') =>
    makeEngine({
      startPhase,
      pieces: [
        { id: 'a1', def: 'am.666', side: 'am', hex: 'yN5', tags: holderTags },
        { id: 'a2', def: 'am.666', side: 'am', hex: 'yN5' },
        { id: 'aMMG', def: 'am.MMG', side: 'am', heldBy: 'a1' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP9' },
      ],
    });

  it('a broken squad in the RPh: greyed, with the reason', () => {
    const { engine, state } = game({ broken: true });
    const d = engine.currentDecision(state)!;
    const why = passRefusal(state.phase, d.kind, d.owner === 'am', [refusal(engine, state, 'aMMG', 'a2')]);
    expect(why).toMatch(/Both units must be Good Order/);
  });

  it('left out when a unit may take it (the entry is offered), when no other unit is here, and outside the RPh/APh or the player\'s own decision', () => {
    const { engine, state } = game({});
    const d = engine.currentDecision(state)!;
    expect(refusal(engine, state, 'aMMG', 'a2')).toBeNull();
    expect(passRefusal(state.phase, d.kind, true, [null])).toBeNull();
    expect(passRefusal('RPh', 'phase', true, [])).toBeNull();
    expect(passRefusal('MPh', 'phase', true, ['SW transfer is only possible in the RPh or APh'])).toBeNull();
    expect(passRefusal('RPh', 'phase', false, ['Both units must be Good Order (and unpinned)'])).toBeNull();
    expect(passRefusal('RPh', 'firstFire', true, ['Both units must be Good Order (and unpinned)'])).toBeNull();
  });

  it('one line per distinct reason', () => {
    expect(passRefusal('APh', 'phase', true, ['Both units must be Good Order (and unpinned)', 'Both units must be Good Order (and unpinned)', 'A SMC may never carry more than 2 PP'])).toBe(
      'Both units must be Good Order (and unpinned); A SMC may never carry more than 2 PP',
    );
  });
});
