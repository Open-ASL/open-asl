import { describe, expect, it } from 'vitest';
import type { GameState } from '@asl/engine';
import { applyVirtual, withMoves } from '../src/superSpectator/virtual';

const state = {
  pieces: {
    sq: { id: 'sq', defId: 'x', side: 'ge', loc: { kind: 'hex', hex: 'tA1' }, tags: {} },
    mg: { id: 'mg', defId: 'y', side: 'ge', loc: { kind: 'held', by: 'sq' }, tags: {} },
    ru: { id: 'ru', defId: 'z', side: 'ru', loc: { kind: 'hex', hex: 'tB2' }, tags: {} },
  },
} as unknown as GameState;

describe("the commentators' virtual board", () => {
  it('is the position itself while nothing has been changed', () => {
    expect(applyVirtual(state, null)).toBe(state);
    expect(applyVirtual(state, { base: 3, moves: {} })).toBe(state);
  });

  it('moves a piece without touching the real position, and its weapon goes with it', () => {
    const v = withMoves(null, 3, ['sq'], { kind: 'hex', hex: 'tC3' });
    expect(v).toEqual({ base: 3, moves: { sq: { kind: 'hex', hex: 'tC3' } } });
    const shown = applyVirtual(state, v);
    expect(shown.pieces['sq']!.loc).toEqual({ kind: 'hex', hex: 'tC3' });
    expect(shown.pieces['mg']!.loc).toEqual({ kind: 'held', by: 'sq' });
    expect(state.pieces['sq']!.loc).toEqual({ kind: 'hex', hex: 'tA1' });
  });

  it('places a piece on an upper building level, and takes one off the board with the weapon it holds', () => {
    const up = applyVirtual(state, withMoves(null, 0, ['ru'], { kind: 'hex', hex: 'tK4:1' }));
    expect(up.pieces['ru']!.loc).toEqual({ kind: 'hex', hex: 'tK4', level: 1 });
    const gone = applyVirtual(state, withMoves(null, 0, ['sq'], null));
    expect(gone.pieces['sq']).toBeUndefined();
    expect(gone.pieces['mg']).toBeUndefined();
    expect(gone.pieces['ru']).toBeDefined();
  });

  it('keeps the step it was started at as more changes are made', () => {
    const a = withMoves(null, 5, ['sq'], { kind: 'hex', hex: 'tC3' });
    const b = withMoves(a, 9, ['ru'], null);
    expect(b.base).toBe(5);
    expect(Object.keys(b.moves)).toEqual(['sq', 'ru']);
  });
});
