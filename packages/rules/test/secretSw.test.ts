import { describe, expect, it } from 'vitest';
import { secretSwModule, SECRET_SW } from '../src/sk1/secretSw';
import { act, makeEngine, type PieceSpec } from './fixtures';

/* S34 SSR 2: Bazookas possessed in secret, revealed when fired, when the possessor breaks or an enemy unit enters the hex. */

const ssr = [{ module: 'secret-sw', params: { side: 'am', types: ['MMG'], rule: 'SSR 2' }, text: '' }];
const game = (pieces: PieceSpec[], startPhase = 'PFPh') => makeEngine({ pieces, scenario: { ssr }, extra: [secretSwModule], startPhase, dice: [3, 3] });
const squad = (tags: Record<string, boolean> = {}): PieceSpec[] => [
  { id: 'a1', def: 'am.666', side: 'am', hex: 'yM9', tags },
  { id: 'aMMG', def: 'am.MMG', side: 'am', heldBy: 'a1', tags: { [SECRET_SW]: true } },
];
const reveals = (r: { events: { type: string; payload: unknown }[] }) => r.events.filter((e) => e.type === 'ssr.secret-sw.revealed').map((e) => e.payload as Record<string, unknown>);

describe('Secret SW possession (SSR)', () => {
  it('is hidden from the enemy only, and revealed when it fires', () => {
    const { engine, state } = game([...squad(), { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yM6' }]);
    const env = engine.env(state);
    expect(env.query('piece.visibleTo', { piece: 'aMMG', viewer: 'ge' }, true)).toBe(false);
    expect(env.query('piece.visibleTo', { piece: 'aMMG', viewer: 'am' }, true)).toBe(true);
    expect(env.query('piece.visibleTo', { piece: 'a1', viewer: 'ge' }, true)).toBe(true);
    const r = act(engine, state, { type: 'fire', decl: { units: [], sw: ['aMMG'], target: 'yM6' } });
    expect(reveals(r)).toEqual([expect.objectContaining({ weapon: 'aMMG', holder: 'a1', reason: 'fired' })]);
    expect(r.state.pieces['aMMG']!.tags[SECRET_SW]).toBeUndefined();
    // Its own unit firing without it gives nothing away.
    const g = game([...squad(), { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yM6' }]);
    const own = act(g.engine, g.state, { type: 'fire', decl: { units: ['a1'], sw: [], target: 'yM6' } });
    expect(reveals(own)).toEqual([]);
  });

  it('is revealed when its possessor is broken or an enemy unit is in its hex', () => {
    expect(game(squad({ broken: true })).state.pieces['aMMG']!.tags[SECRET_SW]).toBeUndefined();
    expect(game([...squad(), { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yM9' }], 'CCPh').state.pieces['aMMG']!.tags[SECRET_SW]).toBeUndefined();
    expect(game(squad()).state.pieces['aMMG']!.tags[SECRET_SW]).toBe(true);
  });
});
