import { describe, expect, it } from 'vitest';
import type { Action, Engine, GameState } from '@asl/engine';
import { controlState } from '../src/sk1/scenario';
import { interdicted } from '../src/sk1/rout';
import { sk2CoreModules } from '../src/sk2';
import { sk3CoreModules } from '../src/sk3';
import { T3 } from '../src/sk3/status';
import { RU_VS_GE, act, makeEngine, type PieceSpec } from './fixtures';

/*
 * Infantry against vehicles (SK4 3.7, 3.8, 3.3.4, 3.2.2.1, 4.2, 4.3, 7.13): the PAATC, Close Combat
 * with a vehicle (sequential, CCV attacks, vehicle MG attacks), CC Reaction Fire, Triple Point Blank
 * Fire, Melee with vehicles, Flamethrowers and DCs against an AFV, Open-Topped AFVs, Interdiction by
 * vehicles and the hex Control of an AFV. The SK4 "PAATC and Close Combat" and "PF and Same Hex Fire"
 * examples are replayed where the fixtures allow.
 */

const extra = [...sk2CoreModules, ...sk3CoreModules];
const t34 = (hex: string, tags: Record<string, string | number | boolean> = {}): PieceSpec => ({ id: 't34', def: 'ru.T34M43', side: 'ru', hex, tags: { vca: 0, ca: 0, ...tags } });
const pziv = (hex: string, tags: Record<string, string | number | boolean> = {}): PieceSpec => ({ id: 'pziv', def: 'ge.pzivf2', side: 'ge', hex, tags: { vca: 3, ca: 3, ...tags } });
const sq = (id: string, hex: string, side = 'ru', tags: Record<string, string | number | boolean> = {}): PieceSpec => ({ id, def: side === 'ru' ? 'ru.447' : 'ge.467', side, hex, tags });
const ev = (r: { events: { type: string; payload: unknown }[] }, type: string) => r.events.filter((e) => e.type === type).map((e) => e.payload as Record<string, unknown>);
const decisionOf = (engine: Engine, s: GameState) => engine.currentDecision(s)!;
const validate = (engine: Engine, s: GameState, a: Record<string, unknown>) => engine.validate(s, { ...a, side: decisionOf(engine, s).owner, decisionId: decisionOf(engine, s).id } as never);
/** Play actions, passing every Defensive First Fire chance offered on the way. */
const passDff = (engine: Engine, s: GameState) => {
  while (engine.currentDecision(s)?.kind === 'firstFire') s = act(engine, s, { type: 'defPass' }).state;
  return s;
};
/** Answer the CCPh's hex choice so the declarations begin. */
const chooseHex = (engine: Engine, s: GameState, hex: string) => {
  if (engine.currentDecision(s)?.kind === 'ccHex') s = act(engine, s, { type: 'cc.chooseHex', hex }).state;
  while (engine.currentDecision(s)?.kind === 'ccArrange') s = act(engine, s, { type: 'cc.arranged' }).state;
  return s;
};
const play = (engine: Engine, state: GameState, ...actions: (Omit<Action, 'decisionId' | 'side'> & { side?: string })[]) => {
  let s = state;
  for (const a of actions) s = passDff(engine, act(engine, s, a).state);
  return s;
};

describe('Pre-AFV Advance/Attack Task Check (SK4 3.7)', () => {
  it('MMC roll ≤ morale (leader DRM) to advance into an enemy AFV hex; a failure pins; the leader needs none', () => {
    // The SK4 example in miniature: a -1 leader with two squads; DR 8 passes at 7 with him, DR 10 fails and pins.
    const { engine, state } = makeEngine({
      pieces: [sq('a', 'yM6'), sq('b', 'yM6'), { id: 'l', def: 'ru.L91', side: 'ru', hex: 'yM6' }, pziv('yM5')],
      scenario: RU_VS_GE,
      extra,
      startPhase: 'APh',
      dice: [4, 4, 5, 5],
    });
    const r = act(engine, state, { type: 'advance', units: ['a', 'b', 'l'], to: 'yM5' });
    const checks = ev(r, 'sk3.paatc');
    expect(checks.map((c) => [c['unit'], c['drm'], c['passed']])).toEqual([
      ['a', -1, true],
      ['b', -1, false],
    ]);
    expect(r.state.pieces['a']!.loc).toEqual({ kind: 'hex', hex: 'yM5' });
    expect(r.state.pieces['l']!.loc).toEqual({ kind: 'hex', hex: 'yM5' });
    expect(r.state.pieces['b']!.loc).toEqual({ kind: 'hex', hex: 'yM6' });
    expect(r.state.pieces['b']!.tags['pinned']).toBe(true);
    expect(r.state.hexMarkers['yM5']?.['cc']).toBe(true);
  });
});

describe('Close Combat with a vehicle (SK4 3.8)', () => {
  const setup = (dice: number[], vehicleTags: Record<string, string | number | boolean> = {}) => {
    const g = makeEngine({
      pieces: [sq('a', 'yM5', 'ru', { advancedInto: 'yM5' }), sq('b', 'yM5', 'ru', { advancedInto: 'yM5' }), { id: 'l', def: 'ru.L91', side: 'ru', hex: 'yM5', tags: { stackedOn: 'a', advancedInto: 'yM5' } }, pziv('yM5', vehicleTags)],
      scenario: RU_VS_GE,
      extra,
      startPhase: 'CCPh',
      dice,
    });
    return { engine: g.engine, state: chooseHex(g.engine, g.state, 'yM5') };
  };

  it('attacks are sequential, the non-vehicular player first; a leader with a squad has CCV 6; DR = CCV Immobilizes (SK4 example)', () => {
    // The Panther of the example: CE and in Motion → -1 leader, -1 CE, +2 Motion = 0; the Russian rolls a 6.
    const { engine, state } = setup([3, 3], { ce: true, motion: true });
    expect(decisionOf(engine, state)).toMatchObject({ kind: 'ccDeclare', owner: 'ru', data: { sequential: true } });
    const opts = engine.legalActions(state, 'ru').map((a) => a['attacks'] as { attackers: string[]; targets: string[] }[]);
    // A pass, the two squads together at nothing (no enemy Infantry), each unit alone or with the leader at the panzer.
    expect(opts).toContainEqual([{ attackers: ['a', 'l'], targets: ['pziv'] }]);
    expect(opts).toContainEqual([{ attackers: ['b'], targets: ['pziv'] }]);
    expect(opts).not.toContainEqual([{ attackers: ['a', 'b'], targets: ['pziv'] }]);
    expect(validate(engine, state, { type: 'cc.declare', attacks: [{ attackers: ['a', 'b'], targets: ['pziv'] }] })).toMatch(/MMC with a SMC/);
    const r = act(engine, state, { type: 'cc.declare', attacks: [{ attackers: ['a', 'l'], targets: ['pziv'] }] });
    const cc = ev(r, 'sk3.cc.vsVehicle')[0]!;
    expect(cc).toMatchObject({ ccv: 6, drm: 0, result: 'immobilized' });
    expect(cc['drmExplain']).toEqual(expect.arrayContaining([expect.objectContaining({ label: '-1 vs Crew Exposed AFV' }), expect.objectContaining({ label: '+2 vs Motion/Non-Stopped vehicle' })]));
    expect(r.state.pieces['pziv']!.tags[T3.immob]).toBe(true);
    // The German's turn: the panzer attacks with its 5 FP CMG against the Russians' CCV.
    expect(decisionOf(engine, r.state)).toMatchObject({ kind: 'ccDeclare', owner: 'ge' });
    const geOpts = engine.legalActions(r.state, 'ge').map((a) => a['attacks'] as { attackers: string[]; targets: string[] }[]);
    expect(geOpts).toContainEqual([{ attackers: ['pziv'], targets: ['a', 'b', 'l'] }]);
  });

  it('a vehicle attacks Infantry with its MG FP at odds against their CCV; the sides alternate until everyone has attacked', () => {
    // Russian squad b alone first (CCV 5, no DRM): DR 9 → nothing. Panzer: CMG 5 vs b's CCV 5 → 1:1 (kill 5): DR 5 → casualty reduction.
    const { engine, state } = setup([4, 5, 2, 3, 6, 6]);
    let s = act(engine, state, { type: 'cc.declare', attacks: [{ attackers: ['b'], targets: ['pziv'] }] }).state;
    expect(decisionOf(engine, s).owner).toBe('ge');
    const r = act(engine, s, { type: 'cc.declare', attacks: [{ attackers: ['pziv'], targets: ['b'] }] });
    expect(ev(r, 'sk1.cc.attack')[0]).toMatchObject({ side: 'ge', odds: '1:1', result: 'casualty reduction' });
    s = r.state;
    // Back to the Russians: a and the leader still may attack; the panzer has.
    expect(decisionOf(engine, s).owner).toBe('ru');
    expect(engine.legalActions(s, 'ru').map((a) => a['attacks'] as unknown[]).some((at) => JSON.stringify(at).includes('"b"'))).toBe(false);
    s = act(engine, s, { type: 'cc.declare', attacks: [] }).state;
    // Everyone has attacked or passed: the CC is over; the panzer (not in Motion) holds the Russians in Melee.
    expect(s.hexMarkers['yM5']?.['melee']).toBe(true);
    expect(s.phase).not.toBe('CCPh');
  });

  it('an original 2 that could not otherwise succeed rolls a third die; an original 12 is a Casualty Reduction for the attacker', () => {
    // Panzer in Motion (+2): a lone leader (CCV 2) needs < 0: impossible; original 2 → third die 1 → eliminated.
    const two = setup([1, 1, 1], { motion: true });
    let r = act(two.engine, two.state, { type: 'cc.declare', attacks: [{ attackers: ['l'], targets: ['pziv'] }] });
    expect(ev(r, 'sk3.cc.vsVehicle')[0]).toMatchObject({ third: 1, result: 'eliminated' });
    expect(r.state.pieces['pziv']!.tags[T3.wreck]).toBe(true);
    const twelve = setup([6, 6]);
    r = act(twelve.engine, twelve.state, { type: 'cc.declare', attacks: [{ attackers: ['b'], targets: ['pziv'] }] });
    expect(ev(r, 'sk3.cc.vsVehicle')[0]!['result']).toBe('casualtyReduction');
    expect(ev(r, 'sk1.casualty')[0]).toMatchObject({ unit: 'b', kind: 'reduced' });
  });

  it('a Motion vehicle holds nobody in Melee; an immobile one adds -1 and a vehicle without an MG -1', () => {
    const { engine, state } = setup([6, 6, 6, 6], { motion: true });
    let s = act(engine, state, { type: 'cc.declare', attacks: [] }).state;
    if (decisionOf(engine, s)?.kind === 'ccDeclare') s = act(engine, s, { type: 'cc.declare', attacks: [] }).state;
    expect(s.hexMarkers['yM5']?.['melee']).toBeUndefined();
    const env = engine.env(setup([], { immob: true }).state);
    const drm = env.explain('cc.drm', { hex: 'yM5', attackers: ['b'], targets: ['pziv'], side: 'ru' }, 0);
    expect(drm.value).toBe(-1);
    expect(drm.trace.filter((t) => !t.suppressedBy && t.label).map((t) => t.label)).toEqual(expect.arrayContaining(['-1 vs immobile AFV']));
  });
});

describe('CC Reaction Fire and same-hex fire (SK4 3.3.4, 3.2.2.1)', () => {
  const setup = (dice: number[], squadTags: Record<string, string | number | boolean> = {}) =>
    makeEngine({ pieces: [t34('yM8'), { id: 'sq', def: 'ge.467', side: 'ge', hex: 'yM7', tags: squadTags }], scenario: RU_VS_GE, extra, startPhase: 'MPh', dice });

  it('Infantry in the hex of a moving vehicle may Reaction Fire after a PAATC: CCV 5, +2 Non-Stopped', () => {
    // Start (1 MP), step into M7 (1 MP): the squad is offered a shot; PAATC 3+3 passes; CC 1+1 +2 = 4 < 5 → wreck.
    const { engine, state } = setup([3, 3, 1, 1]);
    let s = act(engine, state, { type: 'vmove.start', vehicle: 't34' }).state;
    s = passDff(engine, s);
    s = act(engine, s, { type: 'move.step', to: 'yM7' }).state;
    expect(decisionOf(engine, s)).toMatchObject({ kind: 'firstFire', owner: 'ge' });
    expect(engine.legalActions(s, 'ge')).toContainEqual(expect.objectContaining({ type: 'reactionFire', unit: 'sq' }));
    const r = act(engine, s, { type: 'reactionFire', unit: 'sq' });
    expect(ev(r, 'sk3.paatc')[0]).toMatchObject({ unit: 'sq', vehicle: 't34', reason: 'reactionFire', passed: true });
    const cc = ev(r, 'sk3.cc.vsVehicle')[0]!;
    expect(cc).toMatchObject({ reaction: true, ccv: 5, drm: 2, result: 'eliminated' });
    expect(cc['third']).toBeUndefined();
    expect(r.state.pieces['t34']!.tags[T3.wreck]).toBe(true);
    expect(r.state.pieces['sq']!.tags['fire']).toBe('first');
  });

  it('a failed PAATC pins the unit and forbids Reaction Fire; a unit that already fired attacks at CCV -1', () => {
    const fail = setup([5, 5]);
    let s = act(fail.engine, fail.state, { type: 'vmove.start', vehicle: 't34' }).state;
    s = passDff(fail.engine, s);
    s = act(fail.engine, s, { type: 'move.step', to: 'yM7' }).state;
    const r = act(fail.engine, s, { type: 'reactionFire', unit: 'sq' });
    expect(ev(r, 'sk3.paatc')[0]!['passed']).toBe(false);
    expect(r.state.pieces['sq']!.tags['pinned']).toBe(true);
    expect(ev(r, 'sk3.cc.vsVehicle')).toHaveLength(0);
    // Already marked First Fire: Subsequent First Fire at CCV 4, marked Final afterwards.
    const fired = setup([3, 3, 4, 4], { fire: 'first' });
    s = act(fired.engine, fired.state, { type: 'vmove.start', vehicle: 't34' }).state;
    s = passDff(fired.engine, s);
    s = act(fired.engine, s, { type: 'move.step', to: 'yM7' }).state;
    const r2 = act(fired.engine, s, { type: 'reactionFire', unit: 'sq' });
    expect(ev(r2, 'sk3.cc.vsVehicle')[0]).toMatchObject({ ccv: 4, result: 'none' });
    expect(r2.state.pieces['sq']!.tags['fire']).toBe('final');
  });

  it('fire into the firer\'s own hex at an enemy vehicle is tripled (TPBF); with an enemy unit in its hex a unit fires at that hex only', () => {
    // The T-34 sits CE in the German squad's hex in the German PFPh: 4 FP x3 = 12 column, +2 CE on the crew.
    const { engine, state } = makeEngine({ pieces: [t34('yM7', { ce: true }), { id: 'sq', def: 'ge.467', side: 'ge', hex: 'yM7' }, sq('ru', 'yM5')], scenario: { ...RU_VS_GE, firstSide: 'ge' }, extra, startPhase: 'PFPh', dice: [3, 3] });
    expect(validate(engine, state, { type: 'fire', decl: { units: ['sq'], sw: [], target: 'yM5' } })).toMatch(/only fire at that hex/);
    const r = act(engine, state, { type: 'fire', decl: { units: ['sq'], sw: [], target: 'yM7' } });
    expect(ev(r, 'sk1.fire.attack')[0]).toMatchObject({ fp: 12 });
    expect(ev(r, 'sk1.fire.result').find((x) => x['unit'] === 't34')!['drm']).toBe(2);
  });
});

describe('Melee, Interdiction and Control with vehicles', () => {
  it('a vehicle in a Melee hex may still move away, but fires only into its hex while it stays', () => {
    const { engine, state } = makeEngine({ pieces: [t34('yM7'), { id: 'sq', def: 'ge.467', side: 'ge', hex: 'yM7' }, sq('ru', 'yM7'), { id: 'ge2', def: 'ge.467', side: 'ge', hex: 'yM5' }], scenario: RU_VS_GE, extra, startPhase: 'PFPh', dice: [3, 3] });
    const s0 = { ...state, hexMarkers: { ...state.hexMarkers, yM7: { melee: true } } };
    expect(validate(engine, s0, { type: 'fire.ordnance', shot: { weapon: 't34', target: 'yM5', targetType: 'ITT' } })).toMatch(/only fire at that hex/);
    expect(validate(engine, s0, { type: 'fire', decl: { units: [], sw: ['t34.cmg'], target: 'yM5' } })).toMatch(/Melee hex|only fire at that hex/);
    expect(validate(engine, s0, { type: 'fire', decl: { units: [], sw: ['t34.cmg'], target: 'yM7' } })).toBeNull();
    const mph = makeEngine({ pieces: [t34('yM7'), { id: 'sq', def: 'ge.467', side: 'ge', hex: 'yM7' }, sq('ru', 'yM7')], scenario: RU_VS_GE, extra, startPhase: 'MPh', dice: [3, 3] });
    const s1 = { ...mph.state, hexMarkers: { ...mph.state.hexMarkers, yM7: { melee: true } } };
    expect(validate(mph.engine, s1, { type: 'vmove.start', vehicle: 't34' })).toBeNull();
  });

  it('a Stopped vehicle holds Infantry in Melee only until it starts: then they may Reaction Fire, and fire at it once it has gone', () => {
    // Tester report: the T-34 and a German squad with a BAZ were left in Melee by an unresolved CC; the T-34
    // starts in its MPh and drives off. ASLRB A11.7 example: after its Start MP the squad is no longer held.
    const { engine, state } = makeEngine({
      pieces: [t34('yM7'), { id: 'sq', def: 'ge.467', side: 'ge', hex: 'yM7' }, { id: 'baz', def: 'ge.BAZ43', side: 'ge', heldBy: 'sq' }],
      scenario: RU_VS_GE,
      extra,
      startPhase: 'MPh',
      dice: [6, 6],
    });
    const s0 = { ...state, hexMarkers: { ...state.hexMarkers, yM7: { melee: true } } };
    expect(engine.env(s0).query('cc.meleeHolds', { hex: 'yM7' }, false)).toBe(true);
    let s = act(engine, s0, { type: 'vmove.start', vehicle: 't34' }).state;
    expect(s.hexMarkers['yM7']?.['melee']).toBeUndefined();
    // Still in the hex after the Start MP: CC Reaction Fire (SK4 3.3.4).
    expect(decisionOf(engine, s)).toMatchObject({ kind: 'firstFire', owner: 'ge' });
    expect(engine.legalActions(s, 'ge')).toContainEqual(expect.objectContaining({ type: 'reactionFire', unit: 'sq' }));
    s = passDff(engine, s);
    s = act(engine, s, { type: 'move.step', to: 'yM6' }).state;
    // Gone to the next hex: the BAZ may fire at it as Defensive First Fire.
    expect(decisionOf(engine, s)).toMatchObject({ kind: 'firstFire', owner: 'ge' });
    expect(validate(engine, s, { type: 'defFire.ordnance', shot: { weapon: 'baz', target: 'yM6', targetType: 'VTT' } })).toBeNull();
  });

  it('a Melee counter comes off as soon as no enemy remains to hold it, without waiting for the CCPh', () => {
    // The Germans in M7 are gone (as after fire into the Melee): the next piece event clears the counter.
    const { engine, state } = makeEngine({ pieces: [sq('ru', 'yM7'), sq('ru2', 'yM3')], scenario: RU_VS_GE, extra, startPhase: 'MPh' });
    const s0 = { ...state, hexMarkers: { ...state.hexMarkers, yM7: { melee: true } } };
    const s = act(engine, s0, { type: 'move.start', units: ['ru2'] }).state;
    expect(s.hexMarkers['yM7']?.['melee']).toBeUndefined();
  });

  it('a vehicle with a usable MG in range interdicts a router; a Motion vehicle does not', () => {
    const still = makeEngine({ pieces: [t34('yM8'), { id: 'sq', def: 'ge.467', side: 'ge', hex: 'yM5', tags: { broken: true } }], scenario: { ...RU_VS_GE, firstSide: 'ge' }, extra, startPhase: 'RtPh' });
    expect(interdicted(still.engine.env(still.state), 'ge', 'yM6', 'yM5').map((p) => p.id)).toEqual(['t34']);
    const motion = makeEngine({ pieces: [t34('yM8', { motion: true }), { id: 'sq', def: 'ge.467', side: 'ge', hex: 'yM5', tags: { broken: true } }], scenario: { ...RU_VS_GE, firstSide: 'ge' }, extra, startPhase: 'RtPh' });
    expect(interdicted(motion.engine.env(motion.state), 'ge', 'yM6', 'yM5')).toHaveLength(0);
  });

  it('an AFV Controls the hex it sits in while no Good Order enemy unit is there, and Control reverts when it leaves', () => {
    const { engine, state } = makeEngine({ pieces: [t34('yM8')], scenario: RU_VS_GE, extra, startPhase: 'MPh', dice: [3, 3, 3, 3] });
    const s = play(engine, state, { type: 'vmove.start', vehicle: 't34' }, { type: 'move.step', to: 'yM7' });
    expect(controlState(engine.env(s)).hexes['yM7']).toBe('ru');
    const s2 = play(engine, s, { type: 'move.step', to: 'yM6' });
    const ctl = controlState(engine.env(s2));
    expect(ctl.hexes['yM6']).toBe('ru');
    expect(ctl.hexes['yM7']).toBeUndefined();
  });
});

describe('Flamethrowers, DCs and Open-Topped AFVs (SK4 4.2, 4.3, 7.13)', () => {
  it('a FT predesignating an AFV rolls on the HE & Flame table: TK 8 (+1 CE), below it the AFV burns; AF ignored', () => {
    const { engine, state } = makeEngine({ pieces: [t34('yM6', { ce: true }), { id: 'sq', def: 'ge.467', side: 'ge', hex: 'yM7' }, { id: 'ft', def: 'ge.FT', side: 'ge', heldBy: 'sq' }], scenario: { ...RU_VS_GE, firstSide: 'ge' }, extra, startPhase: 'PFPh', dice: [4, 4] });
    const r = act(engine, state, { type: 'fire', decl: { units: [], sw: ['ft'], target: 'yM6', vsVehicle: 't34' } });
    expect(ev(r, 'sk3.toKill')[0]).toMatchObject({ weapon: 'ft', ammo: 'FT', finalTk: 9, result: 'kill' });
    expect(r.state.pieces['t34']!.tags[T3.wreck]).toBe(true);
    expect(r.state.pieces['ft']!.tags['fire']).toBe('prep');
    expect(validate(engine, state, { type: 'fire', decl: { units: ['sq'], sw: [], target: 'yM6', vsVehicle: 't34' } })).toMatch(/Flamethrower/);
  });

  it('a DC placed against an AFV needs a PAATC, then rolls its placement: ≤ 8 attacks the armor through the hexside it was placed from', () => {
    // German squad in M6 with a DC moves nothing: it places the DC on the T-34 in M5 (adjacent) during its MPh.
    const { engine, state } = makeEngine({ pieces: [t34('yM5', { vca: 0, ca: 0 }), { id: 'sq', def: 'ge.467', side: 'ge', hex: 'yM6' }, { id: 'dc', def: 'ge.DC', side: 'ge', heldBy: 'sq' }], scenario: { ...RU_VS_GE, firstSide: 'ge' }, extra, startPhase: 'MPh', dice: [3, 3, 2, 2, 5, 1] });
    let s = act(engine, state, { type: 'move.start', units: ['sq'], doubleTime: false, assault: false }).state;
    s = passDff(engine, s);
    const r = act(engine, s, { type: 'move.placeDc', dc: 'dc', target: 'yM5', vehicle: 't34' });
    expect(ev(r, 'sk3.paatc')[0]).toMatchObject({ unit: 'sq', reason: 'dc', passed: true });
    s = passDff(engine, r.state);
    expect(s.pieces['dc']!.tags).toMatchObject({ dcPlaced: true, dcVehicle: 't34', dcFrom: 'yM6' });
    // On to the AFPh: placement DR 2+2 = 4 (+1 CE? no, BU) → armor; hull (colored ≥ white), from the south of a north-facing T-34: rear, AF 6 → TK 17 − 6 = 11; TK DR 6 → kill.
    s = play(engine, s, { type: 'move.end' }, { type: 'endPhase' });
    expect(s.phase).toBe('DFPh');
    // Placed DCs detonate as the AFPh begins.
    const r2 = act(engine, s, { type: 'endPhase' });
    expect(ev(r2, 'sk3.dcPlacement')[0]).toMatchObject({ dc: 'dc', vehicle: 't34', result: 'armor' });
    expect(ev(r2, 'sk3.toKill')[0]).toMatchObject({ ammo: 'DC', facing: 'rear', location: 'hull', finalTk: 11, result: 'kill' });
    expect(r2.state.pieces['t34']!.tags[T3.wreck]).toBe(true);
    expect(r2.state.pieces['dc']!.loc.kind).toBe('eliminated');
  });

  it('an Open-Topped AFV takes -1 on the Area Target Type and -2 in CC, and fires only its bow MG when Buttoned Up', () => {
    const { engine, state } = makeEngine({ pieces: [{ id: 'ot', def: 'ge.otv', side: 'ge', hex: 'yM5', tags: { vca: 3, ca: 3 } }, sq('ru', 'yM7')], scenario: RU_VS_GE, extra, startPhase: 'CCPh' });
    const env = engine.env(state);
    expect(env.explain('cc.drm', { hex: 'yM5', attackers: ['ru'], targets: ['ot'], side: 'ru' }, 0).trace.filter((t) => !t.suppressedBy && t.label).map((t) => t.label)).toContain('-2 vs Open-Topped AFV');
    const att = { mode: 'prep' as const, side: 'ru', target: 'yM5', parts: [], targets: ['ot'], hindrance: 0, ordnance: { targetType: 'ATT' as const } };
    expect(env.explain('fire.unitDrm', { attack: att as never, unit: 'ot' }, 0).trace.filter((t) => !t.suppressedBy && t.label).map((t) => t.label)).toContain('-1 Open-Topped (Area Target Type)');
    const pf = makeEngine({ pieces: [{ id: 'ot', def: 'ge.otv', side: 'ge', hex: 'yM5', tags: { vca: 3, ca: 3 } }, sq('ru', 'yM7')], scenario: { ...RU_VS_GE, firstSide: 'ge' }, extra, startPhase: 'PFPh' });
    expect(validate(pf.engine, pf.state, { type: 'fire.ordnance', shot: { weapon: 'ot', target: 'yM7', targetType: 'ITT' } })).toMatch(/Buttoned Up/);
    expect(validate(pf.engine, pf.state, { type: 'fire', decl: { units: [], sw: ['ot.cmg'], target: 'yM7' } })).toMatch(/bow MG/);
    expect(validate(pf.engine, pf.state, { type: 'fire', decl: { units: [], sw: ['ot.bmg'], target: 'yM7' } })).toBeNull();
  });
});
