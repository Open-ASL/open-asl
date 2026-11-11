import { describe, expect, it } from 'vitest';
import type { RuleModule } from '@asl/engine';
import { casualties, casualtyVp, cvpThresholds } from '../src';
import { makeEngine, scenario } from './fixtures';

/** Takes the losses in a setup step after the pieces are placed. */
const losses: RuleModule = {
  id: 'test.losses',
  install(r) {
    r.setup({
      id: 'test.losses',
      priority: 1,
      run(ctx) {
        ctx.emit('piece.eliminated', { id: 'g-squad', reason: 'IFT KIA' });
        ctx.emit('piece.eliminated', { id: 'g-leader', reason: 'Close Combat' });
        ctx.emit('piece.eliminated', { id: 'g-lmg', reason: 'Close Combat' });
        ctx.emit('piece.replaced', { id: 'g-reduced', defId: 'ge.247', from: 'ge.467' });
        ctx.emit('sk1.casualtyReduced', { unit: 'g-reduced', from: 'ge.467', to: 'ge.247', reason: 'Interdiction' });
      },
    });
  },
};

describe('Casualty ledger', () => {
  it('records each loss with its CVP: squads 2, half-squads 1, leaders 1 plus negative modifiers, reductions 1; SW nothing', () => {
    const { engine, state } = makeEngine({
      extra: [losses],
      pieces: [
        { id: 'g-squad', def: 'ge.467', side: 'ge', hex: 'yN5' },
        { id: 'g-leader', def: 'ge.L91', side: 'ge', hex: 'yN5' },
        { id: 'g-lmg', def: 'ge.LMG', side: 'ge', heldBy: 'g-leader' },
        { id: 'g-reduced', def: 'ge.467', side: 'ge', hex: 'yN6' },
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yK5' },
      ],
    });
    const env = engine.env(state);
    expect(casualties(env, 'ge').map((c) => [c.unit, c.kind, c.defId, c.vp, c.reason])).toEqual([
      ['g-squad', 'eliminated', 'ge.467', 2, 'IFT KIA'],
      ['g-leader', 'eliminated', 'ge.L91', 2, 'Close Combat'],
      ['g-reduced', 'reduced', 'ge.467', 1, 'Interdiction'],
    ]);
    expect(casualtyVp(env, 'ge')).toBe(5);
    expect(casualtyVp(env, 'am')).toBe(0);
    expect(casualties(env, 'am')).toEqual([]);
  });

  it('reads the CVP thresholds out of composite victory conditions, keyed by the side amassing them', () => {
    const sc = scenario({
      victory: [
        { kind: 'all', side: 'am', of: [{ kind: 'cvpBelow', side: 'am', cvp: 9 }, { kind: 'controlHexes', side: 'am', hexes: ['yP5'], atLeast: 1 }] },
        { kind: 'eliminateCvp', side: 'ge', cvp: 12 },
      ],
    });
    expect(cvpThresholds(sc)).toEqual([
      { side: 'ge', cvp: 9, effect: 'denies' },
      { side: 'ge', cvp: 12, effect: 'wins' },
    ]);
  });
});
