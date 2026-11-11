import { describe, expect, it } from 'vitest';
import type { Action, Engine, GameState } from '@asl/engine';
import { facingOf, hitLocation } from '../src/sk3/facing';
import { sk2CoreModules } from '../src/sk2';
import { sk3CoreModules } from '../src/sk3';
import { T3 } from '../src/sk3/status';
import { RU_VS_GE, act, makeEngine, type PieceSpec } from './fixtures';

/*
 * The To Kill process (SK4 3.2.4, 7.9, 7.10, 7.12), after the SK4 To Hit/To Kill example: a 76L
 * fires at a tank with front armor 6 at range 3 (fixture AP TK 13 → Final TK 7); a TK DR of 8 is a
 * Possible Shock, below 7 a kill, 7 an Immobilization (hull) or Shock (turret).
 */

const extra = [...sk2CoreModules, ...sk3CoreModules];
// Spine 0 points between the N and NE neighbours: a firer three hexes due north is in the front arc.
const t34 = (hex: string, tags: Record<string, string | number | boolean> = {}): PieceSpec => ({ id: 't34', def: 'ru.T34M43', side: 'ru', hex, tags: { vca: 0, ca: 0, ...tags } });
const pziv = (hex: string, tags: Record<string, string | number | boolean> = {}): PieceSpec => ({ id: 'pziv', def: 'ge.pzivf2', side: 'ge', hex, tags: { vca: 3, ca: 3, ...tags } });

function game(pieces: PieceSpec[], dice: number[], startPhase = 'PFPh') {
  return makeEngine({ pieces, scenario: RU_VS_GE, extra, startPhase, dice });
}
const fire = (engine: Engine, state: GameState, shot: Record<string, unknown>) => act(engine, state, { type: 'fire.ordnance', shot } as Omit<Action, 'decisionId' | 'side'>);
const ev = (r: { events: { type: string; payload: unknown }[] }, type: string) => r.events.filter((e) => e.type === type).map((e) => e.payload as Record<string, unknown>);

describe('hit location and facing (SK4 3.2.4)', () => {
  it('turret when the colored die is lower than the white, hull otherwise', () => {
    expect(hitLocation(2, 1)).toBe('turret');
    expect(hitLocation(1, 2)).toBe('hull');
    expect(hitLocation(3, 3)).toBe('hull');
  });
  it('front within the arc, rear within the opposite arc, side between; a bounding hexspine goes to the higher Armor Factor', () => {
    const at = { q: 0, r: 0, s: 0 };
    const af = { front: 11, side: 6, rear: 6 };
    // Spine 0 lies between the N (0,-1,1) and NE (1,-1,0) neighbours: a hex two steps along the N row is strictly in front.
    expect(facingOf(at, 0, { q: 0, r: -2, s: 2 }, af)).toBe('front');
    expect(facingOf(at, 0, { q: 0, r: 2, s: -2 }, af)).toBe('rear');
    // Due west is neither: side.
    expect(facingOf(at, 0, { q: -2, r: 1, s: 1 }, af)).toBe('side');
    // The N neighbour row bounds the front arc of spine 0 and the arc of spine 5: a tie → the higher AF (front 11 over side 6).
    expect(facingOf(at, 0, { q: 0, r: -1, s: 1 }, af)).toBe('front');
    expect(facingOf(at, 0, { q: 0, r: -1, s: 1 }, { front: 4, side: 6, rear: 6 })).toBe('side');
  });
});

describe('AFVs and wrecks as terrain, and repairs (SK4 7.4, 3.1 c)', () => {
  it('a wreck hinders a LOS through its hex (+1) and covers Infantry in it (+1 TEM) once it is no moving target', () => {
    const { engine, state } = makeEngine({ pieces: [{ id: 'sq', def: 'ge.467', side: 'ge', hex: 'yM8' }, { id: 'ru', def: 'ru.447', side: 'ru', hex: 'yM5' }, pziv('yM6', { wreck: true }), { id: 'ru2', def: 'ru.447', side: 'ru', hex: 'yM6' }], scenario: { ...RU_VS_GE, firstSide: 'ge' }, extra, startPhase: 'PFPh', dice: [3, 3] });
    const env = engine.env(state);
    expect(env.query('los.trace', { from: 'yM8', to: 'yM5' }, { clear: true, hindrance: 0, parts: [] })).toMatchObject({ clear: true, hindrance: 1 });
    // The squad fires at the wreck's hex: +1 for the Russian squad sheltering by the wreck (unit DRM), FFMO never.
    const r = act(engine, state, { type: 'fire', decl: { units: ['sq'], sw: [], target: 'yM6' } });
    const res = ev(r, 'sk1.fire.result').find((x) => x['unit'] === 'ru2')!;
    expect(res['drm']).toBe(1);
  });
  it('a malfunctioned Main Armament is repaired on a dr of 1 and disabled (Recall) on a 6, once per Rally Phase', () => {
    const { engine, state } = game([t34('yM8', { malf: true })], [6], 'RPh');
    const d = engine.currentDecision(state)!;
    expect(engine.legalActions(state, 'ru').some((a) => a.type === 'vehicle.repair' && a['weapon'] === 'ma')).toBe(true);
    const r = act(engine, state, { type: 'vehicle.repair', vehicle: 't34', weapon: 'ma' });
    expect(ev(r, 'sk3.vehicle.repair')[0]).toMatchObject({ result: 'disabled', dr: 6 });
    expect(r.state.pieces['t34']!.tags[T3.maDisabled]).toBe(true);
    expect(r.state.pieces['t34']!.tags[T3.recall]).toBe(true);
    void d;
    const ok = game([t34('yM8', { malf: true })], [1], 'RPh');
    const r2 = act(ok.engine, ok.state, { type: 'vehicle.repair', vehicle: 't34', weapon: 'ma' });
    expect(r2.state.pieces['t34']!.tags['malf']).toBeUndefined();
    expect(ok.engine.validate(r2.state, { type: 'vehicle.repair', vehicle: 't34', weapon: 'ma', side: 'ru', decisionId: ok.engine.currentDecision(r2.state)!.id } as never)).toMatch(/not malfunctioned/);
  });
});

describe('the To Kill process (SK4 7.9, 7.10)', () => {
  // The T-34 in M8 fires north at the PzKpfw IVF2 in M5 (range 3), which faces south (spine 3): a frontal shot.
  const setup = (dice: number[], tankTags: Record<string, string | number | boolean> = {}) => game([t34('yM8'), pziv('yM5', tankTags)], dice);

  it('a TK DR one over the Final TK# with AP is a Possible Shock: the crew takes a NTC', () => {
    // To Hit 2+1 = 3 (colored 1 < white 2: turret), To Kill 4+4 = 8 vs Final TK 13 − 6 = 7 → Possible Shock; NTC 3+2 passes.
    const { engine, state } = setup([2, 1, 4, 4, 3, 2]);
    const r = fire(engine, state, { weapon: 't34', target: 'yM5', targetType: 'VTT' });
    const shot = ev(r, 'sk2.ordnance.shot')[0]!;
    expect(shot['outcome']).toBe('hit');
    expect(shot['th']).toBe(10);
    const tk = ev(r, 'sk3.toKill')[0]!;
    expect(tk).toMatchObject({ location: 'turret', facing: 'front', af: 6, tk: 13, finalTk: 7, result: 'possibleShock', shocked: false });
    expect(r.state.pieces['pziv']!.tags[T3.shock]).toBeUndefined();
    const check = ev(r, 'sk3.vehicle.check')[0]!;
    expect(check).toMatchObject({ kind: 'NTC', morale: 8, passed: true });
  });

  it('a failed NTC Shocks the AFV: it Buttons Up and its crew does nothing until it recuperates in a Rally Phase', () => {
    const { engine, state } = setup([2, 1, 4, 4, 6, 4], { ce: true });
    const r = fire(engine, state, { weapon: 't34', target: 'yM5', targetType: 'VTT' });
    expect(ev(r, 'sk3.toKill')[0]!['shocked']).toBe(true);
    expect(r.state.pieces['pziv']!.tags[T3.shock]).toBe('shock');
    expect(r.state.pieces['pziv']!.tags[T3.ce]).toBeUndefined();
  });

  it('a TK DR below the Final TK# destroys the vehicle: a wreck, a ledger row', () => {
    const { engine, state } = setup([2, 1, 3, 3]);
    const r = fire(engine, state, { weapon: 't34', target: 'yM5', targetType: 'VTT' });
    expect(ev(r, 'sk3.toKill')[0]!['result']).toBe('kill');
    expect(r.state.pieces['pziv']!.tags[T3.wreck]).toBe(true);
    expect(r.state.pieces['pziv']!.loc).toEqual({ kind: 'hex', hex: 'yM5' });
    expect(ev(r, 'sk1.casualty')[0]).toMatchObject({ unit: 'pziv', side: 'ge', kind: 'eliminated' });
    // The wreck is no target any more.
    expect(engine.validate(r.state, { type: 'fire.ordnance', shot: { weapon: 't34', target: 'yM5', targetType: 'VTT' }, side: 'ru', decisionId: engine.currentDecision(r.state)!.id } as never)).toMatch(/No enemy vehicle/);
  });

  it('a TK DR equal to the Final TK# Immobilizes on a hull hit and Shocks on a turret hit', () => {
    // Colored 2 ≥ white 1 → hull; Final TK 7; TK DR 3+4 = 7.
    const hull = setup([1, 2, 3, 4]);
    let r = fire(hull.engine, hull.state, { weapon: 't34', target: 'yM5', targetType: 'VTT' });
    expect(ev(r, 'sk3.toKill')[0]).toMatchObject({ location: 'hull', result: 'immobilized' });
    expect(r.state.pieces['pziv']!.tags[T3.immob]).toBe(true);
    const turret = setup([2, 1, 3, 4]);
    r = fire(turret.engine, turret.state, { weapon: 't34', target: 'yM5', targetType: 'VTT' });
    expect(ev(r, 'sk3.toKill')[0]).toMatchObject({ location: 'turret', result: 'shock' });
  });

  it('a rear hit adds 1 to the TK#; a Critical Hit doubles it', () => {
    // The panzer faces north (spine 0): the T-34 to its south strikes the rear (AF 3): TK 13+1 − 3 = 11.
    const rear = game([t34('yM8'), pziv('yM5', { vca: 0, ca: 0 })], [1, 2, 5, 5]);
    let r = fire(rear.engine, rear.state, { weapon: 't34', target: 'yM5', targetType: 'VTT' });
    expect(ev(r, 'sk3.toKill')[0]).toMatchObject({ facing: 'rear', af: 3, modifiedTk: 14, finalTk: 11, result: 'kill' });
    // An original 2 on the Vehicle Target Type is a Critical Hit: TK 13 × 2 = 26 − 6 = 20.
    const ch = setup([1, 1, 6, 5]);
    r = fire(ch.engine, ch.state, { weapon: 't34', target: 'yM5', targetType: 'VTT' });
    expect(ev(r, 'sk2.ordnance.shot')[0]!['outcome']).toBe('ch');
    expect(ev(r, 'sk3.toKill')[0]).toMatchObject({ modifiedTk: 26, finalTk: 20, result: 'kill' });
  });

  it('a hit that does nothing to the AFV attacks a CE crew collaterally with the same DR (+2 CE)', () => {
    // TK DR 5+5 = 10 vs Final TK 7: no effect on the AFV; the 76L's 12 FP column at 10+2 = 12 → no effect either, but the attack is made.
    const { engine, state } = setup([2, 1, 5, 5], { ce: true });
    const r = fire(engine, state, { weapon: 't34', target: 'yM5', targetType: 'VTT' });
    expect(ev(r, 'sk3.toKill')[0]!['result']).toBe('none');
    const col = ev(r, 'sk3.collateral')[0]!;
    expect(col).toMatchObject({ target: 'pziv', drm: 2 });
  });

  it('a BU target ignores the collateral attack; a Buttoned Up firer takes +1 To Hit (case 13) and a CE one does not', () => {
    const bu = setup([2, 1, 5, 5]);
    let r = fire(bu.engine, bu.state, { weapon: 't34', target: 'yM5', targetType: 'VTT' });
    expect(ev(r, 'sk3.collateral')).toHaveLength(0);
    expect(ev(r, 'sk2.ordnance.shot')[0]!['drm']).toBe(1);
    // The T-34's Restricted Slow Traverse turret cannot fire CE at all (SK4 7.2); a Fast Turret panzer can, without the +1.
    const rst = game([t34('yM8', { ce: true }), pziv('yM5')], [2, 1, 5, 5]);
    expect(rst.engine.validate(rst.state, { type: 'fire.ordnance', shot: { weapon: 't34', target: 'yM5', targetType: 'VTT' }, side: 'ru', decisionId: rst.engine.currentDecision(rst.state)!.id } as never)).toMatch(/Restricted Slow Traverse/);
    const ce = makeEngine({ pieces: [pziv('yM5', { ce: true, vca: 3, ca: 3 }), t34('yM8')], scenario: { ...RU_VS_GE, firstSide: 'ge' }, extra, startPhase: 'PFPh', dice: [2, 1, 5, 5] });
    r = fire(ce.engine, ce.state, { weapon: 'pziv', target: 'yM8', targetType: 'VTT' });
    expect(ev(r, 'sk2.ordnance.shot')[0]!['drm']).toBe(0);
  });

  it('Infantry fire does nothing to a BU AFV; against a CE crew it is an IFT attack that can Stun the AFV', () => {
    // A German squad in M6 fires at the T-34 in M5 (adjacent): 4 FP doubled = 8 column.
    const bu = makeEngine({ pieces: [{ id: 'sq', def: 'ge.467', side: 'ge', hex: 'yM6' }, t34('yM5')], scenario: { ...RU_VS_GE, firstSide: 'ge' }, extra, startPhase: 'PFPh', dice: [1, 1] });
    let r = act(bu.engine, bu.state, { type: 'fire', decl: { units: ['sq'], sw: [], target: 'yM5' } });
    expect(ev(r, 'sk1.fire.result')[0]).toMatchObject({ unit: 't34', result: { kind: 'none' } });
    expect(r.state.pieces['t34']!.tags[T3.stun]).toBeUndefined();
    // CE: the same 2 on the 8 column is a 2KIA on the crew → STUN and Recall.
    const ce = makeEngine({ pieces: [{ id: 'sq', def: 'ge.467', side: 'ge', hex: 'yM6' }, t34('yM5', { ce: true })], scenario: { ...RU_VS_GE, firstSide: 'ge' }, extra, startPhase: 'PFPh', dice: [1, 1] });
    r = act(ce.engine, ce.state, { type: 'fire', decl: { units: ['sq'], sw: [], target: 'yM5' } });
    expect(r.state.pieces['t34']!.tags[T3.stun]).toBe('fresh');
    expect(r.state.pieces['t34']!.tags[T3.recall]).toBe(true);
    expect(r.state.pieces['t34']!.tags[T3.ce]).toBeUndefined();
  });

  it('Shock recuperates in the Rally Phase: 1-2 recovers, 3-6 becomes an Unconfirmed Kill, which on 4-6 is a wreck', () => {
    const { engine, state } = game([t34('yM8'), pziv('yM5', { shock: 'shock' })], [5, 6], 'CCPh');
    // End the CCPh: the German Player Turn starts with a RPh and the recuperation dr (5 → UK).
    let s = act(engine, state, { type: 'endPhase' }).state;
    expect(s.pieces['pziv']!.tags[T3.shock]).toBe('uk');
    // Next RPh (after the Russian turn, the German one): dr 6 → wreck. Walk the phases.
    for (let i = 0; i < 20 && s.pieces['pziv']!.tags[T3.shock] === 'uk'; i++) {
      const d = engine.currentDecision(s)!;
      const legal = engine.legalActions(s, d.owner).find((a) => a.type === 'endPhase' || a.type === 'defPass');
      if (!legal) break;
      s = engine.submit(s, { ...legal, side: d.owner, decisionId: d.id } as never).state;
    }
    expect(s.pieces['pziv']!.tags[T3.wreck]).toBe(true);
  });
});
