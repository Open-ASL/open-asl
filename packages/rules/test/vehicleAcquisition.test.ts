import { describe, expect, it } from 'vitest';
import type { Engine, GameState } from '@asl/engine';
import { sk2CoreModules } from '../src/sk2';
import { sk3CoreModules } from '../src/sk3';
import { RU_VS_GE, act, makeEngine, type PieceSpec } from './fixtures';

/*
 * An AFV's Acquisition and its machine guns (SK4 6.10): "The target remains acquired until ... an AFV fires its CMG
 * at a different hex". ASLRB C6.5 says the same ("the Gun (or its CMG unless in a separate turret) attacks ... a
 * different target"): the CMG shares the MA's turret and sight. The BMG, AAMG and RMG are named in neither, so their
 * fire leaves the MA's Acquisition alone.
 */

const extra = [...sk2CoreModules, ...sk3CoreModules];
/** A PzKw IVF2 (BMG and CMG) in yM8 facing north; its MA has acquired the Russian squad in yM6; another squad in yM4. */
const ACQ = { acq: 'ITT', acqHex: 'yM6', acqUnits: 'r', acqLevel: 1 };
const pz: PieceSpec = { id: 'pz', def: 'ge.pzivf2', side: 'ge', hex: 'yM8', tags: { vca: 0, ca: 0, ...ACQ } };
const pieces: PieceSpec[] = [pz, { id: 'r', def: 'ru.447', side: 'ru', hex: 'yM6' }, { id: 'r2', def: 'ru.447', side: 'ru', hex: 'yM4' }];
const game = (dice: number[] = []) => makeEngine({ scenario: { ...RU_VS_GE, firstSide: 'ge' }, extra, startPhase: 'PFPh', dice, pieces });
const ev = (r: { events: { type: string; payload: unknown }[] }, type: string) => r.events.filter((e) => e.type === type).map((e) => e.payload as Record<string, unknown>);
const acquiredDrm = (r: { events: { type: string; payload: unknown }[] }) =>
  (ev(r, 'sk2.ordnance.shot')[0] as { explain: { id: string }[] }).explain.some((x) => x.id === 'sk2.th.acquired');
const acqOf = (s: GameState) => {
  const t = s.pieces['pz']!.tags;
  return t['acq'] === undefined ? null : { acq: t['acq'], acqHex: t['acqHex'], acqUnits: t['acqUnits'], acqLevel: t['acqLevel'] };
};
const mgFire = (engine: Engine, state: GameState, sw: string[], target: string) => act(engine, state, { type: 'fire', decl: { units: [], sw, target } });

describe("an AFV's Acquisition and its MG fire (SK4 6.10; ASLRB C6.5)", () => {
  it('the CMG fired at a different hex loses the MA\'s Acquisition; the next MA shot there has no Acquisition DRM', () => {
    const { engine, state } = game([6, 5, 6, 5]);
    expect(acqOf(state)).toEqual(ACQ);
    const r = mgFire(engine, state, ['pz.cmg'], 'yM4');
    expect(ev(r, 'sk1.fire.attack')).toHaveLength(1);
    expect(acqOf(r.state)).toBeNull();
    // Back at the squad it had acquired: no DRM, and a fresh -1.
    const t = act(engine, r.state, { type: 'fire.ordnance', shot: { weapon: 'pz', target: 'yM6', targetType: 'ITT' } });
    expect(acquiredDrm(t)).toBe(false);
    expect(acqOf(t.state)).toMatchObject({ acqHex: 'yM6', acqUnits: 'r', acqLevel: 1 });
  });

  it('the CMG fired in a Fire Group with the BMG at a different hex loses it too', () => {
    const { engine, state } = game([6, 5]);
    const r = mgFire(engine, state, ['pz.bmg', 'pz.cmg'], 'yM4');
    expect(ev(r, 'sk1.fire.attack')).toHaveLength(1);
    expect(acqOf(r.state)).toBeNull();
  });

  it('the CMG fired at the acquired hex keeps it; the MA then fires with the DRM', () => {
    const { engine, state } = game([6, 5, 6, 5]);
    const r = mgFire(engine, state, ['pz.cmg'], 'yM6');
    expect(ev(r, 'sk1.fire.attack')).toHaveLength(1);
    expect(acqOf(r.state)).toEqual(ACQ);
    const t = act(engine, r.state, { type: 'fire.ordnance', shot: { weapon: 'pz', target: 'yM6', targetType: 'ITT' } });
    expect(acquiredDrm(t)).toBe(true);
    expect(acqOf(t.state)).toMatchObject({ acqHex: 'yM6', acqLevel: 2 });
  });

  it('the BMG alone fired at a different hex keeps it (SK4 names only the CMG)', () => {
    const { engine, state } = game([6, 5]);
    const r = mgFire(engine, state, ['pz.bmg'], 'yM4');
    expect(ev(r, 'sk1.fire.attack')).toHaveLength(1);
    expect(acqOf(r.state)).toEqual(ACQ);
  });

  it('after the CMG shot the tank plays on: the next Player Turn it fires its MA and MGs normally', () => {
    const { engine, state } = game([6, 5, 6, 5, 6, 5, 6, 5, 6, 5, 6, 5]);
    let s = mgFire(engine, state, ['pz.cmg'], 'yM4').state;
    expect(acqOf(s)).toBeNull();
    for (let i = 0; i < 80 && !(s.phase === 'PFPh' && s.attacker === 'ge' && s.turn === 2); i++) {
      const d = engine.currentDecision(s)!;
      s = act(engine, s, { type: d.kind === 'firstFire' ? 'defPass' : 'endPhase', side: d.owner }).state;
    }
    expect([s.turn, s.attacker, s.phase]).toEqual([2, 'ge', 'PFPh']);
    expect(acqOf(s)).toBeNull();
    const t = act(engine, s, { type: 'fire.ordnance', shot: { weapon: 'pz', target: 'yM6', targetType: 'ITT' } });
    expect(ev(t, 'sk2.ordnance.shot')).toHaveLength(1);
    expect(acquiredDrm(t)).toBe(false);
    expect(acqOf(t.state)).toMatchObject({ acqHex: 'yM6', acqLevel: 1 });
    const d = engine.currentDecision(t.state)!;
    expect(engine.validate(t.state, { type: 'fire', decl: { units: [], sw: ['pz.cmg'], target: 'yM4' }, side: 'ge', decisionId: d.id } as never)).toBeNull();
  });
});
