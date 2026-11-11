import { describe, expect, it } from 'vitest';
import { entryAfterFireModule, entryAfterFireState } from '../src';
import { act, makeEngine } from './fixtures';

/*
 * Reinforcements entering on the turn after a side's first fire attack (LMA4 SSR 4: "German reinforcements enter by
 * the South edge on the turn following the first German fire attack").
 */

const SSR = { module: 'entry-after-fire', params: { force: 'ge-reinf', firedBy: 'ge', rule: 'SSR 4' }, text: 'SSR 4' };
const scenario = (firstSide: string) => ({
  firstSide,
  ssr: [SSR],
  forces: [{ id: 'ge-reinf', side: 'ge', units: [{ def: 'ge.467', count: 1 }], setup: { kind: 'enter' as const, turn: 0, edge: 'S' } }],
});
const pieces = [
  { id: 'a1', def: 'am.666', side: 'am', hex: 'yM5' },
  { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yM7' },
  { id: 'r1', def: 'ge.467', side: 'ge', tags: { force: 0, entryTurn: 0, entryEdge: 'S' } },
];
const game = (firstSide: string) => makeEngine({ scenario: scenario(firstSide), extra: [entryAfterFireModule], startPhase: 'PFPh', pieces, dice: [6, 6] });

describe('Entry after the first fire attack (LMA4 SSR 4)', () => {
  it('the first German attack sets the reinforcements to enter on the next Game Turn, once', () => {
    const { engine, state } = game('ge');
    expect(entryAfterFireState(engine.env(state))).toBeNull();
    const t = act(engine, state, { type: 'fire', decl: { units: ['g1'], sw: [], target: 'yM5' } });
    expect(t.events.find((e) => e.type === 'ssr.entryAfterFire')!.payload).toMatchObject({ force: 'ge-reinf', side: 'ge', turn: 2, firedOn: 1, firer: 'g1' });
    expect(t.state.pieces['r1']!.tags['entryTurn']).toBe(2);
    expect(entryAfterFireState(engine.env(t.state))).toEqual({ turn: 2, firedOn: 1, firer: 'g1' });
  });

  it('an American attack does not count', () => {
    const { engine, state } = game('am');
    const t = act(engine, state, { type: 'fire', decl: { units: ['a1'], sw: [], target: 'yM7' } });
    expect(t.events.some((e) => e.type === 'ssr.entryAfterFire')).toBe(false);
    expect(t.state.pieces['r1']!.tags['entryTurn']).toBe(0);
  });
});
