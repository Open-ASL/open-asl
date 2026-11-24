import { describe, expect, it } from 'vitest';
import type { Engine, GameState } from '@asl/engine';
import { sk2CoreModules } from '../src/sk2';
import { sk3CoreModules } from '../src/sk3';
import { RU_VS_GE, act, makeEngine, type PieceSpec } from './fixtures';

/*
 * An Infantry Target Type hit affects "all enemy targets except for BU AFV in the target hex ... including any Crew Exposed
 * (7.7) units" (SK4 3.2.4): "an attack using the ITT cannot affect an AFV, only its CE crew" (SK4 7.12). The CE crew takes
 * the IFT attack with its CE DRM (SK4 7.7), the AFV itself never; a Buttoned Up AFV is unaffected (ASLRB C3.32: "All AFV
 * (but not their Vulnerable PRC) in the target Location are immune to damage from a hit on this table"; D.8B: a General
 * Collateral Attack).
 */

const extra = [...sk2CoreModules, ...sk3CoreModules];
const ev = (r: { events: { type: string; payload: unknown }[] }, type: string) => r.events.filter((e) => e.type === type).map((e) => e.payload as Record<string, unknown>);

/** A German PzKpfw IVF2 in yM9 facing north; a Russian squad and a T-34 (CE when `ce`) in the open in yM6, range 3. */
const game = (dice: number[], ce: boolean, terrain: Record<string, { terrain: string }> = {}) => {
  const pieces: PieceSpec[] = [
    { id: 'pz', def: 'ge.pzivf2', side: 'ge', hex: 'yM9', tags: { vca: 0, ca: 0 } },
    { id: 'q', def: 'ru.447', side: 'ru', hex: 'yM6' },
    { id: 't', def: 'ru.T34M43', side: 'ru', hex: 'yM6', tags: { vca: 3, ca: 3, ...(ce ? { ce: true } : {}) } },
  ];
  return makeEngine({ scenario: { ...RU_VS_GE, firstSide: 'ge' }, extra, dice, pieces, terrain });
};
const ittShot = { type: 'fire.ordnance', shot: { weapon: 'pz', target: 'yM6', targetType: 'ITT' as const, ammo: 'HE' as const } };

describe('Infantry Target Type hits on a hex holding an AFV (SK4 3.2.4, 7.12)', () => {
  it('the CE crew of the AFV takes the IFT attack with its +2 CE DRM; the squad takes it without', () => {
    // To Hit 3+3, +1 BU firer = 7 ≤ 8 (range 3), not ≤ 3: a hit, no Critical Hit. 75mm: the 12 column.
    // IFT 3+4 = 7: the squad a 2MC; the crew 7 + 2 CE = 9: a NMC. The crew rolls 5+5 = 10, fails: the AFV is Stunned.
    // The squad rolls 2+2 + 2 and passes.
    const { engine, state } = game([3, 3, 3, 4, 5, 5, 2, 2], true);
    const r = act(engine, state, ittShot);
    expect(ev(r, 'sk2.ordnance.shot')[0]).toMatchObject({ outcome: 'hit', targets: ['q', 't'] });
    expect(ev(r, 'sk1.fire.result').find((e) => e['unit'] === 't')).toMatchObject({ result: { kind: 'NMC' }, finalDr: 9 });
    expect(ev(r, 'sk3.vehicle.check')[0]).toMatchObject({ vehicle: 't', kind: 'MC', dr: [5, 5] });
    expect(r.state.pieces['t']!.tags['stun']).toBeDefined();
    // The AFV itself is never attacked: no Area Target Type resolution, no To Kill.
    expect(ev(r, 'sk3.areaHit')).toHaveLength(0);
    expect(r.state.pieces['t']!.tags['wreck']).toBeUndefined();
  });

  it('in woods the crew claims the TEM, on the To Hit DR, instead of the CE DRM (SK4 7.7; ASLRB D.8B)', () => {
    // To Hit 3+3, +1 BU firer, +1 woods = 8 ≤ 8: a hit. IFT 3+4 = 7, no TEM and no CE DRM: a 2MC for both.
    const { engine, state } = game([3, 3, 3, 4, 2, 2, 2, 2], true, { yM6: { terrain: 'woods' } });
    const r = act(engine, state, ittShot);
    expect(ev(r, 'sk2.ordnance.shot')[0]).toMatchObject({ outcome: 'hit', targets: ['q', 't'] });
    expect(ev(r, 'sk1.fire.result').find((e) => e['unit'] === 't')).toMatchObject({ result: { kind: 'MC', n: 2 }, finalDr: 7 });
  });

  it('a Buttoned Up AFV in the hex is unaffected: only the squad is attacked', () => {
    const { engine, state } = game([3, 3, 3, 4, 2, 2], false);
    const r = act(engine, state, ittShot);
    expect(ev(r, 'sk2.ordnance.shot')[0]).toMatchObject({ outcome: 'hit', targets: ['q'] });
    expect(ev(r, 'sk1.fire.result').map((e) => e['unit'])).toEqual(['q']);
    expect(ev(r, 'sk3.vehicle.check')).toHaveLength(0);
  });

  it('a crew pinned by the hit Buttons Up; next Player Turn the T-34 fires and moves normally', () => {
    // IFT 4+4 = 8: the squad a 1MC (rolls 1+1, passes); the crew 8 + 2 = 10: a PTC, failed on 6+6: it Buttons Up.
    const { engine, state } = game([3, 3, 4, 4, 6, 6, 1, 1], true);
    const r = act(engine, state, ittShot);
    expect(ev(r, 'sk3.vehicle.check')[0]).toMatchObject({ vehicle: 't', kind: 'PTC', passed: false });
    expect(r.state.pieces['t']!.tags['ce']).toBeFalsy();
    let s: GameState = r.state;
    for (let i = 0; i < 200 && !(s.attacker === 'ru' && s.phase === 'PFPh'); i++) s = step(engine, s);
    expect(s.attacker).toBe('ru');
    // Every Player Turn marker set by the hit is gone; the T-34 may Prep Fire at the panzer, then move.
    const d = engine.currentDecision(s)!;
    expect(engine.validate(s, { type: 'fire.ordnance', shot: { weapon: 't', target: 'yM9', targetType: 'VTT', ca: 3 }, side: 'ru', decisionId: d.id } as never)).toBeNull();
    for (let i = 0; i < 20 && s.phase !== 'MPh'; i++) s = act(engine, s, { type: 'endPhase' }).state;
    expect(engine.legalActions(s, 'ru').some((a) => a.type === 'vmove.start' && (a as { vehicle?: string }).vehicle === 't')).toBe(true);
  });
});

/** One step toward the next Player Turn: pass every fire chance and end every phase. */
function step(engine: Engine, s: GameState): GameState {
  const d = engine.currentDecision(s)!;
  const l = engine.legalActions(s, d.owner);
  const pick = l.find((a) => a.type === 'defPass') ?? l.find((a) => a.type === 'move.end') ?? l.find((a) => a.type === 'endPhase') ?? l[0]!;
  return engine.submit(s, pick).state;
}
