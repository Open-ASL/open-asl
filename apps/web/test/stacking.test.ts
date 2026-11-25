import { describe, expect, it } from 'vitest';
import { UNKNOWN_DEF_ID, concealmentModule, redactState, sk2CoreModules, sk3CoreModules } from '@asl/rules';
import { RU_VS_GE, makeEngine } from '../../../packages/rules/test/fixtures';
import { personnelStack } from '../src/board/stacking';
import { qmarkCovered, unitMarkers } from '../src/board/BoardView';

describe('board stacking', () => {
  it('draws a concealed stack’s "?" under the Known units of its side in the hex, which stay in view (SK4 8.3)', () => {
    const { engine, state } = makeEngine({
      scenario: { ...RU_VS_GE, ssr: [{ module: 'concealment', params: {}, text: 'Concealment' }] },
      extra: [...sk2CoreModules, ...sk3CoreModules, concealmentModule],
      terrain: { yK5: { terrain: 'building-stone', buildingId: 'b' } },
      pieces: [
        { id: 'a', def: 'ru.447', side: 'ru', hex: 'yK5', tags: { concealed: true } },
        { id: 'c', def: 'ru.447', side: 'ru', hex: 'yK5' },
        { id: 'g', def: 'ge.467', side: 'ge', hex: 'yK8' },
      ],
    });
    const seen = redactState(engine, state, 'ge');
    const people = Object.values(seen.pieces).filter((p) => p.loc.kind === 'hex' && p.loc.hex === 'yK5');
    const order = personnelStack(engine.env(seen), people);
    expect(order.map((p) => (p.defId === UNKNOWN_DEF_ID ? '?' : p.id))).toEqual(['?', 'c']);
  });

  it('draws its owner’s concealed units under the side’s unconcealed ones: a Known unit joining a concealed stack goes on top of the "?"', () => {
    const { engine, state } = makeEngine({
      scenario: { ...RU_VS_GE, ssr: [{ module: 'concealment', params: {}, text: 'Concealment' }] },
      extra: [...sk2CoreModules, ...sk3CoreModules, concealmentModule],
      terrain: { yK5: { terrain: 'building-stone', buildingId: 'b' } },
      pieces: [
        // The unit that walked in sorts first by id (stacking order would put it at the bottom).
        { id: 'a', def: 'ru.447', side: 'ru', hex: 'yK5' },
        { id: 'b', def: 'ru.447', side: 'ru', hex: 'yK5', tags: { concealed: true } },
        { id: 'c', def: 'ru.447', side: 'ru', hex: 'yK5', tags: { concealed: true } },
        { id: 'g', def: 'ge.467', side: 'ge', hex: 'yK8' },
      ],
    });
    const people = Object.values(state.pieces).filter((p) => p.loc.kind === 'hex' && p.loc.hex === 'yK5');
    const order = personnelStack(engine.env(state), people).map((p) => p.id);
    expect(order).toEqual(['b', 'c', 'a']);
  });

  it('puts a concealed unit’s "?" on it first, so its Pin, CX and TI markers sit on top of it', () => {
    const unit = (tags: Record<string, unknown>) => ({ id: 'a', defId: 'ja.447', side: 'ja', loc: { kind: 'hex', hex: 'yK5' }, tags }) as never;
    expect(unitMarkers(unit({ concealed: true, pinned: true, cx: true, ti: true }), 'ja')).toEqual(['qmark-ja', 'pin', expect.stringMatching(/CX/i), 'TI']);
    expect(unitMarkers(unit({ pinned: true }), 'ja')).toEqual(['pin']);
  });

  it('names a "?" covered by a status marker with a badge: Double Time CX keeps the unit concealed (SK4 8.3)', () => {
    const unit = (tags: Record<string, unknown>) => ({ id: 'a', defId: 'ja.137h', side: 'ja', loc: { kind: 'hex', hex: 'yK5' }, tags }) as never;
    // Declaring Double Time puts a CX counter on the unit; it loses its "?" only by moving where a Good Order enemy sees it.
    expect(qmarkCovered(unitMarkers(unit({ concealed: true, cx: true }), 'ja'))).toBe(true);
    expect(qmarkCovered(unitMarkers(unit({ concealed: true }), 'ja'))).toBe(false);
    expect(qmarkCovered(unitMarkers(unit({ cx: true }), 'ja'))).toBe(false);
  });
});

