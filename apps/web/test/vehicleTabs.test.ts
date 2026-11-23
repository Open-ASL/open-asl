import { describe, expect, it } from 'vitest';
import type { GameState, Piece } from '@asl/engine';
import { DEMO_VEHICLES_SCENARIO, newGame } from '@asl/content';
import { unitMarkers, vehicleTabs } from '../src/board/BoardView';

describe('vehicle status tabs (in place of full-size marker counters)', () => {
  const { engine, state: s0 } = newGame(DEMO_VEHICLES_SCENARIO, 'tabs', { los: 'grid' });
  const P = (id: string, defId: string, loc: Piece['loc'], tags: Piece['tags'] = {}): [string, Piece] => [id, { id, defId, side: 'am', loc, tags }];
  const at = (tags: Piece['tags'], defId = 'am.M4A3', mg: Piece['tags'] = {}) => {
    const state: GameState = {
      ...s0,
      pieces: Object.fromEntries([P('v', defId, { kind: 'hex', hex: 'yP5' }, { vca: 0, ca: 0, ...tags }), P('v.bmg', 'am.M4A3.bmg', { kind: 'held', by: 'v' }, mg)]),
    };
    const env = engine.env(state);
    return vehicleTabs(env, state.pieces['v']!).map((t) => `${t.text}:${t.tone}`);
  };

  it('shows only a departure from the usual crew posture regardless of turret facing', () => {
    expect(at({})).toEqual([]);
    expect(at({ ce: true })).toEqual(['CE:ce']);
    expect(at({ ce: true }, 'am.M8AC')).toEqual([]);
    expect(at({ ca: 2 })).toEqual([]);
    expect(at({ ca: 2, ce: true })).toEqual(['CE:ce']);
    expect(at({}, 'am.M8AC')).toEqual(['BU:bu']);
  });

  it('shows each state that hampers it, and a malfunctioned or disabled MA or MG (SK4 3.3.2, 7.2, 7.6, 7.7, 7.10)', () => {
    expect(at({ immob: true, stun: 'fresh', malf: true })).toEqual(['IMM:out', 'STUN:bad', 'MA:bad']);
    expect(at({ bog: 'bogged', shock: 'uk', recall: true, lowAmmo: true, maDisabled: true, malf: true })).toEqual(['BOG:bad', 'UK:bad', 'RECALL:bad', 'LOW AMMO:bad', 'MA:out']);
    expect(at({}, 'am.M4A3', { malf: true })).toEqual(['BMG:bad']);
    expect(at({}, 'am.M4A3', { mgDisabled: true, malf: true })).toEqual(['BMG:out']);
    expect(at({ wreck: true, immob: true })).toEqual([]);
  });

  it('leaves those states off the marker counters; Motion and Bounding First Fire stay counters', () => {
    const v: Piece = { id: 'v', defId: 'am.M4A3', side: 'am', loc: { kind: 'hex', hex: 'yP5' }, tags: { vca: 0, immob: true, stun: 'fresh', recall: true, malf: true, motion: true, bff: true } };
    expect(unitMarkers(v, 'am')).toEqual(['Motion', 'FireBnd']);
  });
});
