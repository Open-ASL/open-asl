import { describe, expect, it } from 'vitest';
import type { Engine, GameState } from '@asl/engine';
import { sk2CoreModules } from '../src/sk2';
import { sk3CoreModules } from '../src/sk3';
import { digInModule } from '../src/sk3/digIn';
import { ssrAttacksModule } from '../src/sk3/ssrAttacks';
import { RU_VS_GE, act, makeEngine, type PieceSpec } from './fixtures';

/* S35 SSR 5 (a Russian Sniper) and SSR 6 (a German Stuka), once per Defensive Fire Phase against a hex. */

const extra = [...sk2CoreModules, ...sk3CoreModules, ssrAttacksModule, digInModule];
const sniper = { module: 'sniper-attack', params: { side: 'ru', rule: 'SSR 5' }, text: '' };
const stuka = { module: 'stuka-attack', params: { side: 'ge', infantryTh: 8, column: 36, afvTh: [6, 10], directHit: 5, tk: { 'ru.T34M43': 7 }, rule: 'SSR 6' }, text: '' };
const digIn = { module: 'dig-in', params: { side: 'ru', thDrm: 1, rule: 'SSR 3' }, text: '' };
const ev = (r: { events: { type: string; payload: unknown }[] }, type: string) => r.events.filter((e) => e.type === type).map((e) => e.payload as Record<string, unknown>);
const try_ = (engine: Engine, s: GameState, a: Record<string, unknown>) => engine.validate(s, { ...a, side: engine.currentDecision(s)!.owner, decisionId: engine.currentDecision(s)!.id } as never);

describe('Sniper attack (SSR)', () => {
  // The Germans move, so the Russian DFPh is theirs.
  const game = (pieces: PieceSpec[], dice: number[]) => makeEngine({ pieces, scenario: { ...RU_VS_GE, firstSide: 'ge', ssr: [sniper] }, extra, startPhase: 'DFPh', dice });
  const squad: PieceSpec = { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yM5' };

  it('dr 1 breaks a MMC, dr 2 pins it, more misses; once per Defensive Fire Phase', () => {
    const one = game([squad], [1]);
    const r1 = act(one.engine, one.state, { type: 'ssr.sniper', hex: 'yM5' });
    expect(ev(r1, 'ssr.sniper.attack')[0]).toMatchObject({ dr: 1, target: 'g1', effect: 'broken' });
    expect(r1.state.pieces['g1']!.tags['broken']).toBe(true);
    expect(try_(one.engine, r1.state, { type: 'ssr.sniper', hex: 'yM5' })).toMatch(/Once per Defensive Fire Phase/);
    const two = game([squad], [2]);
    expect(act(two.engine, two.state, { type: 'ssr.sniper', hex: 'yM5' }).state.pieces['g1']!.tags['pinned']).toBe(true);
    const three = game([squad], [3]);
    expect(ev(act(three.engine, three.state, { type: 'ssr.sniper', hex: 'yM5' }), 'ssr.sniper.attack')[0]).toMatchObject({ dr: 3, target: null, effect: 'no effect' });
  });

  it('dr 1 eliminates a leader; it needs an enemy unit in the hex and the side\'s own DFPh', () => {
    const g = game([{ id: 'gl', def: 'ge.L91', side: 'ge', hex: 'yM5' }], [1]);
    expect(act(g.engine, g.state, { type: 'ssr.sniper', hex: 'yM5' }).state.pieces['gl']!.loc.kind).toBe('eliminated');
    expect(try_(g.engine, g.state, { type: 'ssr.sniper', hex: 'yM6' })).toMatch(/No enemy unit/);
    const ge = makeEngine({ pieces: [squad], scenario: { ...RU_VS_GE, firstSide: 'ru', ssr: [sniper] }, extra, startPhase: 'DFPh', dice: [1] });
    expect(try_(ge.engine, ge.state, { type: 'ssr.sniper', hex: 'yM5' })).toMatch(/No special rule|Only in your Defensive Fire Phase/);
  });
});

describe('Stuka attack (SSR)', () => {
  // The Russians move, so the German DFPh is theirs.
  const game = (tags: Record<string, unknown>, dice: number[], ssr: object[] = [stuka]) =>
    makeEngine({
      pieces: [
        { id: 'r1', def: 'ru.447', side: 'ru', hex: 'yM5' },
        { id: 't', def: 'ru.T34M43', side: 'ru', hex: 'yM5', tags: { vca: 0, ca: 0, ...tags } as never },
      ],
      scenario: { ...RU_VS_GE, firstSide: 'ru', ssr: ssr as never },
      extra,
      startPhase: 'DFPh',
      dice,
    });

  it('≤ 5 is a direct hit on the AFV, and ≤ 8 hits the Infantry on the 36 column', () => {
    const { engine, state } = game({}, [3, 2, 6, 6]);
    const r = act(engine, state, { type: 'ssr.stuka', hex: 'yM5' });
    expect(ev(r, 'ssr.stuka.attack')[0]).toMatchObject({ infantry: true, afv: [{ vehicle: 't', final: 5, result: 'direct hit: eliminated' }] });
    expect(r.state.pieces['t']!.tags['wreck']).toBe(true);
    expect(ev(r, 'sk1.fire.attack')[0]).toMatchObject({ column: 36 });
  });

  it('6-10 vs an AFV is a To Kill DR against the card\'s number; 9 misses the Infantry', () => {
    const { engine, state } = game({}, [5, 4, 3, 3]);
    const r = act(engine, state, { type: 'ssr.stuka', hex: 'yM5' });
    expect(ev(r, 'ssr.stuka.attack')[0]).toMatchObject({ infantry: false, afv: [{ final: 9, result: 'destroyed', tk: 7, tkDr: [3, 3] }] });
  });

  it('a dug-in AFV: +1 to the DR, and a hull hit misses', () => {
    // 4+4 = 8, +1 dug in = 9; equal dice is a hull hit: a miss.
    const { engine, state } = game({ dugIn: true }, [4, 4, 6, 6], [stuka, digIn]);
    const r = act(engine, state, { type: 'ssr.stuka', hex: 'yM5' });
    expect(ev(r, 'ssr.stuka.attack')[0]).toMatchObject({ infantry: true, afv: [{ final: 9, result: 'hull hit on a dug-in AFV: miss' }] });
    expect(r.state.pieces['t']!.tags['wreck']).toBeUndefined();
  });
});
