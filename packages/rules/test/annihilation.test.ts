import { describe, expect, it } from 'vitest';
import { act, makeEngine } from './fixtures';

// The card gives both sides a force (the harness places the pieces itself); the Americans win if no Good Order German
// unit is in N6, a condition settled for good once the Germans have no units left.
const forces = [
  { side: 'am', units: [], setup: { kind: 'area' as const, description: 'test', hexes: [] } },
  { side: 'ge', units: [], setup: { kind: 'area' as const, description: 'test', hexes: [] } },
];
const scenario = { forces, victory: [{ kind: 'noGoodOrderEnemyIn' as const, side: 'am', hexes: ['yN6'] }] };

describe('a side with no units left ends the game where the VC are then settled', () => {
  // A 9-1 directs the 7-4-7 at the adjacent 4-6-7: DR 2 - 1 on the 6 column is a KIA.
  const pieces = [
    { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5' },
    { id: 'aL', def: 'am.L91', side: 'am', hex: 'yN5' },
    { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yN6' },
  ];
  const fire = { type: 'fire', decl: { units: ['a1'], sw: [], target: 'yN6', directors: ['aL'] } };

  it('ends the game the moment the last enemy unit is eliminated, and the VC decide it', () => {
    const { engine, state } = makeEngine({ scenario, pieces, dice: [1, 1] });
    const t = act(engine, state, fire);
    expect(t.state.pieces['g1']!.loc.kind).toBe('eliminated');
    expect(t.state.result).toEqual({ winner: 'am', reason: 'annihilation' });
  });

  it('plays on while the enemy has a unit anywhere, offboard reinforcements included', () => {
    const { engine, state } = makeEngine({ scenario, pieces: [...pieces, { id: 'g2', def: 'ge.467', side: 'ge' }], dice: [1, 1] });
    const t = act(engine, state, fire);
    expect(t.state.pieces['g1']!.loc.kind).toBe('eliminated');
    expect(t.state.result).toBeNull();
  });

  it('plays on when the survivors could still meet their VC: wiping out the enemy is no win where the card asks for an exit', () => {
    // The Americans win only by exiting ≥ 4 VP off the north edge: with the Germans gone that is still to be done.
    const exitVc = { forces, victory: [{ kind: 'exitVp' as const, side: 'am', edge: 'N' as const, hexes: ['yN1'], vp: 4 }] };
    const { engine, state } = makeEngine({ scenario: exitVc, pieces, dice: [1, 1] });
    const t = act(engine, state, fire);
    expect(t.state.pieces['g1']!.loc.kind).toBe('eliminated');
    expect(t.state.result).toBeNull();
  });
});
