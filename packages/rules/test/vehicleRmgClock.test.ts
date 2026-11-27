import { describe, expect, it } from 'vitest';
import type { Action, Engine, GameState } from '@asl/engine';
import type { CounterDef, VehicleDef } from '../src';
import { sk2CoreModules } from '../src/sk2';
import { sk3CoreModules } from '../src/sk3';
import { caChangeDrm, inCoveredArc, playerTurnLeftovers, rmgSpine, spineChange, turretTurnFor, vehicleMgDefs, vehicleMgUnavailable } from '../src';
import { T2 } from '../src/sk2/status';
import { act, makeEngine, testMap, type PieceSpec } from './fixtures';

/*
 * A turret Rear MG whose Covered Arc is not the rear of the turret (SK4 Japanese Vehicle Notes): the Type 95 HA-GO's
 * "center hexspine of the turret Rear MG's CA is always the second hexspine clockwise from the center hexspine of the
 * current TCA; i.e., the Rear MG is located at the 4:00 position relative to the MA"; the Type 89B CHI-RO's the second
 * hexspine counterclockwise, "8:00 from MA". Elsewhere a turret RMG fires "only through its rear turret Target Facing"
 * (ASLRB D1.82). It turns with the turret, paying case 8 as the CMG does (SK4 3.2.4, 7.8: "CMG/RMG = T or ST").
 */

// The two counters as imported (VASL "RMG: 4:00 from MA", "RMG: 8:00 from MA" on the counter backs).
const HAGO: VehicleDef = { id: 'ja.ty95hago', nationality: 'ja', name: 'Type 95 HA-GO', kind: 'vehicle', tracked: true, mp: 15, groundPressure: 'low', af: { hull: { front: 1, side: 1, rear: 1 }, turret: { front: 2, side: 2, rear: 2 } }, turret: '1MT', targetSize: 'small', ma: { type: 'AT', caliber: 37, ammo: { he: true, ap: true } }, mg: { bmg: 2, rmg: 2, rmgClock: 4 }, cs: 3, ceDrm: 2, crewMorale: 8, cvp: 0 };
const CHIRO: VehicleDef = { id: 'ja.ty89Bchiro', nationality: 'ja', name: 'Type 89B CHI-RO', kind: 'vehicle', tracked: true, mp: 10, groundPressure: 'low', af: { hull: { front: 2, side: 1, rear: 1 }, turret: { front: 2, side: 2, rear: 2 } }, turret: 'ST', targetSize: 'large', ma: { type: 'AT', caliber: 57, barrel: '*', rof: 1, ammo: { he: true, ap: true } }, mg: { bmg: 2, rmg: 2, rmgClock: 8 }, cs: 4, ceDrm: 2, crewMorale: 8, cvp: 0 };
// A CHI-RO whose MA also had IFE, to try the MA's IFE and the RMG in one attack; an NT vehicle whose RMG is in the hull.
const IFE_TANK: VehicleDef = { ...CHIRO, id: 'ja.testIfe', ma: { ...CHIRO.ma!, ife: 4 } };
const HULL_RMG: VehicleDef = { ...CHIRO, id: 'ja.testNt', turret: 'NT', mg: { bmg: 2, rmg: 2 } };
const counters: Record<string, CounterDef> = Object.fromEntries([HAGO, CHIRO, IFE_TANK, HULL_RMG, ...[HAGO, CHIRO, IFE_TANK, HULL_RMG].flatMap((d) => vehicleMgDefs(d))].map((d) => [d.id, d]));

const JA_VS_AM = (first: 'ja' | 'am') => ({
  firstSide: first,
  sides: [
    { side: 'ja', name: 'Japanese', nationality: 'ja', elr: 3 },
    { side: 'am', name: 'American', nationality: 'am', elr: 3 },
  ],
});
const extra = [...sk2CoreModules, ...sk3CoreModules];
const AT = 'yM5';
const map = testMap();
const cube = (h: string) => map.hex(h)!.cube;
const near = [...map.hexes()].filter((h) => h.id !== AT && map.distance(AT, h.id) <= 4).map((h) => h.id).sort();
const inArc = (spine: number, h: string) => inCoveredArc(cube(AT), spine, cube(h));
// With the turret on spine 0 the Chi-Ro's RMG covers spine 4; the Ha-Go's spine 2; a plain turret RMG spine 3.
const CHIRO_ONLY = near.find((h) => inArc(4, h) && !inArc(3, h) && !inArc(0, h))!;
const REAR_ONLY = near.find((h) => inArc(3, h) && !inArc(4, h) && !inArc(2, h) && !inArc(0, h))!;
const HAGO_ONLY = near.find((h) => inArc(2, h) && !inArc(3, h) && !inArc(0, h))!;
// In the TCA (spine 0), out of every RMG arc.
const FRONT = near.find((h) => inArc(0, h) && !inArc(2, h) && !inArc(3, h) && !inArc(4, h))!;

const tank = (id: string, def: string, tags: Record<string, string | number | boolean> = {}): PieceSpec => ({ id, def, side: 'ja', hex: AT, tags: { vca: 0, ca: 0, ...tags } });
const sq = (id: string, hex: string): PieceSpec => ({ id, def: 'am.666', side: 'am', hex });
const game = (pieces: PieceSpec[], opts: { first?: 'ja' | 'am'; phase?: string; dice?: number[] } = {}) =>
  makeEngine({ pieces, scenario: JA_VS_AM(opts.first ?? 'ja') as never, extra, counters, startPhase: opts.phase ?? 'PFPh', dice: opts.dice ?? Array(120).fill(3) });
const refusal = (engine: Engine, s: GameState, a: object) => engine.validate(s, { ...a, side: engine.currentDecision(s)!.owner, decisionId: engine.currentDecision(s)!.id } as never);
const ev = (r: { events: { type: string; payload: unknown }[] }, type: string) => r.events.filter((e) => e.type === type).map((e) => e.payload as Record<string, unknown>);
const labels = (p: Record<string, unknown>) => ((p['explain'] as { label: string }[] | undefined) ?? []).map((n) => n.label);
const fires = (engine: Engine, s: GameState, side: string, type = 'fire') =>
  engine.legalActions(s, side).filter((a) => a.type === type).map((a) => (a as Action & { decl: { sw: string[]; target: string; tca?: number; vca?: number } }).decl);

describe('a turret Rear MG offset from the rear (SK4 Japanese Vehicle Notes; ASLRB D1.82)', () => {
  it('the test geometry exists', () => {
    expect([CHIRO_ONLY, REAR_ONLY, HAGO_ONLY].every(Boolean)).toBe(true);
  });

  it('its CA centre: 4:00 is two hexspines clockwise of the TCA, 8:00 two counterclockwise, any other turret RMG the rear', () => {
    expect([0, 1, 5].map((t) => rmgSpine(HAGO, t))).toEqual([2, 3, 1]);
    expect([0, 1, 5].map((t) => rmgSpine(CHIRO, t))).toEqual([4, 5, 3]);
    expect([0, 1, 5].map((t) => rmgSpine({ ...CHIRO, mg: { bmg: 2, rmg: 2 } }, t))).toEqual([3, 4, 2]);
  });

  it('the CHI-RO RMG fires at 8:00 without turning, and not straight back without a turret turn', () => {
    const { engine, state } = game([tank('cr', 'ja.ty89Bchiro'), sq('a', CHIRO_ONLY), sq('b', REAR_ONLY)]);
    expect(refusal(engine, state, { type: 'fire', decl: { units: [], sw: ['cr.rmg'], target: CHIRO_ONLY } })).toBeNull();
    expect(refusal(engine, state, { type: 'fire', decl: { units: [], sw: ['cr.rmg'], target: REAR_ONLY } })).toMatch(/RMG.*8:00 from the MA.*turn/);
    // The BMG keeps the hull's arc.
    expect(refusal(engine, state, { type: 'fire', decl: { units: [], sw: ['cr.bmg'], target: CHIRO_ONLY } })).toMatch(/Vehicle Covered Arc/);
  });

  it('the HA-GO RMG fires at 4:00 and not at 8:00', () => {
    const { engine, state } = game([tank('hg', 'ja.ty95hago'), sq('a', HAGO_ONLY), sq('b', CHIRO_ONLY)]);
    expect(refusal(engine, state, { type: 'fire', decl: { units: [], sw: ['hg.rmg'], target: HAGO_ONLY } })).toBeNull();
    expect(refusal(engine, state, { type: 'fire', decl: { units: [], sw: ['hg.rmg'], target: CHIRO_ONLY } })).toMatch(/4:00 from the MA/);
  });

  it('turning the turret for an RMG shot points its offset arc at the target and pays case 8 (ST: +2 for one hexspine)', () => {
    const { engine, state } = game([tank('cr', 'ja.ty89Bchiro'), sq('b', REAR_ONLY)]);
    const tca = turretTurnFor(engine.env(state), { sw: ['cr.rmg'], target: REAR_ONLY })!;
    expect(tca).toBeDefined();
    expect(inArc(rmgSpine(CHIRO, tca), REAR_ONLY)).toBe(true);
    expect(turretTurnFor(engine.env(state), { sw: ['cr.rmg'], target: CHIRO_ONLY })).toBeUndefined();
    const r = act(engine, state, { type: 'fire', decl: { units: [], sw: ['cr.rmg'], target: REAR_ONLY, tca } });
    expect(r.state.pieces['cr']!.tags[T2.ca]).toBe(tca);
    expect(labels(ev(r, 'sk1.fire.attack')[0]!)).toContain(`+${caChangeDrm('ST', spineChange(0, tca))} Covered Arc change`);
  });

  it('the player is offered the RMG shot where its arc bears, and the turret-turning shot where it does not', () => {
    const { engine, state } = game([tank('cr', 'ja.ty89Bchiro'), sq('a', CHIRO_ONLY), sq('b', REAR_ONLY)]);
    const ds = fires(engine, state, 'ja');
    expect(ds).toContainEqual({ units: [], sw: ['cr.rmg'], target: CHIRO_ONLY });
    expect(ds.some((d) => d.sw.includes('cr.rmg') && d.target === REAR_ONLY && d.tca === undefined)).toBe(false);
    const turn = turretTurnFor(engine.env(state), { sw: ['cr.rmg'], target: REAR_ONLY });
    expect(ds).toContainEqual({ units: [], sw: ['cr.rmg'], target: REAR_ONLY, tca: turn });
    // And the BMG that turns the hull (SK4 7.8: the same principles for bow-mounted weapons).
    expect(ds.some((d) => d.sw.length === 1 && d.sw[0] === 'cr.bmg' && d.target === REAR_ONLY && d.vca !== undefined)).toBe(true);
  });

  it('an enemy entering a hex the RMG can reach only by turning the turret draws Defensive First Fire', () => {
    // The MA has malfunctioned, so only the MGs could answer; the BMG and RMG both point elsewhere.
    const { engine, state } = game([tank('cr', 'ja.ty89Bchiro', { malf: true }), sq('m', map.neighbors(REAR_ONLY).find((h) => map.distance(AT, h) > map.distance(AT, REAR_ONLY))!)], { first: 'am', phase: 'MPh' });
    let s = act(engine, state, { type: 'move.start', units: ['m'] }).state;
    s = act(engine, s, { type: 'move.step', to: REAR_ONLY }).state;
    const d = engine.currentDecision(s)!;
    expect(d.kind).toBe('firstFire');
    expect(d.owner).toBe('ja');
    const offers = fires(engine, s, 'ja', 'defFire');
    expect(offers.some((x) => x.sw.includes('cr.rmg') && x.tca !== undefined)).toBe(true);
    const shot = offers.find((x) => x.sw.length === 1 && x.sw[0] === 'cr.rmg')!;
    const r = act(engine, s, { type: 'defFire', decl: shot });
    expect(r.state.pieces['cr']!.tags[T2.ca]).toBe(shot.tca);
    expect(ev(r, 'sk1.fire.attack')).toHaveLength(1);
  });

  it('across the turn: the turn record comes off, the RMG fires again from the new TCA and the tank moves', () => {
    const { engine, state } = game([tank('cr', 'ja.ty89Bchiro'), sq('b', REAR_ONLY)]);
    const tca = turretTurnFor(engine.env(state), { sw: ['cr.rmg'], target: REAR_ONLY })!;
    let s = act(engine, state, { type: 'fire', decl: { units: [], sw: ['cr.rmg'], target: REAR_ONLY, tca } }).state;
    expect(s.pieces['cr']!.tags['tcaTurnPhase']).toBeDefined();
    const step = (st: GameState) => act(engine, st, { type: engine.currentDecision(st)!.kind === 'firstFire' ? 'defPass' : 'endPhase' }).state;
    for (let i = 0; i < 80 && !(s.attacker === 'ja' && s.turn === 2 && s.phase === 'PFPh'); i++) s = step(s);
    expect([s.attacker, s.turn, s.phase]).toEqual(['ja', 2, 'PFPh']);
    for (const tag of ['tcaTurnPhase', 'tcaTurnSpines', 'tcaTurnPaid']) expect(s.pieces['cr']!.tags[tag]).toBeUndefined();
    expect(s.pieces['cr.rmg']!.tags['fire']).toBeUndefined();
    // The turret still points where the shot left it: the target is in the RMG's arc, no turn and no penalty.
    expect(s.pieces['cr']!.tags[T2.ca]).toBe(tca);
    const again = act(engine, s, { type: 'fire', decl: { units: [], sw: ['cr.rmg'], target: REAR_ONLY } });
    expect(labels(ev(again, 'sk1.fire.attack')[0]!).some((l) => /Covered Arc change/.test(l))).toBe(false);
    // Next Player Turn the tank moves.
    s = again.state;
    for (let i = 0; i < 80 && !(s.attacker === 'ja' && s.turn === 3 && s.phase === 'MPh'); i++) s = step(s);
    expect([s.attacker, s.turn, s.phase]).toEqual(['ja', 3, 'MPh']);
    s = act(engine, s, { type: 'vmove.start', vehicle: 'cr' }).state;
    while (engine.currentDecision(s)?.kind === 'firstFire') s = act(engine, s, { type: 'defPass' }).state;
    expect(engine.legalActions(s, 'ja').some((a) => a.type === 'move.step')).toBe(true);
  });
});

describe('a turret Rear MG never fires in the phase its MA fires (ASLRB D1.82 with SK4 7.8)', () => {
  const pieces = (def = 'ja.ty89Bchiro') => [tank('cr', def), sq('a', CHIRO_ONLY), sq('f', FRONT)];
  const toPhase = (engine: Engine, st: GameState, attacker: string, turn: number, phase: string) => {
    let s = st;
    for (let i = 0; i < 80 && !(s.attacker === attacker && s.turn === turn && s.phase === phase); i++) s = act(engine, s, { type: engine.currentDecision(s)!.kind === 'firstFire' ? 'defPass' : 'endPhase' }).state;
    expect([s.attacker, s.turn, s.phase]).toEqual([attacker, turn, phase]);
    return s;
  };
  const maShot = { weapon: 'cr', target: FRONT, targetType: 'ITT' };

  it('the MA fires first: the turret RMG is barred for the phase, everywhere it is offered; the BMG is not', () => {
    const { engine, state } = game([...pieces(), sq('b', REAR_ONLY)]);
    const s = act(engine, state, { type: 'fire.ordnance', shot: maShot }).state;
    const env = engine.env(s);
    expect(vehicleMgUnavailable(env, 'cr.rmg')).toMatch(/D1\.82/);
    expect(refusal(engine, s, { type: 'fire', decl: { units: [], sw: ['cr.rmg'], target: CHIRO_ONLY } })).toMatch(/D1\.82/);
    // Nor with a turret turn, and in no legal list either way.
    const tca = turretTurnFor(env, { sw: ['cr.rmg'], target: REAR_ONLY });
    expect(refusal(engine, s, { type: 'fire', decl: { units: [], sw: ['cr.rmg'], target: REAR_ONLY, tca } })).toMatch(/D1\.82/);
    expect(fires(engine, s, 'ja').some((d) => d.sw.includes('cr.rmg'))).toBe(false);
    expect(fires(engine, s, 'ja').some((d) => d.sw.includes('cr.bmg'))).toBe(true);
  });

  it('the turret RMG fires first: the MA is barred for the phase (To Hit and IFE), and the IFE never joins the RMG', () => {
    const { engine, state } = game(pieces());
    const s = act(engine, state, { type: 'fire', decl: { units: [], sw: ['cr.rmg'], target: CHIRO_ONLY } }).state;
    expect(refusal(engine, s, { type: 'fire.ordnance', shot: maShot })).toMatch(/D1\.82/);
    expect(engine.legalActions(s, 'ja').some((a) => a.type === 'fire.ordnance' && (a['shot'] as { weapon: string }).weapon === 'cr')).toBe(false);
    const ife = game([tank('ie', 'ja.testIfe'), sq('a', CHIRO_ONLY), sq('f', FRONT)]);
    expect(refusal(ife.engine, ife.state, { type: 'fire', decl: { units: [], sw: ['ie', 'ie.rmg'], target: FRONT } })).toMatch(/D1\.82/);
    const r = act(ife.engine, ife.state, { type: 'fire', decl: { units: [], sw: ['ie.rmg'], target: CHIRO_ONLY } }).state;
    expect(refusal(ife.engine, r, { type: 'fire', decl: { units: [], sw: ['ie'], target: FRONT } })).toMatch(/D1\.82/);
  });

  it("a hull RMG (an NT vehicle's) is not bound by it (ASLRB D1.81)", () => {
    const { engine, state } = game([tank('nt', 'ja.testNt'), sq('f', FRONT), sq('b', REAR_ONLY)]);
    const s = act(engine, state, { type: 'fire.ordnance', shot: { ...maShot, weapon: 'nt' } }).state;
    expect(vehicleMgUnavailable(engine.env(s), 'nt.rmg')).toBeNull();
    expect(refusal(engine, s, { type: 'fire', decl: { units: [], sw: ['nt.rmg'], target: REAR_ONLY } })).toBeNull();
  });

  it('Defensive First Fire by the MA bars the RMG in that MPh; in the DFPh (another phase, though one fire phase for SK4 7.8) it may fire', () => {
    const start = map.neighbors(FRONT).find((h) => map.distance(AT, h) > map.distance(AT, FRONT) && !inArc(4, h))!;
    const { engine, state } = game([tank('cr', 'ja.ty89Bchiro'), sq('m', start), sq('a', CHIRO_ONLY)], { first: 'am', phase: 'MPh' });
    let s = act(engine, state, { type: 'move.start', units: ['m'] }).state;
    s = act(engine, s, { type: 'move.step', to: FRONT }).state;
    expect(engine.currentDecision(s)!.kind).toBe('firstFire');
    s = act(engine, s, { type: 'defFire.ordnance', shot: maShot }).state;
    // Still the same MPh: no RMG offer.
    if (engine.currentDecision(s)?.kind === 'firstFire') expect(fires(engine, s, 'ja', 'defFire').some((d) => d.sw.includes('cr.rmg'))).toBe(false);
    s = toPhase(engine, s, 'am', 1, 'DFPh');
    expect(refusal(engine, s, { type: 'fire', decl: { units: [], sw: ['cr.rmg'], target: CHIRO_ONLY } })).toBeNull();
  });

  it('across the turn: the record comes off, the next Player Turn the RMG fires normally, and the one after the MA', () => {
    // Every shot misses or does nothing, so nobody routs on the way.
    const { engine, state } = game(pieces(), { dice: Array(200).fill(5) });
    let s = act(engine, state, { type: 'fire.ordnance', shot: maShot }).state;
    expect(s.pieces['cr']!.tags['maFiredPhase']).toBeDefined();
    s = toPhase(engine, s, 'am', 1, 'RPh');
    expect(playerTurnLeftovers(s)).toEqual([]);
    expect(s.pieces['cr']!.tags['maFiredPhase']).toBeUndefined();
    s = toPhase(engine, s, 'ja', 2, 'PFPh');
    const r = act(engine, s, { type: 'fire', decl: { units: [], sw: ['cr.rmg'], target: CHIRO_ONLY } });
    expect(ev(r, 'sk1.fire.attack')).toHaveLength(1);
    s = toPhase(engine, r.state, 'ja', 3, 'PFPh');
    expect(refusal(engine, s, { type: 'fire.ordnance', shot: maShot })).toBeNull();
  });
});
