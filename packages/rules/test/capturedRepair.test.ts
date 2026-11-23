import { describe, expect, it } from 'vitest';
import { capturedUseExemptModule } from '../src';
import { act, makeEngine } from './fixtures';

/** An American crew manning a German Gun: captured (SK1 5.5), unless an SSR waives the Captured Use penalties. */
const setup = (opts: { exempt?: boolean; holder?: string; dice?: number[] } = {}) =>
  makeEngine({
    startPhase: 'RPh',
    extra: [capturedUseExemptModule],
    scenario: opts.exempt
      ? { ssr: [{ module: 'captured-use-exempt', params: { side: 'am', defs: ['ge.AT75L'], crewsOnly: true, rule: 'SSR 3' }, text: 'SSR 3' }] }
      : {},
    pieces: [
      { id: 'c1', def: opts.holder ?? 'am.228c', side: 'am', hex: 'yN5' },
      { id: 'gun', def: 'ge.AT75L', side: 'am', heldBy: 'c1', tags: { malf: true } },
      { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP9' },
    ],
    dice: opts.dice ?? [1],
  });

describe('repairing a captured weapon (SK4 3.1c; ASLRB A9.72, A21.11-.12)', () => {
  it('a captured Gun cannot be repaired: only weapons of the unit’s own nationality', () => {
    const { engine, state } = setup();
    expect(() => act(engine, state, { type: 'rally.repair', unit: 'c1', sw: 'gun' })).toThrow(/own nationality/);
  });

  it('an SSR waiving Captured Use penalties for it lets its crew repair it (Perry Sez A25.75)', () => {
    const { engine, state } = setup({ exempt: true });
    // The wheel's Repair entry and the bot both ask the engine's validation; a repair dr of 1 repairs it (SK4 6.12).
    const d = engine.currentDecision(state)!;
    expect(engine.validate(state, { type: 'rally.repair', unit: 'c1', sw: 'gun', side: d.owner, decisionId: d.id } as never)).toBeNull();
    const t = act(engine, state, { type: 'rally.repair', unit: 'c1', sw: 'gun' });
    expect(t.state.pieces['gun']!.tags['malf']).toBeFalsy();
  });

  it('the waiver binds only the units it names: a squad holding a crews-only Gun still may not repair it', () => {
    const { engine, state } = setup({ exempt: true, holder: 'am.666' });
    expect(() => act(engine, state, { type: 'rally.repair', unit: 'c1', sw: 'gun' })).toThrow(/own nationality/);
  });
});

describe('Captured Use penalties waived by SSR (ASLRB A21.11-.12)', () => {
  it('the B# keeps its printed value and the ROF is not lowered for the units it names, and only for them', () => {
    const plain = setup().engine.env(setup().state);
    const ex = setup({ exempt: true });
    const env = ex.engine.env(ex.state);
    // The AT75L: no printed B# (12), ROF 2. Captured: B# 10 (SK1 5.5, SK4 6.12), ROF 1.
    expect(plain.query('sw.breakdown', { sw: 'gun', user: 'c1' }, 12)).toBe(10);
    expect(plain.query('sw.rof', { sw: 'gun', user: 'c1' }, 0)).toBe(1);
    expect(env.query('sw.breakdown', { sw: 'gun', user: 'c1' }, 12)).toBe(12);
    expect(env.query('sw.rof', { sw: 'gun', user: 'c1' }, 0)).toBe(2);
    // A squad firing a crews-only Gun pays them (and Non-Qualified Use besides, SK4 3.2.4).
    const sq = setup({ exempt: true, holder: 'am.666' });
    expect(sq.engine.env(sq.state).query('sw.rof', { sw: 'gun', user: 'c1' }, 0)).toBe(1);
  });
});
