import { describe, expect, it } from 'vitest';
import type { Engine, GameState } from '@asl/engine';
import { GE_VS_BR, act, makeEngine } from './fixtures';

/*
 * Flamethrowers (SK1 4.2, SK4 4.2): a FT may not combine with any other attack nor form a Fire Group, takes no
 * leadership DRM, and a pinned unit cannot fire it; a full squad possessing one may make a separate attack with its
 * own FP. A stack holding a FT fires it alone and fires the rest as another attack.
 */

/** A German stack in yK5: squad `s1` with the FT, squad `s2` with a LMG and a 9-1 leader; British squads adjacent in yK6. */
function ftGame(dice: number[], tags: Record<string, boolean> = {}) {
  return makeEngine({
    scenario: GE_VS_BR,
    dice,
    pieces: [
      { id: 's1', def: 'ge.467', side: 'ge', hex: 'yK5', tags },
      { id: 'ft', def: 'ge.FT', side: 'ge', heldBy: 's1' },
      { id: 's2', def: 'ge.467', side: 'ge', hex: 'yK5' },
      { id: 'lmg', def: 'ge.LMG', side: 'ge', heldBy: 's2' },
      { id: 'L', def: 'ge.L91', side: 'ge', hex: 'yK5' },
      { id: 'b1', def: 'br.457', side: 'br', hex: 'yK6' },
      { id: 'b2', def: 'br.457', side: 'br', hex: 'yK6' },
    ],
  });
}
const illegal = (engine: Engine, state: GameState, decl: Record<string, unknown>) =>
  engine.env(state).query('fire.illegal', { decl: { target: 'yK6', ...decl } as never, mode: 'prep', side: 'ge' }, null);

describe('a Flamethrower fires alone (SK1 4.2)', () => {
  it('fires by itself from a stack whose other units and SW are free to fire, but never with them or directed', () => {
    const { engine, state } = ftGame([]);
    expect(illegal(engine, state, { units: [], sw: ['ft'] })).toBeNull();
    expect(illegal(engine, state, { units: ['s2'], sw: ['ft'] })).toMatch(/FT may not combine/);
    expect(illegal(engine, state, { units: [], sw: ['ft', 'lmg'] })).toMatch(/FT may not combine/);
  });

  it('a pinned holder cannot fire it', () => {
    const { engine, state } = ftGame([], { pinned: true });
    expect(illegal(engine, state, { units: [], sw: ['ft'] })).toMatch(/pinned unit cannot fire a FT/);
  });

  it('after the FT has fired, the rest of the stack, its holder included, fires as a separate attack', () => {
    // FT attack DR 3+4 (below its X#, 9 for a non-elite user, so it stays); then the stack's attack DR 6+6.
    const { engine, state } = ftGame([3, 4, 6, 6]);
    let s = act(engine, state, { type: 'fire', decl: { units: [], sw: ['ft'], target: 'yK6' } }).state;
    expect(s.pieces['ft']!.loc).toEqual({ kind: 'held', by: 's1' });
    expect(illegal(engine, s, { units: [], sw: ['ft'] })).not.toBeNull();
    expect(illegal(engine, s, { units: ['s1', 's2'], sw: ['lmg'], directors: ['L'] })).toBeNull();
    s = act(engine, s, { type: 'fire', decl: { units: ['s1', 's2'], sw: ['lmg'], target: 'yK6', directors: ['L'] } }).state;
    expect(s.pieces['s1']!.tags['fire']).toBe('prep');
  });

  it('what it fired is forgotten by the next German Player Turn, and it may fire again', () => {
    const { engine, state } = ftGame([3, 4, ...Array(60).fill(6)]);
    let s = act(engine, state, { type: 'fire', decl: { units: [], sw: ['ft'], target: 'yK6' } }).state;
    for (let i = 0; i < 80 && !(s.turn === 2 && s.attacker === 'ge' && s.phase === 'PFPh'); i++) {
      const d = engine.currentDecision(s)!;
      const options = engine.legalActions(s, d.owner);
      const a = options.find((x) => x.type === 'endPhase') ?? options.find((x) => x.type === 'defPass') ?? options.find((x) => x.type === 'move.end') ?? options[0]!;
      s = engine.submit(s, a).state;
    }
    expect([s.turn, s.attacker, s.phase]).toEqual([2, 'ge', 'PFPh']);
    expect(s.pieces['ft']!.tags['fire']).toBeUndefined();
    expect(s.pieces['s1']!.tags['firedSw']).toBeUndefined();
    expect(illegal(engine, s, { units: [], sw: ['ft'] })).toBeNull();
  });
});
