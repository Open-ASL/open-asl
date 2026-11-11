import { describe, expect, it } from 'vitest';
import type { Action, Engine, GameState } from '@asl/engine';
import { buildAttack } from '../src/sk1/fire';
import { moveState } from '../src/sk1/movement';
import { sk2CoreModules } from '../src/sk2';
import { sk3CoreModules } from '../src/sk3';
import { caChangeDrm, inCoveredArc, nearestSpine, spineChange, statics, turretTurnFor } from '../src';
import { T3, tcaOf } from '../src/sk3/status';
import { RU_VS_GE, act, makeEngine, type PieceSpec } from './fixtures';

/*
 * Fire by vehicles (SK4 3.3.2.2, 3.5, 7.8): Bounding First Fire with its case 14 DRM by MP spent in
 * the target's LOS, Motion fire (case 16), the Advancing Fire of a vehicle that moved, and the
 * vehicular MGs with their arcs and halving.
 */

const extra = [...sk2CoreModules, ...sk3CoreModules];
const t34 = (hex: string, tags: Record<string, string | number | boolean> = {}): PieceSpec => ({ id: 't34', def: 'ru.T34M43', side: 'ru', hex, tags: { vca: 0, ca: 0, ...tags } });
const pziv = (hex: string, tags: Record<string, string | number | boolean> = {}): PieceSpec => ({ id: 'pziv', def: 'ge.pzivf2', side: 'ge', hex, tags: { vca: 3, ca: 3, ...tags } });
const game = (pieces: PieceSpec[], dice: number[], startPhase = 'MPh') => makeEngine({ pieces, scenario: RU_VS_GE, extra, startPhase, dice });
/** Play actions for the mover, passing every Defensive First Fire chance the defender is offered on the way. */
const passDff = (engine: Engine, s: GameState) => {
  while (engine.currentDecision(s)?.kind === 'firstFire') s = act(engine, s, { type: 'defPass' }).state;
  return s;
};
const play = (engine: Engine, state: GameState, ...actions: (Omit<Action, 'decisionId' | 'side'> & { side?: string })[]) => {
  let s = state;
  for (const a of actions) s = passDff(engine, act(engine, s, a).state);
  return s;
};
const ev = (r: { events: { type: string; payload: unknown }[] }, type: string) => r.events.filter((e) => e.type === type).map((e) => e.payload as Record<string, unknown>);

describe('Bounding First Fire (SK4 3.3.2.2)', () => {
  it('a moving vehicle fires its MA from its hex: +6 with ≤ 2 MP spent in the target\'s LOS, +5 at 2.5–3, +4 beyond 3; no case 8; no acquisition', () => {
    // T-34 at M9 drives north toward the panzer at M4 (facing south): start 1 MP, enter M8 (2 MP in LOS), fire.
    const { engine, state } = game([t34('yM9'), pziv('yM4')], [6, 6, 6, 6]);
    let s = play(engine, state, { type: 'vmove.start', vehicle: 't34' });
    const d0 = engine.currentDecision(s)!;
    // Firing before entering a hex: 1 MP in LOS → +6 (T/ST), BU +1.
    expect(engine.validate(s, { type: 'vmove.bff', shot: { weapon: 't34', target: 'yM4', targetType: 'VTT' }, side: 'ru', decisionId: d0.id } as never)).toBeNull();
    s = play(engine, s, { type: 'move.step', to: 'yM8' });
    // Firing without stopping is Non-Stopped fire: case 16 adds the lower die (6) on top of case 14 (+6, 2 MP in LOS) and BU +1.
    const d1 = engine.currentDecision(s)!;
    const unstopped = engine.submit(s, { type: 'vmove.bff', shot: { weapon: 't34', target: 'yM4', targetType: 'VTT' }, side: 'ru', decisionId: d1.id } as never);
    expect(ev(unstopped, 'sk2.ordnance.shot')[0]!['drm']).toBe(13);
    // Stopped first (1 more MP in LOS: 3): +5 case 14, +1 BU.
    s = play(engine, s, { type: 'vmove.stop' });
    const r = act(engine, s, { type: 'vmove.bff', shot: { weapon: 't34', target: 'yM4', targetType: 'VTT' } });
    r.state = passDff(engine, r.state);
    const shot = ev(r, 'sk2.ordnance.shot')[0]!;
    expect(shot['mode']).toBe('bounding');
    expect(shot['drm']).toBe(6);
    expect(ev(r, 'sk2.acquired')).toHaveLength(0);
    expect(r.state.pieces['t34']!.tags[T3.bff]).toBe(true);
    expect(r.state.pieces['t34']!.tags['fire']).toBe('bff');
    // ROF lost (colored 6): no second shot, and no Advancing Fire later; the vehicle may still start again and drive on.
    const d = engine.currentDecision(r.state)!;
    expect(engine.validate(r.state, { type: 'vmove.bff', shot: { weapon: 't34', target: 'yM4', targetType: 'VTT' }, side: 'ru', decisionId: d.id } as never)).toMatch(/lost ROF/);
    expect(engine.legalActions(r.state, 'ru').some((a) => a.type === 'vmove.start')).toBe(true);
  });

  it('with ROF kept the MA fires again after another MP, and once more in the AFPh (case 14 at +4)', () => {
    // Colored 1 keeps ROF (T-34 ROF 1).
    const { engine, state } = game([t34('yM9'), pziv('yM4')], [6, 1, 6, 6, 6, 1, 6, 6]);
    let s = play(engine, state, { type: 'vmove.start', vehicle: 't34' }, { type: 'move.step', to: 'yM8' }, { type: 'vmove.stop' });
    let r = act(engine, s, { type: 'vmove.bff', shot: { weapon: 't34', target: 'yM4', targetType: 'VTT' } });
    r.state = passDff(engine, r.state);
    expect(r.state.pieces['t34']!.tags[T3.bffRof]).toBe(true);
    const d = engine.currentDecision(r.state)!;
    expect(engine.validate(r.state, { type: 'vmove.bff', shot: { weapon: 't34', target: 'yM4', targetType: 'VTT' }, side: 'ru', decisionId: d.id } as never)).toMatch(/another MP/);
    // A Delay MP is an expenditure: fire again, still stopped, now 4 MP in LOS → +4, BU +1.
    s = play(engine, r.state, { type: 'vmove.delay', mp: 1 });
    r = act(engine, s, { type: 'vmove.bff', shot: { weapon: 't34', target: 'yM4', targetType: 'VTT' } });
    r.state = passDff(engine, r.state);
    expect(ev(r, 'sk2.ordnance.shot')[0]!['drm']).toBe(5);
    s = r.state;
  });

  it('the Bounding First Fire marker and record come off when the AFPh ends', () => {
    // Colored 6 loses ROF: the T-34 is marked Bounding First Fire.
    const { engine, state } = game([t34('yM9'), pziv('yM4')], [6, 6, 6, 6, 6, 6]);
    const s = play(engine, state, { type: 'vmove.start', vehicle: 't34' }, { type: 'move.step', to: 'yM8' }, { type: 'vmove.stop' });
    let r = act(engine, s, { type: 'vmove.bff', shot: { weapon: 't34', target: 'yM4', targetType: 'VTT' } });
    let st = passDff(engine, r.state);
    expect(st.pieces['t34']!.tags['fire']).toBe('bff');
    expect(st.pieces['t34']!.tags[T3.bff]).toBe(true);
    st = play(engine, st, { type: 'vmove.end' });
    for (let i = 0; i < 12 && !(st.phase === 'RtPh' || st.phase === 'APh' || st.phase === 'CCPh'); i++) {
      r = act(engine, st, { type: 'endPhase' });
      st = passDff(engine, r.state);
    }
    expect(st.pieces['t34']!.tags['fire']).toBeUndefined();
    expect(st.pieces['t34']!.tags[T3.bff]).toBeUndefined();
    expect(st.pieces['t34']!.tags[T3.bffRof]).toBeUndefined();
  });

  it('a vehicle that moved fires Bounding Fire in the AFPh at +4 (turret) instead of the +2 of a Gun that did not move', () => {
    const { engine, state } = game([t34('yM9', { moved: true }), pziv('yM4')], [3, 3], 'AFPh');
    const r = act(engine, state, { type: 'fire.ordnance', shot: { weapon: 't34', target: 'yM4', targetType: 'VTT' } });
    const shot = ev(r, 'sk2.ordnance.shot')[0]!;
    expect(shot['drm']).toBe(5);
    expect((shot['explain'] as { label: string }[]).map((x) => x.label).join(' ')).toMatch(/Bounding Fire/);
  });

  it('a vehicle in Motion may not Prep Fire; in the DFPh it fires with the lower die added again (case 16)', () => {
    const prep = game([t34('yM9', { motion: true }), pziv('yM4')], [3, 3], 'PFPh');
    expect(prep.engine.validate(prep.state, { type: 'fire.ordnance', shot: { weapon: 't34', target: 'yM4', targetType: 'VTT' }, side: 'ru', decisionId: prep.engine.currentDecision(prep.state)!.id } as never)).toMatch(/Motion/);
    // German DFPh: the panzer in Motion fires at the T-34: DR 4+2 → +2 (lower die) besides case 14's first row (+4, turret) and +1 BU.
    const df = makeEngine({ pieces: [t34('yM9'), pziv('yM4', { motion: true })], scenario: RU_VS_GE, extra, startPhase: 'DFPh', dice: [4, 2] });
    const r = act(df.engine, df.state, { type: 'fire.ordnance', shot: { weapon: 'pziv', target: 'yM9', targetType: 'VTT' } });
    const shot = ev(r, 'sk2.ordnance.shot')[0]!;
    expect(shot['drm']).toBe(4 + 1 + 2);
    // The Infantry Target Type is not for a hex holding only a vehicle.
    expect(df.engine.validate(df.state, { type: 'fire.ordnance', shot: { weapon: 'pziv', target: 'yM9', targetType: 'ITT' }, side: 'ge', decisionId: df.engine.currentDecision(df.state)!.id } as never)).toMatch(/Vehicle Target Type/);
  });
});

describe('vehicular machine guns (SK4 7.8)', () => {
  it('the BMG fires through the VCA and the CMG through the TCA, together as one attack that never cowers', () => {
    // A German squad in M6, the T-34 in M8 facing north (VCA 0, turret also 0): both MGs bear (BMG 2 + CMG 4 = 6 FP, PBF? no: 2 hexes).
    const { engine, state } = makeEngine({ pieces: [t34('yM8'), { id: 'sq', def: 'ge.467', side: 'ge', hex: 'yM6' }], scenario: RU_VS_GE, extra, startPhase: 'PFPh', dice: [6, 6] });
    const bmg = `t34.bmg`;
    const cmg = `t34.cmg`;
    expect(state.pieces[bmg]).toBeDefined();
    const r = act(engine, state, { type: 'fire', decl: { units: [], sw: [bmg, cmg], target: 'yM6' } });
    const atk = ev(r, 'sk1.fire.attack')[0]!;
    expect(atk['fp']).toBe(6);
    expect(atk['cowered']).toBe(false);
    expect(r.state.pieces[bmg]!.tags['fire']).toBe('prep');
    // Now the MA may fire in the PFPh too (same phase), but not in the AFPh.
    expect(engine.validate(r.state, { type: 'fire.ordnance', shot: { weapon: 't34', target: 'yM6', targetType: 'ITT' }, side: 'ru', decisionId: engine.currentDecision(r.state)!.id } as never)).toBeNull();
  });
  it('a vehicular MG malfunctions on an original DR of 12 (SK4 7.8), firing alone or after the other MG', () => {
    // CMG alone on a 12.
    {
      const { engine, state } = makeEngine({ pieces: [t34('yM8'), { id: 'sq', def: 'ge.467', side: 'ge', hex: 'yM6' }], scenario: RU_VS_GE, extra, startPhase: 'PFPh', dice: [6, 6] });
      const r = act(engine, state, { type: 'fire', decl: { units: [], sw: ['t34.cmg'], target: 'yM6' } });
      expect(r.state.pieces['t34.cmg']!.tags['malf']).toBe(true);
      expect(r.state.pieces['t34.bmg']!.tags['malf']).toBeUndefined();
      expect(ev(r, 'piece.tagged').some((t) => t['id'] === 't34.cmg' && (t['tags'] as Record<string, unknown>)['malf'] === true)).toBe(true);
    }
    // The BMG first (DR 6), then the CMG on a 12 at another target: the CMG breaks, the BMG is untouched.
    {
      const sq2 = { id: 'sq2', def: 'ge.467', side: 'ge', hex: 'yM5' };
      const { engine, state } = makeEngine({ pieces: [t34('yM8'), { id: 'sq', def: 'ge.467', side: 'ge', hex: 'yM6' }, sq2], scenario: RU_VS_GE, extra, startPhase: 'PFPh', dice: [3, 3, 6, 6] });
      const r1 = act(engine, state, { type: 'fire', decl: { units: [], sw: ['t34.bmg'], target: 'yM6' } });
      // Not at the BMG's target: the vehicle's MGs attacking one target fire together (Mandatory FG).
      expect(engine.validate(r1.state, { type: 'fire', decl: { units: [], sw: ['t34.cmg'], target: 'yM6' }, side: 'ru', decisionId: engine.currentDecision(r1.state)!.id } as never)).toMatch(/Mandatory Fire Group/);
      const r = act(engine, r1.state, { type: 'fire', decl: { units: [], sw: ['t34.cmg'], target: 'yM5' } });
      expect(r.state.pieces['t34.cmg']!.tags['malf']).toBe(true);
      expect(r.state.pieces['t34.bmg']!.tags['malf']).toBeUndefined();
      // A malfunctioned MG may not fire.
      expect(engine.validate(r.state, { type: 'fire', decl: { units: [], sw: ['t34.cmg'], target: 'yM5' }, side: 'ru', decisionId: engine.currentDecision(r.state)!.id } as never)).not.toBeNull();
    }
  });
  it('a vehicle in Motion fires its MGs at half FP outside its own MPh too (SK4 2.0 Motion Fire)', () => {
    const fire = (tags: Record<string, string | number | boolean>) => {
      const { engine, state } = makeEngine({ pieces: [t34('yM8', tags), { id: 'sq', def: 'ge.467', side: 'ge', hex: 'yM6' }], scenario: { ...RU_VS_GE, firstSide: 'ge' }, extra, startPhase: 'DFPh', dice: [4, 4] });
      return ev(act(engine, state, { type: 'fire', decl: { units: [], sw: ['t34.bmg', 't34.cmg'], target: 'yM6' } }), 'sk1.fire.attack')[0]!;
    };
    // BMG 2 + CMG 4 = 6 FP stopped; 3 in Motion.
    expect(fire({})).toMatchObject({ fp: 6, column: 6 });
    const moving = fire({ [T3.motion]: true });
    expect(moving).toMatchObject({ fp: 3, column: 2 });
    expect((moving['fpExplain'] as { label: string }[]).map((n) => n.label)).toContain('½ vehicle in Motion');
  });
  it('a MA shot that kept ROF still marks the vehicle Prep Fire when the PFPh ends: no move, no CE change, no AFPh fire', () => {
    // TH DR 6+1: the colored 1 keeps the T-34's ROF 1, so the MA is unmarked and may fire again this phase.
    const { engine, state } = makeEngine({ pieces: [t34('yM8'), { id: 'sq', def: 'ge.467', side: 'ge', hex: 'yM6' }], scenario: RU_VS_GE, extra, startPhase: 'PFPh', dice: [6, 1, 4, 4, 4, 4, 4, 4] });
    const r = act(engine, state, { type: 'fire.ordnance', shot: { weapon: 't34', target: 'yM6', targetType: 'ITT' } });
    expect(ev(r, 'sk2.ordnance.rof')[0]).toMatchObject({ weapon: 't34', kept: true });
    expect(r.state.pieces['t34']!.tags['fire']).toBeUndefined();
    const again = (s: GameState) => engine.validate(s, { type: 'fire.ordnance', shot: { weapon: 't34', target: 'yM6', targetType: 'ITT' }, side: 'ru', decisionId: engine.currentDecision(s)!.id } as never);
    expect(again(r.state)).toBeNull();
    // The PFPh over, it has Prep Fired (SK1 3.2.2): the marker goes on, and the vehicle neither moves nor changes CE (SK4 3.3).
    const mph = act(engine, r.state, { type: 'endPhase' }).state;
    expect(mph.phase).toBe('MPh');
    expect(mph.pieces['t34']!.tags['fire']).toBe('prep');
    expect(mph.pieces['t34']!.tags['rofFired']).toBeUndefined();
    const d = engine.currentDecision(mph)!;
    expect(engine.validate(mph, { type: 'vmove.start', vehicle: 't34', side: 'ru', decisionId: d.id } as never)).toMatch(/fired in the PFPh/);
    expect(engine.validate(mph, { type: 'vmove.ce', vehicle: 't34', ce: true, side: 'ru', decisionId: d.id } as never)).toMatch(/Prep Fire/);
    // Nor does it fire again in the AFPh (SK1 3.5), MA or MGs.
    let s = act(engine, mph, { type: 'endPhase' }).state;
    s = act(engine, s, { type: 'endPhase' }).state;
    expect(s.phase).toBe('AFPh');
    expect(again(s)).toMatch(/already fired/);
    expect(engine.validate(s, { type: 'fire', decl: { units: [], sw: ['t34.cmg'], target: 'yM6' }, side: 'ru', decisionId: engine.currentDecision(s)!.id } as never)).toMatch(/same fire phase/);
  });
  it('a target outside the arc needs a turn; the AAMG needs CE; a FG with Infantry is refused', () => {
    const { engine, state } = makeEngine({ pieces: [t34('yM8', { ca: 3 }), { id: 'sq', def: 'ge.467', side: 'ge', hex: 'yM6' }, { id: 'ru', def: 'ru.447', side: 'ru', hex: 'yM8' }], scenario: RU_VS_GE, extra, startPhase: 'PFPh', dice: [2, 2] });
    const d = engine.currentDecision(state)!;
    expect(engine.validate(state, { type: 'fire', decl: { units: [], sw: ['t34.cmg'], target: 'yM6' }, side: 'ru', decisionId: d.id } as never)).toMatch(/Turret Covered Arc/);
    expect(engine.validate(state, { type: 'fire', decl: { units: ['ru'], sw: ['t34.bmg'], target: 'yM6' }, side: 'ru', decisionId: d.id } as never)).toMatch(/only with each other/);
    expect(engine.validate(state, { type: 'fire', decl: { units: [], sw: ['t34.bmg'], target: 'yM6' }, side: 'ru', decisionId: d.id } as never)).toBeNull();
  });
  it('never fires FPF (ASLRB A8.31: Infantry only), so the vehicle is never put to its NMC', () => {
    const { engine, state } = makeEngine({ pieces: [t34('yM8', { fire: 'final' }), { id: 'sq', def: 'ge.467', side: 'ge', hex: 'yM7' }], scenario: RU_VS_GE, extra, startPhase: 'PFPh' });
    const illegal = (mode: string) => engine.env(state).query('fire.illegal', { decl: { units: [], sw: ['t34.cmg'], target: 'yM7' }, mode: mode as never, side: 'ru' }, null);
    expect(illegal('fpf')).toMatch(/Infantry only/);
    expect(illegal('subsequentFirst') ?? '').not.toMatch(/Infantry only/);
  });
  it('in the MPh the MGs fire Bounding First Fire at half FP (a quarter while Non-Stopped) and forfeit the AFPh', () => {
    const { engine, state } = game([t34('yM9'), { id: 'sq', def: 'ge.467', side: 'ge', hex: 'yM6' }], [6, 6, 3, 3]);
    let s = play(engine, state, { type: 'vmove.start', vehicle: 't34' }, { type: 'move.step', to: 'yM8' });
    const r = act(engine, s, { type: 'vmove.bffMg', decl: { units: [], sw: ['t34.bmg', 't34.cmg'], target: 'yM6' } });
    r.state = passDff(engine, r.state);
    const atk = ev(r, 'sk1.fire.attack')[0]!;
    // 6 FP quartered (not stopped) = 1.5 → 1 column.
    expect(atk['column']).toBe(1);
    expect(r.state.pieces['t34']!.tags[T3.bff]).toBe(true);
    s = r.state;
    void moveState;
  });
  it('a mover wrecked on its way is no target for the fire that follows (it would take Morale Checks, break and be offered rally)', () => {
    const { engine, state } = game([t34('yM8', { wreck: true }), { id: 'ru', def: 'ru.447', side: 'ru', hex: 'yM8' }, pziv('yM4')], []);
    const atk = buildAttack(engine.env(state), { units: [], sw: ['pziv.cmg'], target: 'yM8' }, 'first', 'ge', ['t34', 'ru']);
    expect(atk.targets).toEqual(['ru']);
  });
  it('a turret turned off the hull line fires its CMG alone when the BMG cannot bear (each MG has its own arc)', () => {
    // Hull toward spine 1 (NE/SE), turret toward spine 0 (N/NE): the squad due north at M6 is in the TCA only.
    const { engine, state } = game([t34('yM8', { vca: 1, ca: 0 }), { id: 'sq', def: 'ge.467', side: 'ge', hex: 'yM6' }], [3, 3]);
    const s = play(engine, state, { type: 'vmove.start', vehicle: 't34' });
    const offered = engine.legalActions(s, 'ru').filter((a) => a.type === 'vmove.bffMg' && (a['decl'] as { target: string }).target === 'yM6');
    expect(offered.map((a) => (a['decl'] as { sw: string[] }).sw)).toEqual([['t34.cmg']]);
    const r = act(engine, s, { type: 'vmove.bffMg', decl: { units: [], sw: ['t34.cmg'], target: 'yM6' } });
    expect(ev(r, 'sk1.fire.attack')[0]).toBeDefined();
  });
});

describe('smoke dispensers and Motion attempts (SK4 7.5, 3.3.2.1)', () => {
  it('a moving panzer dispenses sD smoke in its own hex for 1 MP on a DR ≤ 6 (+1 BU), once per turn and never after firing', () => {
    const { engine, state } = makeEngine({ pieces: [pziv('yM8', { ce: true })], scenario: { ...RU_VS_GE, firstSide: 'ge' }, extra, startPhase: 'MPh', dice: [3, 3] });
    let s = play(engine, state, { type: 'vmove.start', vehicle: 'pziv' });
    const r = act(engine, s, { type: 'vmove.smoke' });
    expect(ev(r, 'sk3.vehicle.smoke')[0]).toMatchObject({ kind: 'sD', n: 6, drm: 0, placed: true, hex: 'yM8' });
    expect(r.state.hexMarkers['yM8']?.['smoke58']).toBe('smoke');
    expect(moveState(engine.env(passDff(engine, r.state)))!.spent['pziv']).toBe(2);
    s = passDff(engine, r.state);
    expect(engine.validate(s, { type: 'vmove.smoke', side: 'ge', decisionId: engine.currentDecision(s)!.id } as never)).toMatch(/used this Player Turn/);
  });
  it('a defending AFV not fired at a mover it could not see at the start of the turn may attempt Motion: dr ≤ the MP spent in its LOS', () => {
    // The panzer (facing south, turret too) in M4 sees the T-34 start in M9... so set the T-34 behind a woods wall? Simplest: no LOS at RPh start is
    // what the snapshot records; a fresh game has no snapshot, so the mover counts as unseen.
    const { engine, state } = game([t34('yM9'), pziv('yM4')], [6, 2, 1]);
    let s = act(engine, state, { type: 'vmove.start', vehicle: 't34' }).state;
    // The start MP in LOS of the panzer: a First Fire chance for the German, who tries for Motion instead (needs dr ≤ 1).
    expect(engine.currentDecision(s)!.kind).toBe('firstFire');
    expect(engine.legalActions(s, 'ge').some((a) => a.type === 'defMotion')).toBe(true);
    const r = act(engine, s, { type: 'defMotion', vehicle: 'pziv' });
    expect(ev(r, 'sk3.vehicle.motionAttempt')[0]).toMatchObject({ mp: 1, success: false });
    s = passDff(engine, r.state);
    // One attempt per MPh; after another MP the chance is gone for this MPh.
    s = act(engine, s, { type: 'move.step', to: 'yM8' }).state;
    expect(engine.currentDecision(s)!.kind).toBe('firstFire');
    expect(engine.validate(s, { type: 'defMotion', vehicle: 'pziv', side: 'ge', decisionId: engine.currentDecision(s)!.id } as never)).toMatch(/One Motion attempt/);
  });
  it('the dr target is the MP spent in the vehicle\'s LOS, which the UI reads from a query', () => {
    const { engine, state } = game([t34('yM9'), pziv('yM4')], [6]);
    const s = act(engine, state, { type: 'vmove.start', vehicle: 't34' }).state;
    expect(engine.env(s).query('vehicle.motionMp', { vehicle: 'pziv' }, 0)).toBe(1);
  });
  it('a successful attempt puts the AFV in Motion and lets it change its VCA/TCA freely before the First Fire question returns', () => {
    const { engine, state } = game([t34('yM9'), pziv('yM4')], [1]);
    let s = act(engine, state, { type: 'vmove.start', vehicle: 't34' }).state;
    const r = act(engine, s, { type: 'defMotion', vehicle: 'pziv' });
    expect(ev(r, 'sk3.vehicle.motionAttempt')[0]).toMatchObject({ mp: 1, success: true });
    s = r.state;
    expect(s.pieces['pziv']!.tags[T3.motion]).toBe(true);
    const d = engine.currentDecision(s)!;
    expect(d.kind).toBe('motionFacing');
    expect(d.owner).toBe('ge');
    // Any hexspine at once, no MP; the turret turns with the hull (3 → 0 carries the turret 3 → 0 too).
    s = act(engine, s, { type: 'defMotion.turn', vehicle: 'pziv', vca: 0 }).state;
    expect(s.pieces['pziv']!.tags['vca']).toBe(0);
    expect(s.pieces['pziv']!.tags['ca']).toBe(0);
    s = act(engine, s, { type: 'defMotion.turret', vehicle: 'pziv', tca: 5 }).state;
    expect(s.pieces['pziv']!.tags['ca']).toBe(5);
    expect(engine.currentDecision(s)!.kind).toBe('motionFacing');
    s = act(engine, s, { type: 'defMotion.done', vehicle: 'pziv' }).state;
    // The defender keeps the floor: it may still fire at this expenditure.
    expect(engine.currentDecision(s)!.kind).toBe('firstFire');
    expect(engine.currentDecision(s)!.owner).toBe('ge');
  });
  it('a vehicle already in Motion may attempt too, to change its facing, without a Mechanical Reliability DR', () => {
    const { engine, state } = game([t34('yM9'), pziv('yM4', { motion: true })], [1]);
    const s0 = act(engine, state, { type: 'vmove.start', vehicle: 't34' }).state;
    expect(engine.legalActions(s0, 'ge').some((a) => a.type === 'defMotion')).toBe(true);
    const r = act(engine, s0, { type: 'defMotion', vehicle: 'pziv' });
    expect(ev(r, 'sk3.vehicle.reliability')).toHaveLength(0);
    expect(engine.currentDecision(r.state)!.kind).toBe('motionFacing');
    const s = act(engine, r.state, { type: 'defMotion.turn', vehicle: 'pziv', vca: 1 }).state;
    expect(s.pieces['pziv']!.tags['vca']).toBe(1);
  });
  it('in woods the hull turn after a Motion attempt takes a Bog Check per hexspine (ASLRB D8.2): bogging ends the change there', () => {
    const woods = { terrain: { yM4: { terrain: 'woods' } } as never };
    const motion = (dice: number[]) => {
      const g = makeEngine({ pieces: [t34('yM9'), pziv('yM4')], scenario: RU_VS_GE, extra, startPhase: 'MPh', dice, ...woods });
      const s = act(g.engine, g.state, { type: 'vmove.start', vehicle: 't34' }).state;
      return { engine: g.engine, s: act(g.engine, s, { type: 'defMotion', vehicle: 'pziv' }).state };
    };
    // Attempt dr 1 (success), then a Bog Check DR of 6+6 (+1 ground pressure) bogs: Motion comes off and the hull stays put.
    let g = motion([1, 6, 6]);
    let r = act(g.engine, g.s, { type: 'defMotion.turn', vehicle: 'pziv', vca: 0 });
    expect(ev(r, 'sk3.vehicle.bog')).toHaveLength(1);
    expect(ev(r, 'sk3.vehicle.bog')[0]).toMatchObject({ bogged: true, why: 'turn' });
    expect(r.state.pieces['pziv']!.tags['vca']).toBe(3);
    expect(r.state.pieces['pziv']!.tags[T3.bog]).toBe('bogged');
    expect(r.state.pieces['pziv']!.tags[T3.motion]).toBeUndefined();
    expect(g.engine.currentDecision(r.state)!.kind).toBe('firstFire');
    // Turning through 180° (three hexspines): it passes two checks (DR 2+2) and bogs on the third, two hexspines round.
    g = motion([1, 2, 2, 2, 2, 6, 6]);
    r = act(g.engine, g.s, { type: 'defMotion.turn', vehicle: 'pziv', vca: 0 });
    expect(ev(r, 'sk3.vehicle.bog').map((e) => (e as { bogged: boolean }).bogged)).toEqual([false, false, true]);
    expect(r.state.pieces['pziv']!.tags['vca']).toBe(5);
    expect(r.state.pieces['pziv']!.tags[T3.bog]).toBe('bogged');
    // Passing all three turns it round, and a further hexspine takes another check; the turret alone never does.
    g = motion([1, 2, 2, 2, 2, 2, 2, 2, 2]);
    r = act(g.engine, g.s, { type: 'defMotion.turn', vehicle: 'pziv', vca: 0 });
    expect(ev(r, 'sk3.vehicle.bog')).toHaveLength(3);
    expect(r.state.pieces['pziv']!.tags['vca']).toBe(0);
    r = act(g.engine, r.state, { type: 'defMotion.turn', vehicle: 'pziv', vca: 1 });
    expect(ev(r, 'sk3.vehicle.bog')).toHaveLength(1);
    expect(r.state.pieces['pziv']!.tags['vca']).toBe(1);
    const s = act(g.engine, r.state, { type: 'defMotion.done', vehicle: 'pziv' }).state;
    expect(s.pieces['pziv']!.tags[T3.motion]).toBe(true);
  });
});

describe('A vehicle MA with an IFE (SK4 6.8)', () => {
  const psw = (hex: string, tags: Record<string, string | number | boolean> = {}): PieceSpec => ({ id: 'psw', def: 'ge.psw2341', side: 'ge', hex, tags: { vca: 0, ca: 0, ...tags } });
  const geGame = (pieces: PieceSpec[], dice: number[]) => makeEngine({ pieces, scenario: { ...RU_VS_GE, firstSide: 'ge' }, extra, startPhase: 'PFPh', dice });

  it('the PSW 234/1 fires its 20L(6) on the IFT like a MG: 6 FP, normal range 16 with no long range, ROF one lower', () => {
    const { engine, state } = geGame([psw('yM9'), { id: 'r1', def: 'ru.447', side: 'ru', hex: 'yM5' }], [3, 3]);
    const r = act(engine, state, { type: 'fire.ordnance', shot: { weapon: 'psw', target: 'yM5', targetType: 'IFE' } });
    const attack = ev(r, 'sk1.fire.attack')[0]!;
    expect(attack).toMatchObject({ fp: 6, column: 6, cowered: false, attack: { parts: ['psw'] } });
    // ROF 2, one lower for IFE: the colored 3 loses it.
    expect(ev(r, 'sk1.fire.rof')[0]).toMatchObject({ colored: 3, lost: [{ sw: 'psw', rof: 1, why: 'exceeded' }] });
    expect(r.state.pieces['psw']!.tags['fire']).toBe('prep');
  });

  it('keeps ROF on a colored 1 and may fire again', () => {
    const { engine, state } = geGame([psw('yM9'), { id: 'r1', def: 'ru.447', side: 'ru', hex: 'yM5' }], [5, 1, 5, 1]);
    const r = act(engine, state, { type: 'fire.ordnance', shot: { weapon: 'psw', target: 'yM5', targetType: 'IFE' } });
    expect(ev(r, 'sk1.fire.rof')[0]).toMatchObject({ kept: [{ sw: 'psw', rof: 1 }] });
    expect(() => act(engine, r.state, { type: 'fire.ordnance', shot: { weapon: 'psw', target: 'yM5', targetType: 'IFE' } })).not.toThrow();
  });
});

describe('turning the turret to fire (SK4 3.2.4 case 8; ASL D3.51 Maintaining CA)', () => {
  // A T-34 M43 (Restricted Slow Turret: +2 for the first hexspine, +1 for each more) in M8, a German squad behind it in M10.
  const setup = (dice: number[]) =>
    makeEngine({ pieces: [t34('yM8'), { id: 'sq', def: 'ge.467', side: 'ge', hex: 'yM10' }], scenario: RU_VS_GE, extra, startPhase: 'PFPh', dice });
  const refusal = (engine: ReturnType<typeof setup>['engine'], state: ReturnType<typeof setup>['state'], a: object) =>
    engine.validate(state, { ...a, side: 'ru', decisionId: engine.currentDecision(state)!.id } as never);
  const labels = (p: Record<string, unknown>) => ((p['explain'] as { label: string }[] | undefined) ?? []).map((n) => n.label);

  it('the CMG turns the turret and pays case 8 on the IFT; the MA firing after it pays the same on its To Hit DR', () => {
    const { engine, state } = setup([4, 4, 4, 4, 4, 4, 4, 4]);
    const tca = turretTurnFor(engine.env(state), { sw: ['t34.cmg'], target: 'yM10' });
    expect(tca).toBeDefined();
    const spines = spineChange(0, tca!);
    const drm = caChangeDrm('RST', spines);
    expect(refusal(engine, state, { type: 'fire', decl: { units: [], sw: ['t34.cmg'], target: 'yM10' } })).toMatch(/Turret Covered Arc/);
    const r = act(engine, state, { type: 'fire', decl: { units: [], sw: ['t34.cmg'], target: 'yM10', tca } });
    const attack = ev(r, 'sk1.fire.attack')[0]!;
    expect(labels(attack)).toContain(`+${drm} Covered Arc change`);
    expect(r.state.pieces['t34']!.tags['ca']).toBe(tca);
    // The MA did not turn: the turret had already, so it pays the same penalty (D3.51) on its first shot.
    const ma = act(engine, r.state, { type: 'fire.ordnance', shot: { weapon: 't34', target: 'yM10', targetType: 'ITT', ammo: 'HE' } });
    expect(labels(ev(ma, 'sk2.ordnance.shot')[0]!)).toContain(`+${drm} Covered Arc change (the turret turned earlier this phase)`);
  });

  it('the MA turns first: the CMG firing after it in that TCA pays the same penalty on the IFT, the BMG does not', () => {
    const { engine, state } = setup([4, 4, 4, 4, 4, 4, 4, 4]);
    const tca = turretTurnFor(engine.env(state), { sw: ['t34.cmg'], target: 'yM10' })!;
    const drm = caChangeDrm('RST', spineChange(0, tca));
    const r = act(engine, state, { type: 'fire.ordnance', shot: { weapon: 't34', target: 'yM10', targetType: 'ITT', ammo: 'HE', ca: tca } });
    expect(r.state.pieces['t34']!.tags['ca']).toBe(tca);
    const mg = act(engine, r.state, { type: 'fire', decl: { units: [], sw: ['t34.cmg'], target: 'yM10' } });
    expect(labels(ev(mg, 'sk1.fire.attack')[0]!)).toContain(`+${drm} Covered Arc change (the turret turned earlier this phase)`);
  });

  it('a hull MG never turns the turret; a vehicle without a turret has none to turn', () => {
    const { engine, state } = setup([4, 4]);
    expect(refusal(engine, state, { type: 'fire', decl: { units: [], sw: ['t34.bmg'], target: 'yM10', tca: 3 } })).toMatch(/Only the turret weapons/);
  });
});

describe("A vehicle's IFE and MGs in one Fire Group (SK4 7.8)", () => {
  const psw = (hex: string): PieceSpec => ({ id: 'psw', def: 'ge.psw2341', side: 'ge', hex, tags: { vca: 0, ca: 0 } });
  const geGame = (pieces: PieceSpec[], dice: number[]) => makeEngine({ pieces, scenario: { ...RU_VS_GE, firstSide: 'ge' }, extra, startPhase: 'PFPh', dice });
  const refusal = (engine: ReturnType<typeof geGame>['engine'], state: ReturnType<typeof geGame>['state'], a: object) =>
    engine.validate(state, { ...a, side: 'ge', decisionId: engine.currentDecision(state)!.id } as never);

  it('adds the MA IFE to the CMG: 6 + 5 = 11 FP on the 8 column, and both are marked', () => {
    const { engine, state } = geGame([psw('yM9'), { id: 'r1', def: 'ru.447', side: 'ru', hex: 'yM5' }], [3, 3]);
    const r = act(engine, state, { type: 'fire', decl: { units: [], sw: ['psw', 'psw.cmg'], target: 'yM5' } });
    expect(ev(r, 'sk1.fire.attack')[0]).toMatchObject({ fp: 11, column: 8, attack: { parts: ['psw', 'psw.cmg'] } });
    expect(r.state.pieces['psw']!.tags['fire']).toBe('prep');
    expect(r.state.pieces['psw.cmg']!.tags['fire']).toBe('prep');
  });

  it('Mandatory FG: once the IFE or the CMG has attacked a target, the other may not attack it separately', () => {
    const pieces = [psw('yM9'), { id: 'r1', def: 'ru.447', side: 'ru', hex: 'yM5' }, { id: 'r2', def: 'ru.447', side: 'ru', hex: 'yM6' }];
    {
      const { engine, state } = geGame(pieces, [5, 3, 4, 4]);
      const r = act(engine, state, { type: 'fire.ordnance', shot: { weapon: 'psw', target: 'yM5', targetType: 'IFE' } });
      expect(refusal(engine, r.state, { type: 'fire', decl: { units: [], sw: ['psw.cmg'], target: 'yM5' } })).toMatch(/Mandatory Fire Group/);
      expect(refusal(engine, r.state, { type: 'fire', decl: { units: [], sw: ['psw.cmg'], target: 'yM6' } })).toBeNull();
    }
    {
      const { engine, state } = geGame(pieces, [5, 3, 4, 4]);
      const r = act(engine, state, { type: 'fire', decl: { units: [], sw: ['psw.cmg'], target: 'yM5' } });
      expect(refusal(engine, r.state, { type: 'fire.ordnance', shot: { weapon: 'psw', target: 'yM5', targetType: 'IFE' } })).toMatch(/Mandatory Fire Group/);
      // The MA may still fire at it on the To Hit Table: Ordnance never forms a Fire Group.
      expect(refusal(engine, r.state, { type: 'fire.ordnance', shot: { weapon: 'psw', target: 'yM5', targetType: 'ITT', ammo: 'HE' } })).toBeNull();
    }
  });

  it("the infantry in the vehicle's hex are not bound by its MG attack, nor it by theirs", () => {
    const { engine, state } = geGame([psw('yM9'), { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yM9' }, { id: 'r1', def: 'ru.447', side: 'ru', hex: 'yM5' }], [5, 3, 4, 4]);
    const r = act(engine, state, { type: 'fire', decl: { units: [], sw: ['psw', 'psw.cmg'], target: 'yM5' } });
    expect(refusal(engine, r.state, { type: 'fire', decl: { units: ['g1'], sw: [], target: 'yM5' } })).toBeNull();
  });
});

describe('an NT vehicle firing outside its CA (SK4 3.3.2.1)', () => {
  it('turns its hull: the VCA follows the shot', () => {
    // S35: a StuG once paid the Covered Arc change in the DFPh but kept its VCA.
    const stug: PieceSpec = { id: 'stug', def: 'ge.stug3g', side: 'ge', hex: 'yM4', tags: { vca: 0, ca: 0 } };
    const { engine, state } = makeEngine({ pieces: [t34('yM9'), stug], scenario: RU_VS_GE, extra, startPhase: 'DFPh', dice: [6, 6] });
    const map = statics(engine.env(state)).map;
    expect(inCoveredArc(map.hex('yM4')!.cube, 0, map.hex('yM9')!.cube)).toBe(false);
    const ca = nearestSpine(map.hex('yM4')!.cube, 0, map.hex('yM9')!.cube)!;
    const r = act(engine, state, { type: 'fire.ordnance', shot: { weapon: 'stug', target: 'yM9', targetType: 'VTT', ca } });
    expect(ev(r, 'sk2.gun.ca')[0]).toMatchObject({ gun: 'stug', to: ca, reason: 'fire' });
    const after = r.state.pieces['stug']!;
    expect(after.tags[T3.vca]).toBe(ca);
    expect(tcaOf(engine.env(r.state), after)).toBe(ca);
  });

  it('in woods it takes a Bog Check per hexspine first (SK4 7.6; ASLRB C5.11, D8.2): bogging stops the turn and the shot', () => {
    // Tester report 2026-11-06: VCA changes in woods or a building take one Bog Check per hexspine.
    const stug: PieceSpec = { id: 'stug', def: 'ge.stug3g', side: 'ge', hex: 'yM4', tags: { vca: 0, ca: 0 } };
    const shoot = (dice: number[]) => {
      const { engine, state } = makeEngine({ pieces: [t34('yM9'), stug], scenario: RU_VS_GE, extra, startPhase: 'DFPh', dice, terrain: { yM4: { terrain: 'woods' } } as never });
      const map = statics(engine.env(state)).map;
      const ca = nearestSpine(map.hex('yM4')!.cube, 0, map.hex('yM9')!.cube)!;
      return { engine, ca, spines: Math.min(ca, 6 - ca), r: act(engine, state, { type: 'fire.ordnance', shot: { weapon: 'stug', target: 'yM9', targetType: 'VTT', ca } }) };
    };
    // Passing every check (DR 2+2 +1), it turns and fires: a To Hit DR follows.
    let t = shoot([2, 2, 2, 2, 2, 2, 6, 6]);
    expect(t.spines).toBeGreaterThan(1);
    expect(ev(t.r, 'sk3.vehicle.bog').map((e) => (e as { bogged: boolean }).bogged)).toEqual(Array(t.spines).fill(false));
    expect(t.r.state.pieces['stug']!.tags[T3.vca]).toBe(t.ca);
    expect(t.r.state.pieces['stug']!.tags[T3.bog]).toBeUndefined();
    expect(ev(t.r, 'sk2.ordnance.shot')).toHaveLength(1);
    // Bogging on the first check (DR 6+6): the hull stays put, its CA too, and no shot is taken.
    t = shoot([6, 6, 2, 2]);
    expect(ev(t.r, 'sk3.vehicle.bog')).toHaveLength(1);
    const after = t.r.state.pieces['stug']!;
    expect(after.tags[T3.bog]).toBe('bogged');
    expect(after.tags[T3.vca]).toBe(0);
    expect(tcaOf(t.engine.env(t.r.state), after)).toBe(0);
    expect(ev(t.r, 'sk2.ordnance.shot')).toHaveLength(0);
    expect(after.tags['fire']).toBeUndefined();
  });
});
