import { describe, expect, it } from 'vitest';
import type { Engine, GameState } from '@asl/engine';
import type { FireDeclaration } from '../src';
import { RU_VS_GE, act, makeEngine } from './fixtures';

/*
 * A crew fires its MMG together with its own FP at an adjacent unit in the DFPh: Final Fire vs an adjacent unit is the
 * case where a crew or HS keeps its own FP while firing a weapon (SK1 4.0). The crew is then marked Final Fire, but a
 * MG that keeps its Rate of Fire may fire again this phase (SK1 1.2.4): it does not fire under its holder's marker.
 */

/** The DFPh: a German crew (or HS) with a MMG in yP5, a Russian squad adjacent in yP6. */
function game(dice: number[], holder = 'ge.228c') {
  return makeEngine({
    scenario: RU_VS_GE,
    startPhase: 'DFPh',
    dice: [...dice, ...Array(60).fill(6)],
    pieces: [
      { id: 'c', def: holder, side: 'ge', hex: 'yP5' },
      { id: 'mmg', def: 'ge.MMG', side: 'ge', heldBy: 'c' },
      { id: 'r', def: 'ru.447', side: 'ru', hex: 'yP6' },
    ],
  }) as { engine: Engine; state: GameState };
}
const check = (engine: Engine, s: GameState, decl: FireDeclaration) => engine.validate(s, { type: 'fire', decl, side: 'ge', decisionId: engine.currentDecision(s)!.id } as never);
const both: FireDeclaration = { units: ['c'], sw: ['mmg'], target: 'yP6' };

describe('a crew’s or HS’s MG that keeps its ROF in the DFPh (SK1 1.2.4, 4.0)', () => {
  it('fires again though its crew is marked Final Fire; the crew may not', () => {
    const { engine, state } = game([1, 2]);
    const r = act(engine, state, { type: 'fire', decl: both });
    expect(r.events.find((e) => e.type === 'sk1.fire.rof')!.payload).toMatchObject({ colored: 2, kept: [{ sw: 'mmg' }] });
    const s = r.state;
    expect(s.pieces['c']!.tags).toMatchObject({ fire: 'final' });
    expect(s.pieces['mmg']!.tags['fire']).toBeUndefined();
    expect(check(engine, s, { units: [], sw: ['mmg'], target: 'yP6' })).toBeNull();
    expect(check(engine, s, { units: ['c'], sw: [], target: 'yP6' })).not.toBeNull();
  });

  it('so does a half-squad\u2019s', () => {
    const { engine, state } = game([1, 2], 'ge.247');
    const s = act(engine, state, { type: 'fire', decl: both }).state;
    expect(s.pieces['c']!.tags).toMatchObject({ fire: 'final' });
    expect(check(engine, s, { units: [], sw: ['mmg'], target: 'yP6' })).toBeNull();
  });

  it('a lost ROF ends its fire for the phase', () => {
    const { engine, state } = game([3, 4]);
    const s = act(engine, state, { type: 'fire', decl: both }).state;
    expect(check(engine, s, { units: [], sw: ['mmg'], target: 'yP6' })).toMatch(/Final Fire/);
  });

  it('through to the next Player Turn: no marker is left, and the crew fires its MMG normally', () => {
    const { engine, state } = game([1, 2]);
    let s = act(engine, state, { type: 'fire', decl: both }).state;
    for (let i = 0; i < 80 && !(s.attacker === 'ge' && s.phase === 'PFPh'); i++) {
      const d = engine.currentDecision(s)!;
      const l = engine.legalActions(s, d.owner);
      s = engine.submit(s, l.find((a) => a.type === 'endPhase') ?? l.find((a) => a.type === 'defPass') ?? l[0]!).state;
    }
    expect(s).toMatchObject({ attacker: 'ge', phase: 'PFPh' });
    for (const id of ['c', 'mmg']) {
      expect(s.pieces[id]!.tags['fire']).toBeUndefined();
      expect(s.pieces[id]!.tags['rofFired']).toBeUndefined();
    }
    expect(check(engine, s, { units: [], sw: ['mmg'], target: 'yP6' })).toBeNull();
  });
});
