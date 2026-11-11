import { describe, expect, it } from 'vitest';
import { ENTRY_LOSSES_MODULE, ENTRY_ORDER_DR_MODULE, entryLossesCount, entryLossesModule, entryLossesRolled, entryOrderDrModule, entryOrderDrPending, entryOrderDrResult, entryOrderLabel, entryOrderDrParams } from '../src';
import { makeEngine } from './fixtures';

const enter = (turn: number) => ({ kind: 'enter' as const, turn, edge: 'S' });
const scenario = (lossForces = ['a', 'b']) => ({
  firstSide: 'br',
  sides: [
    { side: 'br', name: 'Free French', nationality: 'br', elr: 5 },
    { side: 'ge', name: 'German', nationality: 'ge', elr: 3 },
  ],
  forces: [
    { id: 'a', group: 'Group A', side: 'br', units: [{ def: 'br.458', count: 2 }], setup: enter(1) },
    { id: 'b', group: 'Group B', side: 'br', units: [{ def: 'br.458', count: 2 }, { def: 'br.L91', count: 1 }], setup: enter(2) },
  ],
  ssr: [
    {
      module: ENTRY_ORDER_DR_MODULE,
      params: { side: 'br', turn: 1, rule: 'SSR 1', outcomes: [{ dr: [1, 4], turns: { a: 1, b: 2 } }, { dr: [5, 6], turns: { a: 2, b: 1 } }] },
    },
    { module: ENTRY_LOSSES_MODULE, params: { side: 'br', forces: lossForces, from: 'br.458', to: 'br.457', divisor: 2, round: 'up', rule: 'SSR 2' } },
  ],
});
const pieces = [
  { id: 'a1', def: 'br.458', side: 'br', tags: { force: 0, entryTurn: 1, entryEdge: 'S' } },
  { id: 'a2', def: 'br.458', side: 'br', tags: { force: 0, entryTurn: 1, entryEdge: 'S' } },
  { id: 'b1', def: 'br.458', side: 'br', tags: { force: 1, entryTurn: 2, entryEdge: 'S' } },
  { id: 'b2', def: 'br.458', side: 'br', tags: { force: 1, entryTurn: 2, entryEdge: 'S' } },
  { id: 'b3', def: 'br.L91', side: 'br', tags: { force: 1, entryTurn: 2, entryEdge: 'S' } },
  { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yH5' },
];

describe('entry order by dr and losses on entry (SSR)', () => {
  it('a dr in the side\'s Turn 1 RPh gives each group its turn; the group due rolls its losses before its offboard setup', () => {
    const { engine, state } = makeEngine({ pieces, extra: [entryOrderDrModule, entryLossesModule], scenario: scenario(), startPhase: 'RPh', dice: [5, 6] });
    const env = engine.env(state);
    expect(entryOrderDrResult(env)).toMatchObject({ dr: 5, turns: { a: 2, b: 1 }, rule: 'SSR 1' });
    expect(entryOrderDrPending(env)).toEqual([]);
    expect([state.pieces['a1']!.tags['entryTurn'], state.pieces['b1']!.tags['entryTurn'], state.pieces['b3']!.tags['entryTurn']]).toEqual([2, 1, 1]);
    // dr 6 ÷ 2 = 3, but Group B has only two 4-5-8s; its leader is untouched; Group A (not due) does not roll.
    expect(['b1', 'b2', 'b3', 'a1'].map((id) => state.pieces[id]!.defId)).toEqual(['br.457', 'br.457', 'br.L91', 'br.458']);
    expect(entryLossesRolled(env)).toEqual(['b']);
    expect(engine.currentDecision(state)).toMatchObject({ kind: 'offboardSetup', owner: 'br' });
  });

  it('a force left out of the losses rule (balance) does not roll', () => {
    const { engine, state } = makeEngine({ pieces, extra: [entryOrderDrModule, entryLossesModule], scenario: scenario(['a']), startPhase: 'RPh', dice: [2, 6] });
    expect(entryOrderDrResult(engine.env(state))).toMatchObject({ dr: 2, turns: { a: 1, b: 2 } });
    expect(['a1', 'a2'].map((id) => state.pieces[id]!.defId)).toEqual(['br.457', 'br.457']);
    expect(entryOrderDrPending(engine.env(state))).toEqual([]);
  });

  it('words the outcomes and counts the losses as the card does', () => {
    const { engine, state } = makeEngine({ pieces, extra: [entryOrderDrModule, entryLossesModule], scenario: scenario(), startPhase: 'PFPh' });
    const env = engine.env(state);
    expect(entryOrderDrPending(env)).toEqual(['a', 'b']);
    expect(entryOrderLabel(env, entryOrderDrParams(env)!)).toBe('dr 1–4: Group A Turn 1, Group B Turn 2 · dr 5–6: Group A Turn 2, Group B Turn 1');
    expect([1, 2, 3, 4, 5, 6].map((dr) => entryLossesCount({}, dr))).toEqual([1, 1, 2, 2, 3, 3]);
    expect([1, 2, 3, 4, 5, 6].map((dr) => entryLossesCount({ round: 'down' }, dr))).toEqual([0, 1, 1, 2, 2, 3]);
  });
});
