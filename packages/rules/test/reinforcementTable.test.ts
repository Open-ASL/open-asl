import { describe, expect, it } from 'vitest';
import type { Engine, GameState } from '@asl/engine';
import { reinforcementTableModule } from '../src/sk1/reinforcementTable';
import { RU_VS_GE, act, makeEngine } from './fixtures';

/* S36 SSR 2: at the start of the German Turn 2 Rally Phase a dr on the Reinforcement Table decides what arrives. */

const table = {
  module: 'reinforcement-table',
  params: { side: 'ge', turn: 1, force: 'ge-t', rule: 'SSR 2', rows: [{ dr: [1, 3], units: [{ def: 'ge.467', count: 2 }] }, { dr: [4, 6], units: [{ def: 'ge.447', count: 1 }, { def: 'ge.L91', count: 1 }] }] },
  text: '',
};
const force = { id: 'ge-t', side: 'ge', units: [], setup: { kind: 'enter' as const, turn: 1, edge: 'N' } };
const game = (dice: number[]) => makeEngine({ pieces: [], scenario: { ...RU_VS_GE, forces: [force], ssr: [table] as never }, extra: [reinforcementTableModule], startPhase: 'CCPh', dice });
/** End phases until the German Player Turn begins. */
const toGermanTurn = (engine: Engine, s: GameState) => {
  for (let i = 0; i < 12 && s.attacker !== 'ge'; i++) s = act(engine, s, { type: 'endPhase' }).state;
  return s;
};

describe('Reinforcement Table (SSR)', () => {
  it('rolls as the side\'s Player Turn begins and creates the row\'s counters offboard with the force', () => {
    const { engine, state } = game([5]);
    const s = toGermanTurn(engine, state);
    const made = Object.values(s.pieces).filter((p) => p.side === 'ge');
    expect(made.map((p) => p.defId).sort()).toEqual(['ge.447', 'ge.L91']);
    expect(made[0]!.loc).toMatchObject({ kind: 'offboard', edge: 'N' });
    expect(made[0]!.tags).toMatchObject({ entryTurn: 1, entryEdge: 'N' });
  });

  it('a low dr brings the other row', () => {
    const { engine, state } = game([2]);
    const s = toGermanTurn(engine, state);
    expect(Object.values(s.pieces).filter((p) => p.side === 'ge').map((p) => p.defId)).toEqual(['ge.467', 'ge.467']);
  });
});
