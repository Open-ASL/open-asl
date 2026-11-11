import { describe, expect, it } from 'vitest';
import { RU_VS_GE, act, makeEngine } from '../fixtures';
import { testFire } from './helpers';

/*
 * Verification of the Chapter A ledger rows in A7.83 and A10 (Morale) where the engine was suspected to
 * differ from the eASLRB. The current behaviour is pinned and the test name says what full ASL changes.
 */

describe('A10.72 MANDATORY LEADERSHIP (◐: positive leadership)', () => {
  it('a 6+1 leader passing his MC does not worsen the MC of the squad with him; ASL makes the +1 mandatory (not yet enforced)', () => {
    // The German 4-6-7 fires Final Fire at 3 hexes: 4 FP, DR 3+2 is a NMC. The 6+1 checks first (1+2 passes);
    // the 4-4-7 rolls 4+2 = 6. Under A10.72 its Final DR is 7 (the +1 applies), here it stays 6.
    const { engine, state } = makeEngine({
      scenario: RU_VS_GE,
      extra: [testFire],
      startPhase: 'DFPh',
      pieces: [
        { id: 'rL', def: 'ru.L61', side: 'ru', hex: 'yN5' },
        { id: 'r1', def: 'ru.447', side: 'ru', hex: 'yN5' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yN8' },
      ],
      dice: [3, 2, 1, 2, 4, 2],
    });
    const t = act(engine, state, { type: 'test.fire', mode: 'final', decl: { units: ['g1'], sw: [], target: 'yN5' } });
    const checks = t.events.filter((e) => e.type === 'sk1.check').map((e) => e.payload as { unit: string; final: number; outcome: string });
    expect(checks.map((c) => c.unit)).toEqual(['rL', 'r1']);
    expect(checks[1]).toMatchObject({ unit: 'r1', final: 6, outcome: 'passed' });
  });
});

describe('A7.83 MOVEMENT/ADVANCE: a pinned mover and FFNAM/FFMO', () => {
  it('a mover pinned by Defensive First Fire is fired on again there, without FFNAM/FFMO; the movers keep them', () => {
    // Two Russian squads move yN5 → yN6 (open). The 4-6-7 in yN8 fires: 4 FP, DR 4+3 -2 (FFNAM, FFMO) = 5, a NMC.
    // r1 rolls 4+3 = 7 = morale: pinned, its move over; r2 passes on 1+2. The 4-6-7 in yN9 then fires at the stack.
    const { engine, state } = makeEngine({
      scenario: RU_VS_GE,
      startPhase: 'MPh',
      pieces: [
        { id: 'r1', def: 'ru.447', side: 'ru', hex: 'yN5' },
        { id: 'r2', def: 'ru.447', side: 'ru', hex: 'yN5' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yN8' },
        { id: 'g2', def: 'ge.467', side: 'ge', hex: 'yN9' },
      ],
      // First attack; r1 MC, r2 MC; second attack 5+1 (-2 for the movers).
      dice: [4, 3, 4, 3, 1, 2, 5, 1, 6, 6, 6, 6],
    });
    let s = act(engine, state, { type: 'move.start', units: ['r1', 'r2'] }).state;
    s = act(engine, s, { type: 'move.step', to: 'yN6' }).state;
    const first = act(engine, s, { type: 'defFire', decl: { units: ['g1'], sw: [], target: 'yN6' } });
    expect(first.state.pieces['r1']!.tags['pinned']).toBe(true);
    s = first.state;
    expect(engine.currentDecision(s)).toMatchObject({ kind: 'firstFire', owner: 'ge' });
    const second = act(engine, s, { type: 'defFire', decl: { units: ['g2'], sw: [], target: 'yN6' } });
    const attack = second.events.find((e) => e.type === 'sk1.fire.attack')!.payload as { drm: number };
    const results = second.events.filter((e) => e.type === 'sk1.fire.result').map((e) => e.payload as { unit: string; finalDr: number });
    // The pinned r1 is attacked "in its broken or pinned state" (A8.14) but "not subject to any further DRM for
    // FFNAM/FFMO" (A7.83, whose example fires on it "without the -2 DRM"); the moving r2 takes them (-2).
    expect(attack.drm).toBe(-2);
    expect(Object.fromEntries(results.map((r) => [r.unit, r.finalDr]))).toEqual({ r1: 6, r2: 4 });
  });
});