import { describe, expect, it } from 'vitest';
import type { Engine, GameState } from '@asl/engine';
import { noAfvBuildingsModule } from '../src/sk3/noAfvBuildings';
import { sk2CoreModules } from '../src/sk2';
import { sk3CoreModules } from '../src/sk3';
import { RU_VS_GE, act, makeEngine } from './fixtures';

/* S27 SSR 6: "AFV may not enter a building hex." */

const game = (withSsr: boolean) =>
  makeEngine({
    scenario: { ...RU_VS_GE, ssr: withSsr ? [{ module: 'no-afv-buildings', params: { rule: 'SSR 6' }, text: '' }] : [] },
    extra: [...sk2CoreModules, ...sk3CoreModules, noAfvBuildingsModule],
    startPhase: 'MPh',
    terrain: { yM8: { terrain: 'building-stone', buildingId: 'b1' } },
    pieces: [{ id: 't', def: 'ru.T34M43', side: 'ru', hex: 'yM9', tags: { vca: 0, ca: 0 } }],
  });
const stepWhy = (engine: Engine, s: GameState, to: string) => {
  const d = engine.currentDecision(s)!;
  return engine.validate(s, { type: 'move.step', to, side: 'ru', decisionId: d.id } as never);
};

describe('AFV may not enter a building hex (SSR)', () => {
  it('refuses the step into a building with the rule, allows it without', () => {
    const on = game(true);
    expect(stepWhy(on.engine, act(on.engine, on.state, { type: 'vmove.start', vehicle: 't' }).state, 'yM8')).toMatch(/AFV may not enter a building hex \(SSR 6\)/);
    const off = game(false);
    expect(stepWhy(off.engine, act(off.engine, off.state, { type: 'vmove.start', vehicle: 't' }).state, 'yM8')).toBeNull();
  });
});
