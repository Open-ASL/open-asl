import { describe, expect, it } from 'vitest';
import { commissarModule } from '../src';
import { act, makeEngine } from './fixtures';

const RU_VS_GE = {
  firstSide: 'ru',
  sides: [
    { side: 'ru', name: 'Russian', nationality: 'ru', elr: 3 },
    { side: 'ge', name: 'German', nationality: 'ge', elr: 3 },
  ],
  ssr: [{ module: 'commissar', params: { side: 'ru', leaders: { 'ru.L61': { morale: 10, leadership: 0 } }, rule: 'SSR 3' }, text: 'SSR 3' }],
};

const setup = (pieces: Parameters<typeof makeEngine>[0]['pieces'], dice: number[] = []) =>
  makeEngine({ scenario: RU_VS_GE, extra: [commissarModule], startPhase: 'RPh', pieces: [...pieces, { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP9' }], dice });

describe('Commissar by SSR (S18 SSR 3, ASLRB A25.22)', () => {
  it('has the card’s morale 10 and leadership 0, no ELR; units stacked with it gain +1 morale', () => {
    const { engine, state } = setup([
      { id: 'c', def: 'ru.L61', side: 'ru', hex: 'yN5' },
      { id: 'r1', def: 'ru.447', side: 'ru', hex: 'yN5' },
      { id: 'r2', def: 'ru.447', side: 'ru', hex: 'yN6' },
    ]);
    const env = engine.env(state);
    expect(env.query('unit.morale', { unit: 'c' }, 0)).toBe(10);
    expect(env.query('unit.leadership', { unit: 'c' }, 1)).toBe(0);
    expect(env.query('unit.elrExempt', { unit: 'c' }, false)).toBe(true);
    expect(env.query('unit.morale', { unit: 'r1' }, 0)).toBe(8);
    expect(env.query('unit.morale', { unit: 'r2' }, 0)).toBe(7);
    // A pinned or broken Commissar raises nobody's morale.
    const pinned = { ...state, pieces: { ...state.pieces, c: { ...state.pieces['c']!, tags: { pinned: true } } } };
    expect(engine.env(pinned).query('unit.morale', { unit: 'r1' }, 0)).toBe(7);
  });

  it('rallies without the +4 DM DRM, at the raised morale', () => {
    // 4-4-7 broken side 7 +1 = 8; DR 4+4 = 8, no DM, no terrain: rallies.
    const { engine, state } = setup(
      [
        { id: 'c', def: 'ru.L61', side: 'ru', hex: 'yN5' },
        { id: 'r1', def: 'ru.447', side: 'ru', hex: 'yN5', tags: { broken: true, dm: true } },
      ],
      [4, 4],
    );
    const t = act(engine, state, { type: 'rally.rally', leader: 'c', unit: 'r1' });
    const ev = t.events.find((e) => e.type === 'sk1.check')!.payload as Record<string, unknown>;
    expect(ev).toMatchObject({ kind: 'rally', drm: 0, target: 8, outcome: 'rallied' });
    expect(t.state.pieces['r1']!.tags['broken']).toBeUndefined();
  });

  it('a unit failing to rally under the Commissar is Replaced by the next lower quality, a Conscript squad Casualty Reduced', () => {
    const { engine, state } = setup(
      [
        { id: 'c', def: 'ru.L61', side: 'ru', hex: 'yN5' },
        { id: 'r1', def: 'ru.458', side: 'ru', hex: 'yN5', tags: { broken: true } },
        { id: 'r2', def: 'ru.426', side: 'ru', hex: 'yN5', tags: { broken: true } },
      ],
      [5, 5, 6, 5],
    );
    const t = act(engine, state, { type: 'rally.rallyAll', leader: 'c' });
    expect(t.state.pieces['r1']!.defId).toBe('ru.447');
    expect(t.state.pieces['r1']!.tags['broken']).toBe(true);
    expect(t.state.pieces['r2']!.defId).toBe('ru.226');
    expect(t.events.some((e) => e.type === 'piece.replaced' && (e.payload as { reason?: string }).reason === 'commissar')).toBe(true);
  });

  it('must attempt to rally every broken unit stacked with it: those left are rolled for as the side ends its RPh', () => {
    const { engine, state } = setup(
      [
        { id: 'c', def: 'ru.L61', side: 'ru', hex: 'yN5' },
        { id: 'r1', def: 'ru.447', side: 'ru', hex: 'yN5', tags: { broken: true } },
        { id: 'r2', def: 'ru.447', side: 'ru', hex: 'yN7', tags: { broken: true } },
      ],
      [1, 1],
    );
    const t = act(engine, state, { type: 'endPhase' });
    const checks = t.events.filter((e) => e.type === 'sk1.check').map((e) => e.payload as Record<string, unknown>);
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ unit: 'r1', leader: 'c', outcome: 'rallied' });
    expect(t.state.pieces['r2']!.tags['broken']).toBe(true);
  });
});
