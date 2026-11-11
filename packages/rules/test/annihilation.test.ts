import { describe, expect, it } from 'vitest';
import { act, makeEngine } from './fixtures';

// The card gives both sides a force (the harness places the pieces itself).
const scenario = {
  forces: [
    { side: 'am', units: [], setup: { kind: 'area' as const, description: 'test', hexes: [] } },
    { side: 'ge', units: [], setup: { kind: 'area' as const, description: 'test', hexes: [] } },
  ],
};

describe('a side with no units left loses at once (blanket rule)', () => {
  // A 9-1 directs the 7-4-7 at the adjacent 4-6-7: DR 2 - 1 on the 6 column is a KIA.
  const pieces = [
    { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5' },
    { id: 'aL', def: 'am.L91', side: 'am', hex: 'yN5' },
    { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yN6' },
  ];
  const fire = { type: 'fire', decl: { units: ['a1'], sw: [], target: 'yN6', directors: ['aL'] } };

  it('ends the game the moment the last enemy unit is eliminated', () => {
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
});
