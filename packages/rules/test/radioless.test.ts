import { describe, expect, it } from 'vitest';
import type { Engine, GameState } from '@asl/engine';
import { radiolessModule } from '../src/sk3/radioless';
import { sk2CoreModules } from '../src/sk2';
import { sk3CoreModules } from '../src/sk3';
import { RU_VS_GE, act, makeEngine } from './fixtures';

/* S25 SSR 1: a radioless AFV must make a DR ≤ 8 each MPh it wishes to move outside of its hex. */

const ssr = [{ module: 'radioless', params: { defs: ['ru.T34M43'], need: 8, rule: 'SSR 1' }, text: '' }];
const game = (dice: number[]) =>
  makeEngine({
    scenario: { ...RU_VS_GE, ssr },
    extra: [...sk2CoreModules, ...sk3CoreModules, radiolessModule],
    startPhase: 'MPh',
    dice,
    pieces: [{ id: 't', def: 'ru.T34M43', side: 'ru', hex: 'yM9', tags: { vca: 0, ca: 0 } }],
  });
const stepWhy = (engine: Engine, s: GameState, to: string) => {
  const d = engine.currentDecision(s)!;
  return engine.validate(s, { type: 'move.step', to, side: 'ru', decisionId: d.id } as never);
};

describe('Radioless AFV (SSR)', () => {
  it('a DR above 8 keeps it in its hex this MPh; it may still turn there', () => {
    const { engine, state } = game([5, 4]);
    const r = act(engine, state, { type: 'vmove.start', vehicle: 't' });
    expect(r.events.find((e) => e.type === 'ssr.radioless')?.payload).toMatchObject({ vehicle: 't', need: 8, ok: false });
    expect(stepWhy(engine, r.state, 'yM8')).toMatch(/Radioless \(SSR 1\)/);
    const d = engine.currentDecision(r.state)!;
    expect(engine.validate(r.state, { type: 'vmove.turn', vca: 1, side: 'ru', decisionId: d.id } as never)).toBeNull();
  });

  it('a DR ≤ 8 lets it move; the DR is made once per MPh', () => {
    const { engine, state } = game([4, 4]);
    const r = act(engine, state, { type: 'vmove.start', vehicle: 't' });
    expect(r.events.find((e) => e.type === 'ssr.radioless')?.payload).toMatchObject({ ok: true });
    expect(stepWhy(engine, r.state, 'yM8')).toBeNull();
    const s = act(engine, r.state, { type: 'vmove.stop' }).state;
    const again = act(engine, s, { type: 'vmove.start', vehicle: 't' });
    expect(again.events.some((e) => e.type === 'ssr.radioless')).toBe(false);
  });
});
