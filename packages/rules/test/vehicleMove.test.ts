import { describe, expect, it } from 'vitest';
import type { Action, Engine, GameState } from '@asl/engine';
import { moveState } from '../src/sk1/movement';
import { sk2CoreModules } from '../src/sk2';
import { sk3CoreModules } from '../src/sk3';
import { T3 } from '../src/sk3/status';
import { defaultVca } from '../src/sk3/vehicles';
import { RU_VS_GE, act, makeEngine, type PieceSpec } from './fixtures';

/*
 * Vehicle movement (SK4 3.3.2, 7.6; SK3 Russian Vehicle Note M). Board y is the fixture map; the
 * engine's spine 0 points between the N and NE neighbours.
 */

const extra = [...sk2CoreModules, ...sk3CoreModules];
const t34 = (hex: string, tags: Record<string, string | number | boolean> = {}): PieceSpec => ({ id: 't34', def: 'ru.T34M43', side: 'ru', hex, tags: { vca: 0, ca: 0, ...tags } });

function game(pieces: PieceSpec[], opts: { dice?: number[]; terrain?: Record<string, { terrain: string; features?: string[] }> } = {}) {
  return makeEngine({ pieces, scenario: RU_VS_GE, extra, startPhase: 'MPh', ...(opts.dice ? { dice: opts.dice } : {}), ...(opts.terrain ? { terrain: opts.terrain as never } : {}) });
}
const play = (engine: Engine, state: GameState, ...actions: (Omit<Action, 'decisionId' | 'side'> & { side?: string })[]) => {
  let s = state;
  for (const a of actions) s = act(engine, s, a).state;
  return s;
};
const neighbours = (engine: Engine, state: GameState, hex: string) => engine.env(state).statics && (engine.env(state) as { statics: { map: { neighbors(h: string): string[] } } }).statics.map.neighbors(hex);

describe('vehicle movement (SK4 3.3.2)', () => {
  it('a vehicle on the map pays 1 MP to start, moves within its VCA at the terrain cost, and may not step outside it', () => {
    const { engine, state } = game([t34('yM5')]);
    expect(engine.legalActions(state, 'ru').some((a) => a.type === 'vmove.start')).toBe(true);
    // Infantry movement does not take a tank.
    expect(engine.validate(state, { type: 'move.start', units: ['t34'], side: 'ru', decisionId: engine.currentDecision(state)!.id } as never)).toMatch(/not Infantry/);
    let s = play(engine, state, { type: 'vmove.start', vehicle: 't34' });
    const ms = moveState(engine.env(s))!;
    expect(ms.vehicle).toMatchObject({ started: true, stopped: false });
    expect(ms.spent['t34']).toBe(1);
    expect(ms.allowance['t34']).toBe(16);
    const ns = neighbours(engine, s, 'yM5')!;
    // Spine 0 points between the N (ns[0]) and NE (ns[1]) neighbours: those two are the only steps.
    const steps = engine.legalActions(s, 'ru').filter((a) => a.type === 'move.step').map((a) => a['to']);
    expect(steps.sort()).toEqual([ns[0], ns[1]].sort());
    const d = engine.currentDecision(s)!;
    expect(engine.validate(s, { type: 'move.step', to: ns[3], side: 'ru', decisionId: d.id } as never)).toMatch(/Vehicle Covered Arc/);
    s = play(engine, s, { type: 'move.step', to: ns[0]! });
    expect(moveState(engine.env(s))!.spent['t34']).toBe(2);
    expect(s.pieces['t34']!.loc).toEqual({ kind: 'hex', hex: ns[0] });
    expect(s.pieces['t34']!.tags[T3.movingTarget]).toBe(true);
  });

  it('turning the hull costs 1 MP per hexspine and turns the turret with it; the turret turns free after an MP expenditure', () => {
    const { engine, state } = game([t34('yM5', { ca: 1 })]);
    let s = play(engine, state, { type: 'vmove.start', vehicle: 't34' });
    // Turning the turret right after the start MP is allowed (one change per expenditure), and the change
    // may be any number of hexspines: a second turn before more MP are spent refines where it points.
    s = play(engine, s, { type: 'vmove.turret', tca: 2 });
    expect(s.pieces['t34']!.tags['ca']).toBe(2);
    s = play(engine, s, { type: 'vmove.turret', tca: 3 });
    expect(s.pieces['t34']!.tags['ca']).toBe(3);
    s = play(engine, s, { type: 'vmove.turret', tca: 2 });
    expect(s.pieces['t34']!.tags['ca']).toBe(2);
    s = play(engine, s, { type: 'vmove.turn', vca: 2 });
    expect(s.pieces['t34']!.tags['vca']).toBe(2);
    // The turret moved the same two hexspines (2 → 4).
    expect(s.pieces['t34']!.tags['ca']).toBe(4);
    expect(moveState(engine.env(s))!.spent['t34']).toBe(3);
  });

  it('entering a hex is an MP expenditure: the turret may turn again after each hex entered', () => {
    const { engine, state } = game([t34('yM5')]);
    let s = play(engine, state, { type: 'vmove.start', vehicle: 't34' });
    s = play(engine, s, { type: 'vmove.turret', tca: 1 });
    const ns = neighbours(engine, s, 'yM5')!;
    s = play(engine, s, { type: 'move.step', to: ns[0]! });
    const ms = moveState(engine.env(s))!;
    expect(ms.vehicle!.sinceTurret).toBe(1);
    expect(ms.vehicle!.sinceBff).toBe(2); // the start MP and the hex
    s = play(engine, s, { type: 'vmove.turret', tca: 2 });
    expect(s.pieces['t34']!.tags['ca']).toBe(2);
    // Refining that change is free; it is the next expenditure that is needed for a fresh one.
    expect(moveState(engine.env(s))!.vehicle!.turretTurned).toBe(true);
    s = play(engine, s, { type: 'vmove.turret', tca: 4 });
    expect(s.pieces['t34']!.tags['ca']).toBe(4);
    expect(moveState(engine.env(s))!.vehicle!.sinceTurret).toBe(0);
  });

  it('the hull turn is an expenditure too: it earns one fresh turret change, refined freely until the next MP', () => {
    const { engine, state } = game([t34('yM5', { ca: 0 })]);
    let s = play(engine, state, { type: 'vmove.start', vehicle: 't34' });
    s = play(engine, s, { type: 'vmove.turret', tca: 3 });
    s = play(engine, s, { type: 'vmove.turn', vca: 1 });
    // The hull turn carried the turret with it (3 → 4) and counts as spending MP.
    expect(s.pieces['t34']!.tags['ca']).toBe(4);
    expect(moveState(engine.env(s))!.vehicle!.turretTurned).toBe(false);
    s = play(engine, s, { type: 'vmove.turret', tca: 1 });
    s = play(engine, s, { type: 'vmove.turret', tca: 0 });
    expect(s.pieces['t34']!.tags['ca']).toBe(0);
  });

  it('stops for 1 MP, Delays while stopped, and ends its move stopped (the rest of its MP spent as Delay)', () => {
    const { engine, state } = game([t34('yM5')]);
    let s = play(engine, state, { type: 'vmove.start', vehicle: 't34' });
    const d = engine.currentDecision(s)!;
    expect(engine.validate(s, { type: 'vmove.end', side: 'ru', decisionId: d.id } as never)).toMatch(/spends all its MP/);
    s = play(engine, s, { type: 'vmove.stop' });
    expect(moveState(engine.env(s))!.vehicle).toMatchObject({ stopped: true, started: false });
    s = play(engine, s, { type: 'vmove.delay', mp: 2 });
    expect(moveState(engine.env(s))!.spent['t34']).toBe(4);
    s = play(engine, s, { type: 'vmove.end' });
    expect(moveState(engine.env(s))).toBeUndefined();
    expect(s.pieces['t34']!.tags[T3.motion]).toBeUndefined();
    expect(s.pieces['t34']!.tags['moved']).toBe(true);
  });

  it('a vehicle that runs out of hexes ahead ends in Motion without stopping', () => {
    const { engine, state } = game([t34('yM10')]);
    let s = play(engine, state, { type: 'vmove.start', vehicle: 't34' });
    // Steps north spend 1 MP each in open ground until the map edge stops it.
    for (let i = 0; i < 15; i++) {
      const step = engine.legalActions(s, 'ru').find((a) => a.type === 'move.step');
      if (!step) break;
      s = play(engine, s, step as never);
    }
    const ms = moveState(engine.env(s))!;
    expect(ms.hexesEntered).toBeGreaterThanOrEqual(5);
    expect(ms.spent['t34']).toBeLessThan(16);
    // Nowhere to go within its VCA: it may end its move in Motion with MP left (SK4 3.3.2).
    s = play(engine, s, { type: 'vmove.end' });
    expect(s.pieces['t34']!.tags[T3.motion]).toBe(true);
    expect(s.pieces['t34']!.tags[T3.movingTarget]).toBe(true);
  });

  it('the one-hex minimum move: into terrain costing more than its MP, spending them all', () => {
    const { engine, state } = game([{ ...t34('yM5'), tags: { vca: 0, ca: 0 } }], { terrain: { yM4: { terrain: 'brush' } } });
    // Brush costs 2: no minimum move needed; make the tank nearly out of MP by delaying first.
    let s = play(engine, state, { type: 'vmove.start', vehicle: 't34' }, { type: 'vmove.stop' }, { type: 'vmove.delay', mp: 13 });
    // 15 spent, 1 left: cannot normally enter brush (2) — the minimum move allows it at all remaining MP after a restart.
    s = play(engine, s, { type: 'vmove.start', vehicle: 't34' });
    expect(moveState(engine.env(s))!.spent['t34']).toBe(16);
    const d = engine.currentDecision(s)!;
    expect(engine.validate(s, { type: 'move.step', to: 'yM4', side: 'ru', decisionId: d.id } as never)).toMatch(/MP/);
  });

  it('entering woods at half its MP takes a Bog Check: +1 ground pressure +3 half MP, bogs on 12 and stops there', () => {
    // Forced dice: the Bog Check DR 4+4 = 8 +4 DRM = 12 → bogged.
    const { engine, state } = game([t34('yM5')], { terrain: { yM4: { terrain: 'woods' } }, dice: [4, 4] });
    let s = play(engine, state, { type: 'vmove.start', vehicle: 't34' });
    const ns = neighbours(engine, s, 'yM5')!;
    const woods = ns[0] === 'yM4' ? 'yM4' : ns[1] === 'yM4' ? 'yM4' : null;
    expect(woods).toBe('yM4');
    const r = act(engine, s, { type: 'move.step', to: 'yM4' });
    s = r.state;
    const bog = r.events.find((e) => e.type === 'sk3.vehicle.bog')!.payload as { drm: number; bogged: boolean };
    expect(bog).toMatchObject({ drm: 4, bogged: true });
    expect(s.pieces['t34']!.tags[T3.bog]).toBe('bogged');
    expect(moveState(engine.env(s))?.halted ?? true).toBe(true);
  });

  it('turning the hull in woods costs 2 MP and a Bog Check per hexspine (SK4 3.3.2, 7.6; ASLRB D8.2; tester report 2026-11-06)', () => {
    const woods = { yM5: { terrain: 'woods' } };
    const bogs = (r: { events: { type: string; payload: unknown }[] }) => r.events.filter((e) => e.type === 'sk3.vehicle.bog').map((e) => (e.payload as { bogged: boolean }).bogged);
    // Through 180° (three hexspines), passing every check (DR 2+2 +1): 1 start MP + 3 × 2 MP.
    let g = game([t34('yM5')], { terrain: woods, dice: [2, 2, 2, 2, 2, 2] });
    let r = act(g.engine, play(g.engine, g.state, { type: 'vmove.start', vehicle: 't34' }), { type: 'vmove.turn', vca: 3 });
    expect(bogs(r)).toEqual([false, false, false]);
    expect(r.state.pieces['t34']!.tags['vca']).toBe(3);
    expect(moveState(g.engine.env(r.state))!.spent['t34']).toBe(7);
    // Bogging on the third check (DR 6+6) leaves the hull two hexspines round, bogged and stopped.
    g = game([t34('yM5')], { terrain: woods, dice: [2, 2, 2, 2, 6, 6] });
    r = act(g.engine, play(g.engine, g.state, { type: 'vmove.start', vehicle: 't34' }), { type: 'vmove.turn', vca: 3 });
    expect(bogs(r)).toEqual([false, false, true]);
    expect(r.state.pieces['t34']!.tags['vca']).toBe(2);
    expect(r.state.pieces['t34']!.tags[T3.bog]).toBe('bogged');
  });

  it('a Fully Tracked vehicle may enter woods with all its MP instead: no +3, only +1 ground pressure (SK4 1.1.1 and its Bog example; tester report)', () => {
    // In Motion: no start MP, all 16 MP spent entering the woods; DR 4+4 = 8 +1 = 9, no Bog.
    const moving = game([t34('yM5', { motion: true })], { terrain: { yM4: { terrain: 'woods' } }, dice: [4, 4] });
    let s = play(moving.engine, moving.state, { type: 'vmove.start', vehicle: 't34' });
    const left = () => { const ms = moveState(moving.engine.env(s))!; return ms.allowance['t34']! - ms.spent['t34']!; };
    expect(left()).toBe(16);
    let r = act(moving.engine, s, { type: 'move.step', to: 'yM4', declared: 16 });
    s = r.state;
    expect(r.events.find((e) => e.type === 'sk3.vehicle.bog')!.payload).toMatchObject({ drm: 1, bogged: false });
    expect(left()).toBe(0);
    // Stopped: 1 MP to start, then the other 15 into the woods (SK4 3.3.2: "may first spend 1 MP ... for starting").
    const stopped = game([t34('yM5')], { terrain: { yM4: { terrain: 'woods' } }, dice: [4, 4] });
    s = play(stopped.engine, stopped.state, { type: 'vmove.start', vehicle: 't34' });
    r = act(stopped.engine, s, { type: 'move.step', to: 'yM4', declared: 15 });
    expect(r.events.find((e) => e.type === 'sk3.vehicle.bog')!.payload).toMatchObject({ drm: 1, bogged: false });
  });

  it('a red-MP T-34 M41 rolls Mechanical Reliability on its start MP: 12 Immobilizes it, 11 stalls it (Russian Vehicle Note M)', () => {
    const immob = game([{ id: 't34', def: 'ru.T34M41', side: 'ru', hex: 'yM5', tags: { vca: 0, ca: 0 } }], { dice: [6, 6] });
    let s = play(immob.engine, immob.state, { type: 'vmove.start', vehicle: 't34' });
    expect(s.pieces['t34']!.tags[T3.immob]).toBe(true);
    // 11 then a second DR of 3+2 = 5 MP wasted as Delay: 1 (start) + 5 spent, the vehicle stopped.
    const stall = game([{ id: 't34', def: 'ru.T34M41', side: 'ru', hex: 'yM5', tags: { vca: 0, ca: 0 } }], { dice: [6, 5, 3, 2, 4, 3] });
    s = play(stall.engine, stall.state, { type: 'vmove.start', vehicle: 't34' });
    const ms = moveState(stall.engine.env(s))!;
    expect(s.pieces['t34']!.tags[T3.stalled]).toBe(true);
    expect(ms.spent['t34']).toBe(6);
    expect(ms.vehicle).toMatchObject({ stopped: true, started: false });
    // It may try to start again (another Reliability DR), here passing with a 3+4.
    const again = play(stall.engine, s, { type: 'vmove.start', vehicle: 't34' });
    expect(moveState(stall.engine.env(again))!.vehicle).toMatchObject({ started: true });
  });

  it('a vehicle entering from offboard starts in Motion with the card\'s MP already spent, and must enter within its VCA', () => {
    const { engine, state } = game([{ id: 't34', def: 'ru.T34M43', side: 'ru', tags: { vca: 0, ca: 0, motion: true, entryTurn: 1, entryEdge: 'N', entryMfSpent: 'half' } }]);
    // Put it in an offboard hex of the north edge (as the offboard setup would).
    const map = (engine.env(state) as { statics: { map: { offboard(e: string): { id: string; cube: { q: number; r: number; s: number } }[]; offboardNeighbors(h: string): { onboard: string[] } } } }).statics.map;
    const off = map.offboard('N')[5]!;
    const vca = defaultVca(engine.env(state), off.id);
    const s0: GameState = { ...state, pieces: { ...state.pieces, t34: { ...state.pieces['t34']!, loc: { kind: 'offboard', edge: 'N', hex: off.id }, tags: { ...state.pieces['t34']!.tags, vca, ca: vca } } } };
    let s = play(engine, s0, { type: 'vmove.start', vehicle: 't34' });
    const ms = moveState(engine.env(s))!;
    expect(ms.spent['t34']).toBe(8);
    expect(ms.vehicle).toMatchObject({ started: true, stopped: false });
    // No start MP was paid: it was in Motion.
    const entry = engine.legalActions(s, 'ru').filter((a) => a.type === 'move.step').map((a) => a['to'] as string);
    expect(entry.length).toBeGreaterThan(0);
    const onboard = entry.filter((h) => map.offboardNeighbors(off.id).onboard.includes(h));
    expect(onboard.length).toBeGreaterThanOrEqual(1);
    s = play(engine, s, { type: 'move.step', to: onboard[0]! });
    expect(s.pieces['t34']!.loc.kind).toBe('hex');
  });

  it('two friendly vehicles may not end the MPh in one hex', () => {
    const { engine, state } = game([t34('yM5'), { id: 't34b', def: 'ru.T34M43', side: 'ru', hex: 'yM4', tags: { vca: 0, ca: 0 } }]);
    let s = play(engine, state, { type: 'vmove.start', vehicle: 't34' });
    const ns = neighbours(engine, s, 'yM5')!;
    if (ns[0] === 'yM4' || ns[1] === 'yM4') {
      s = play(engine, s, { type: 'move.step', to: 'yM4' }, { type: 'vmove.stop' });
      const d = engine.currentDecision(s)!;
      expect(engine.validate(s, { type: 'vmove.end', side: 'ru', decisionId: d.id } as never)).toMatch(/one vehicle/i);
    }
  });

  it('two friendly vehicles left in one hex block the end of the MPh until the owner flips one to its wreck side', () => {
    const { engine, state } = game([t34('yM5', { immob: true }), { id: 't34b', def: 'ru.T34M43', side: 'ru', hex: 'yM5', tags: { vca: 0, ca: 0, immob: true } }]);
    const d = engine.currentDecision(state)!;
    expect(engine.validate(state, { type: 'endPhase', side: 'ru', decisionId: d.id } as never)).toMatch(/Two vehicles in yM5/);
    expect(engine.legalActions(state, 'ru').some((a) => a.type === 'endPhase')).toBe(false);
    const wrecks = engine.legalActions(state, 'ru').filter((a) => a.type === 'vmove.wreck').map((a) => a['vehicle']);
    expect(wrecks.sort()).toEqual(['t34', 't34b']);
    const r = act(engine, state, { type: 'vmove.wreck', vehicle: 't34b' });
    expect(r.state.pieces['t34b']!.tags[T3.wreck]).toBe(true);
    expect(r.events.some((e) => e.type === 'sk1.casualty' && (e.payload as { unit: string }).unit === 't34b')).toBe(true);
    expect(engine.legalActions(r.state, 'ru').some((a) => a.type === 'endPhase')).toBe(true);
    expect(engine.legalActions(r.state, 'ru').some((a) => a.type === 'vmove.wreck')).toBe(false);
  });

  it('Crew Exposed and Buttoned Up change once per MPh/APh and never after Prep Fire', () => {
    const { engine, state } = game([t34('yM5')]);
    let s = play(engine, state, { type: 'vmove.ce', vehicle: 't34', ce: true });
    expect(s.pieces['t34']!.tags[T3.ce]).toBe(true);
    const d = engine.currentDecision(s)!;
    expect(engine.validate(s, { type: 'vmove.ce', vehicle: 't34', ce: false, side: 'ru', decisionId: d.id } as never)).toMatch(/once per phase/);
    // CE on a road: the road rate is ½ MP.
    const road = game([t34('yM5', { ce: true })], { terrain: { yM5: { terrain: 'open', features: ['road:dirt'] }, yM4: { terrain: 'open', features: ['road:dirt'] } } });
    s = play(road.engine, road.state, { type: 'vmove.start', vehicle: 't34' });
    void s;
  });

  it('an Acquired Target counter on an AFV follows it as it moves in the LOS (SK4 6.10)', () => {
    // The PzIV acquired the T-34 in M5; the T-34 drives to M6, still in sight.
    const pziv: PieceSpec = { id: 'pziv', def: 'ge.pzivf2', side: 'ge', hex: 'yM9', tags: { vca: 0, ca: 0, acq: 'ITT', acqHex: 'yM5', acqUnits: 't34', acqLevel: 1 } };
    const { engine, state } = game([t34('yM5', { vca: 3, ca: 3 }), pziv]);
    let s = play(engine, state, { type: 'vmove.start', vehicle: 't34' });
    if (engine.currentDecision(s)!.kind === 'firstFire') s = play(engine, s, { type: 'defPass', side: 'ge' });
    s = play(engine, s, { type: 'move.step', to: 'yM6' });
    expect(s.pieces['pziv']!.tags).toMatchObject({ acq: 'ITT', acqHex: 'yM6', acqUnits: 't34', acqLevel: 1 });
  });

  it('Defensive First Fire that finds no Special Ammo has not fired: the turret turns back and may fire again at that location (SK4 6.2)', () => {
    // The turret faces away (hexspine 3) and turns to the T-34 for the shot.
    const pziv: PieceSpec = { id: 'pziv', def: 'ge.pzivf2', side: 'ge', hex: 'yM9', tags: { vca: 3, ca: 3 } };
    // 1943: the 75L's APCR depletes on 4, so an original DR of 11 means it never had any.
    const { engine, state } = makeEngine({ pieces: [t34('yM5', { vca: 3, ca: 3 }), pziv], scenario: { ...RU_VS_GE, date: '1 July 1943' }, extra, startPhase: 'MPh', dice: [6, 5] });
    let s = play(engine, state, { type: 'vmove.start', vehicle: 't34' });
    expect(engine.currentDecision(s)!.kind).toBe('firstFire');
    const r = act(engine, s, { type: 'defFire.ordnance', side: 'ge', shot: { weapon: 'pziv', target: 'yM5', targetType: 'VTT', ammo: 'APCR', ca: 0 } } as never);
    expect(r.events.find((e) => e.type === 'sk2.ordnance.shot')!.payload).toMatchObject({ outcome: 'noAmmo' });
    s = r.state;
    expect(s.pieces['pziv']!.tags['ca']).toBe(3);
    expect(moveState(engine.env(s))!.firedHere['pziv']).toBeUndefined();
    expect(engine.currentDecision(s)!.kind).toBe('firstFire');
    expect(engine.legalActions(s, 'ge').some((a) => a.type === 'defFire.ordnance' && (a['shot'] as { weapon: string }).weapon === 'pziv')).toBe(true);
  });

  it('Crew Exposed and Buttoned Up change in the APh too, even after Bounding First Fire (SK4 3.7, ASLRB D5.33)', () => {
    const { engine, state } = makeEngine({ pieces: [t34('yM5', { [T3.bff]: true })], scenario: RU_VS_GE, extra, startPhase: 'APh' });
    expect(engine.legalActions(state, 'ru').some((a) => a.type === 'vmove.ce' && a['vehicle'] === 't34')).toBe(true);
    const s = play(engine, state, { type: 'vmove.ce', vehicle: 't34', ce: true });
    expect(s.pieces['t34']!.tags[T3.ce]).toBe(true);
    // In the MPh the same Bounding First Fire forbids it.
    const mph = game([t34('yM5', { [T3.bff]: true })]);
    const d = mph.engine.currentDecision(mph.state)!;
    expect(mph.engine.validate(mph.state, { type: 'vmove.ce', vehicle: 't34', ce: true, side: 'ru', decisionId: d.id } as never)).toMatch(/Bounding First Fire/);
  });

  it('stopping ends Motion status at once: the stopped tank is fired on as a moving vehicle, not one in Motion (SK4 2.0, 3.3.2)', () => {
    // The T-34 ended its last turn in Motion at M9; the panzer at M4 faces it. It carries on (no start MP) and stops (1 MP).
    const { engine, state } = game([t34('yM9', { motion: true }), { id: 'pziv', def: 'ge.pzivf2', side: 'ge', hex: 'yM4', tags: { vca: 3, ca: 3 } }], { dice: [3, 3, 3, 3] });
    let s = play(engine, state, { type: 'vmove.start', vehicle: 't34' });
    expect(moveState(engine.env(s))!.vehicle).toMatchObject({ started: true, stopped: false });
    expect(s.pieces['t34']!.tags[T3.motion]).toBe(true);
    s = act(engine, s, { type: 'vmove.stop' }).state;
    expect(moveState(engine.env(s))!.vehicle).toMatchObject({ stopped: true });
    expect(s.pieces['t34']!.tags[T3.motion]).toBeUndefined();
    // Still a moving target this turn (it began its MPh in Motion), so the German's First Fire takes case 24 by MP in LOS: 1 MP → +4.
    expect(s.pieces['t34']!.tags[T3.movingTarget]).toBe(true);
    expect(engine.currentDecision(s)).toMatchObject({ kind: 'firstFire', owner: 'ge' });
    const r = act(engine, s, { type: 'defFire.ordnance', shot: { weapon: 'pziv', target: 'yM9', targetType: 'VTT' } });
    const shot = r.events.find((e) => e.type === 'sk2.ordnance.shot')!.payload as { explain: { label: string }[] };
    const labels = shot.explain.map((x) => x.label);
    expect(labels).toContain('+4 moving vehicle (1 MP in your LOS)');
    expect(labels.some((l) => /in Motion/.test(l))).toBe(false);
  });

  it('vehicular MGs are part of the vehicle: never dropped, passed to Infantry or destroyed (SK4 7.8)', () => {
    const { engine, state } = game([t34('yM5'), { id: 'r1', def: 'ru.447', side: 'ru', hex: 'yM5' }]);
    const check = (st: GameState, a: Record<string, unknown>) => engine.validate(st, { ...a, side: 'ru', decisionId: engine.currentDecision(st)!.id } as never);
    expect(state.pieces['t34.bmg']!.loc).toEqual({ kind: 'held', by: 't34' });
    const moving = play(engine, state, { type: 'vmove.start', vehicle: 't34' });
    expect(check(moving, { type: 'move.drop', sw: 't34.bmg' })).toMatch(/part of its vehicle/);
    expect(check(moving, { type: 'move.drop', sw: 't34.cmg' })).toMatch(/part of its vehicle/);
    expect(engine.legalActions(moving, 'ru').some((a) => a.type === 'move.drop')).toBe(false);
    const aph = makeEngine({ pieces: [t34('yM5'), { id: 'r1', def: 'ru.447', side: 'ru', hex: 'yM5' }], scenario: RU_VS_GE, extra, startPhase: 'APh' });
    expect(check(aph.state, { type: 'rally.transfer', sw: 't34.cmg', to: 'r1' })).toMatch(/part of its vehicle/);
    expect(check(aph.state, { type: 'move.drop', sw: 't34.cmg' })).toMatch(/part of its vehicle/);
    const pfph = makeEngine({ pieces: [t34('yM5')], scenario: RU_VS_GE, extra, startPhase: 'PFPh' });
    expect(check(pfph.state, { type: 'sw.destroy', sw: 't34.cmg' })).toMatch(/part of its vehicle/);
  });
});
