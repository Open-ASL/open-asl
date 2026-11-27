import { describe, expect, it } from 'vitest';
import type { Engine, GameState } from '@asl/engine';
import { sk2CoreModules } from '@asl/rules';
import { GE_VS_BR, act, makeEngine } from '../../../packages/rules/test/fixtures';
import { dcTargets, type DcPlacement } from '../src/game/dcTargets';

/** A German 4-4-7 with a DC in yN2 moves; a British squad far off in yC9. */
function game() {
  return makeEngine({
    scenario: GE_VS_BR,
    extra: sk2CoreModules,
    startPhase: 'MPh',
    pieces: [
      { id: 'g1', def: 'ge.447', side: 'ge', hex: 'yN2' },
      { id: 'dc', def: 'ge.DC', side: 'ge', heldBy: 'g1' },
      { id: 'b1', def: 'br.457', side: 'br', hex: 'yC9' },
    ],
  }) as { engine: Engine; state: GameState };
}
const targets = (engine: Engine, s: GameState) => dcTargets(engine.env(s), 'ge', (a: DcPlacement) => engine.validate(s, { ...a, side: 'ge', decisionId: engine.currentDecision(s)!.id } as never), false);
const pass = (engine: Engine, s: GameState) => {
  while (engine.currentDecision(s)?.kind === 'firstFire') s = act(engine, s, { type: 'defPass' }).state;
  return s;
};

describe('where the moving stack may place its DC (SK1 4.3)', () => {
  it('any adjacent hex while it has the MF to enter it; none, with the reason, once its MF are spent', () => {
    const { engine, state } = game();
    let s = pass(engine, act(engine, state, { type: 'move.start', units: ['g1'] }).state);
    s = pass(engine, act(engine, s, { type: 'move.step', to: 'yN3' }).state);
    expect(targets(engine, s)).toMatchObject({ why: null });
    expect(targets(engine, s).hexes).toHaveLength(6);
    for (const to of ['yN4', 'yN5', 'yN6']) s = pass(engine, act(engine, s, { type: 'move.step', to }).state);
    const spent = targets(engine, s);
    expect(spent.hexes).toEqual([]);
    expect(spent.why).toMatch(/MF/);
  });

  it('nothing to offer when no stack is moving', () => {
    const { engine, state } = game();
    expect(targets(engine, state)).toEqual({ hexes: [], why: null });
  });
});
