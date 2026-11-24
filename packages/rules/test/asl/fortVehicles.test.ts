import { describe, expect, it } from 'vitest';
import type { Action, Engine, GameState, RuleModule } from '@asl/engine';
import { aslCoreModules, fortCounters, moveState, piecesModule, turnModule, type FortPlacement, type HexTerrainSpec } from '../../src';
import { sk1CoreModules } from '../../src/sk1';
import { sk2CoreModules } from '../../src/sk2';
import { sk3CoreModules } from '../../src/sk3';
import { act, makeEngine, type PieceSpec } from '../fixtures';

/*
 * Vehicles and the entrenchment counters (ASLRB B27.43, B27.51, B27.52, D9.3, A12.33): the Armored Car's MP into a
 * foxhole hex, a vehicle set up beneath a trench and what it may not do there. The ground is a stretch of board u: L4
 * woods, everything else Open Ground.
 */

const SK: RuleModule[] = [piecesModule, turnModule, ...sk1CoreModules, ...sk2CoreModules, ...sk3CoreModules];
const ASL: RuleModule[] = [...SK, ...aslCoreModules];
const GROUND: Record<string, HexTerrainSpec> = { uL4: { terrain: 'woods' } };

const testModule: RuleModule = {
  id: 'test.fortVehicles',
  install(r) {
    r.action<Action & { fortSide: string; counters: FortPlacement[] }>({
      type: 'test.fortPlace',
      decisionKinds: ['phase', 'firstFire'],
      resolve(ctx, a) {
        const n = fortCounters(ctx).length;
        ctx.emit('asl.fort.placed', { side: a.fortSide, counters: a.counters.map((c, i) => ({ ...c, id: `${a.fortSide}.fort${n + i + 1}`, side: a.fortSide })) });
      },
    });
    // A unit put beneath the entrenchment of its hex, as the setup does for a unit set up beneath it (B27.51).
    r.action<Action & { id: string; hex: string; ent?: 'foxhole' | 'trench' | 'ditch' }>({
      type: 'test.teleport',
      decisionKinds: ['phase', 'firstFire'],
      resolve(ctx, a) {
        ctx.emit('piece.moved', { id: a.id, loc: { kind: 'hex', hex: a.hex, ...(a.ent ? { pos: { ent: a.ent } } : {}) } });
      },
    });
  },
};

export function game(pieces: PieceSpec[], opts: { dice?: number[]; phase?: string; first?: 'ge' | 'ru' } = {}) {
  const scenario = {
    firstSide: opts.first ?? 'ge',
    sides: [
      { side: 'ge', name: 'German', nationality: 'ge', elr: 3 },
      { side: 'ru', name: 'Russian', nationality: 'ru', elr: 3 },
    ],
    forces: [],
  };
  return makeEngine({ board: 'u', terrain: GROUND, scenario, modules: ASL, extra: [testModule], pieces, startPhase: opts.phase ?? 'MPh', dice: opts.dice ?? [] });
}
type Eng = Engine;
const fox = (hex: string, hidden = false): FortPlacement => ({ kind: 'foxhole', hex, hidden, capacity: 1 });
export const trench = (hex: string, hidden = false): FortPlacement => ({ kind: 'trench', hex, hidden });
export const tele = (engine: Eng, state: GameState, id: string, hex: string, ent?: 'foxhole' | 'trench' | 'ditch') => act(engine, state, { type: 'test.teleport', id, hex, ...(ent ? { ent } : {}) }).state;
const place = (engine: Eng, state: GameState, fortSide: string, counters: FortPlacement[]) => act(engine, state, { type: 'test.fortPlace', fortSide, counters }).state;
const check = (engine: Eng, state: GameState, a: Record<string, unknown>) => {
  const d = engine.currentDecision(state)!;
  return engine.validate(state, { side: d.owner, decisionId: d.id, ...a } as never);
};
const pass = (engine: Eng, s: GameState, side: string) => {
  let x = s;
  while (engine.currentDecision(x)?.owner === side && engine.currentDecision(x)?.kind === 'firstFire') x = act(engine, x, { type: 'defPass' }).state;
  return x;
};
const far: PieceSpec[] = [
  { id: 'gfar', def: 'ge.467', side: 'ge', hex: 'uY10' },
  { id: 'rfar', def: 'ru.447', side: 'ru', hex: 'uA1' },
];
const psw = (hex = 'uO5'): PieceSpec => ({ id: 'ac', def: 'ge.psw2341', side: 'ge', hex, tags: { vca: 3, ca: 3 } });
const pz = (hex = 'uO5'): PieceSpec => ({ id: 'pz', def: 'ge.pzivf2', side: 'ge', hex, tags: { vca: 3, ca: 3 } });

/** One step of a German vehicle from O5 into N5 with the given counters there: what it spent, whether it rolled for Bog, where it is. */
function step(vehicle: PieceSpec, counters: { side: string; c: FortPlacement[] }[], opts: { placeAfterStart?: boolean } = {}) {
  const { engine, state } = game([vehicle, ...far], { dice: [3, 3, 3, 3, 3, 3] });
  let s = state;
  if (!opts.placeAfterStart) for (const x of counters) s = place(engine, s, x.side, x.c);
  s = act(engine, s, { type: 'vmove.start', vehicle: vehicle.id }).state;
  s = pass(engine, s, 'ru');
  if (opts.placeAfterStart) for (const x of counters) s = place(engine, s, x.side, x.c);
  const before = moveState(engine.env(s))!.spent[vehicle.id]!;
  const r = act(engine, s, { type: 'move.step', to: 'uN5' });
  const after = r.events.filter((e) => e.type === 'sk1.move.state').map((e) => (e.payload as { state: { spent: Record<string, number> } | null }).state).find((x) => x)?.spent[vehicle.id] ?? before;
  return { engine, s, r, spent: after - before, bog: r.events.some((e) => e.type === 'sk3.vehicle.bog'), at: r.state.pieces[vehicle.id]!.loc as { hex: string } };
}

describe('B27.43: vehicles and foxholes', () => {
  it('an Armored Car pays 2 MP more to enter a foxhole hex and makes no Bog Check there; a tracked vehicle pays nothing more', () => {
    const plain = step(psw(), []);
    const foxhole = step(psw(), [{ side: 'ru', c: [fox('uN5')] }]);
    expect(foxhole.at.hex).toBe('uN5');
    expect(foxhole.spent - plain.spent).toBe(2);
    expect(foxhole.bog).toBe(false);
    expect(foxhole.engine.env(foxhole.s).query('vehicle.extraMp', { vehicle: 'ac', hex: 'uN5' }, 0)).toBe(2);
    const tank = step(pz(), [{ side: 'ru', c: [fox('uN5')] }]);
    const tankPlain = step(pz(), []);
    expect(tank.at.hex).toBe('uN5');
    expect(tank.spent).toBe(tankPlain.spent);
    expect(tank.bog).toBe(false);
  });

  it('the Armored Car pays the 2 MP in its own side\'s hidden foxhole: A12.33\'s free entry is Infantry\'s (Q&A [K33] to A12.33)', () => {
    const plain = step(psw(), []);
    const own = step(psw(), [{ side: 'ge', c: [fox('uN5', true)] }]);
    expect(own.at.hex).toBe('uN5');
    expect(own.spent - plain.spent).toBe(2);
    expect(own.r.events.some((e) => e.type === 'asl.ent.vehicleRefused')).toBe(false);
  });

  it('an enemy foxhole the Armored Car cannot know of is found by the attempt: revealed, the step refused with nothing spent; then it enters at 2 MP more', () => {
    const found = step(psw(), [{ side: 'ru', c: [fox('uN5', true)] }], { placeAfterStart: true });
    expect(check(found.engine, found.s, { type: 'move.step', to: 'uN5' })).toBeNull();
    expect(found.r.events.find((e) => e.type === 'asl.ent.vehicleRefused')?.payload).toMatchObject({ vehicle: 'ac', hex: 'uN5', kind: 'foxhole' });
    expect(fortCounters(found.engine.env(found.r.state))[0]!.revealed).toBe(true);
    expect(found.at.hex).toBe('uO5');
    expect(found.spent).toBe(0);
    const plain = step(psw(), []);
    const r2 = act(found.engine, found.r.state, { type: 'move.step', to: 'uN5' });
    const spent2 = moveState(found.engine.env(r2.state))!.spent['ac']! - moveState(found.engine.env(found.r.state))!.spent['ac']!;
    expect(r2.state.pieces['ac']!.loc).toMatchObject({ hex: 'uN5' });
    expect(spent2 - plain.spent).toBe(2);
    // A tracked vehicle is not slowed, so a hidden foxhole in its way does not stop it.
    const tank = step(pz(), [{ side: 'ru', c: [fox('uN5', true)] }], { placeAfterStart: true });
    expect(tank.at.hex).toBe('uN5');
    expect(tank.r.events.some((e) => e.type === 'asl.ent.vehicleRefused')).toBe(false);
  });
});

/** Plays on, passing every fire and ending every phase, until `attacker`'s `phase` of Game Turn `turn` is open for its owner. */
export function advanceTo(engine: Eng, s0: GameState, phase: string, attacker: string, turn = s0.turn + 1): GameState {
  let s = s0;
  for (let i = 0; i < 800 && !(s.turn === turn && s.phase === phase && s.attacker === attacker && engine.currentDecision(s)?.kind === 'phase'); i++) {
    const d = engine.currentDecision(s)!;
    const legal = engine.legalActions(s, d.owner);
    const a = legal.find((x) => x.type === 'defPass') ?? legal.find((x) => x.type === 'move.end' || x.type === 'vmove.end') ?? legal.find((x) => x.type === 'endPhase') ?? legal.find((x) => x.type === 'wa.done') ?? legal[0]!;
    s = act(engine, s, a).state;
  }
  return s;
}

describe('B27.43 across Player Turns', () => {
  it('the Armored Car that entered a foxhole hex starts and moves on normally in its next MPh', () => {
    const { engine, state } = game([psw(), ...far], { dice: Array(60).fill(3) });
    let s = place(engine, state, 'ru', [fox('uN5')]);
    s = act(engine, s, { type: 'vmove.start', vehicle: 'ac' }).state;
    s = pass(engine, s, 'ru');
    s = pass(engine, act(engine, s, { type: 'move.step', to: 'uN5' }).state, 'ru');
    expect(s.pieces['ac']!.loc).toMatchObject({ hex: 'uN5' });
    s = advanceTo(engine, s, 'MPh', 'ge');
    expect(s.turn).toBe(2);
    expect(check(engine, s, { type: 'vmove.start', vehicle: 'ac' })).toBeNull();
    s = pass(engine, act(engine, s, { type: 'vmove.start', vehicle: 'ac' }).state, 'ru');
    // Out of the foxhole hex into open ground: no foxhole MP (the cost is for entering, B27.43).
    const to = engine.legalActions(s, 'ge').find((a) => a.type === 'move.step')!['to'] as string;
    expect(engine.env(s).query('vehicle.extraMp', { vehicle: 'ac', hex: to }, 0)).toBe(0);
    s = pass(engine, act(engine, s, { type: 'move.step', to }).state, 'ru');
    expect(s.pieces['ac']!.loc).toMatchObject({ hex: to });
  });
});

describe('B27.52: a vehicle beneath a trench', () => {
  const t34 = (hex = 'uN5'): PieceSpec => ({ id: 't34', def: 'ru.T34M41', side: 'ru', hex, tags: { vca: 0, ca: 0 } });
  /** The T-34 beneath the Russian trench of N5 (as set up there, B27.51), Russian `phase`. */
  function dug(phase: string, pieces: PieceSpec[] = [], first: 'ru' | 'ge' = 'ru') {
    const g = game([t34(), ...pieces, ...far], { phase, first, dice: Array(40).fill(3) });
    let s = place(g.engine, g.state, 'ru', [trench('uN5')]);
    s = tele(g.engine, s, 't34', 'uN5', 'trench');
    return { ...g, s };
  }

  it('may not expend a Start MP, change its VCA or attempt Motion, each with its reason; its turret turns', () => {
    const mph = dug('MPh');
    expect(check(mph.engine, mph.s, { type: 'vmove.start', vehicle: 't34' })).toMatch(/Beneath the trench: no Start MP \(ASLRB B27.52\)/);
    expect(mph.engine.legalActions(mph.s, 'ru').some((a) => a.type === 'vmove.start' && a['vehicle'] === 't34')).toBe(false);
    const env = mph.engine.env(mph.s);
    expect(env.query('vehicle.cannotTurn', { vehicle: 't34' }, null)).toMatch(/no VCA change \(ASLRB B27.52\)/);
    expect(env.query('vehicle.cannotAttemptMotion', { vehicle: 't34' }, null)).toMatch(/no Motion attempt/);
    const pf = dug('PFPh');
    expect(check(pf.engine, pf.s, { type: 'vehicle.face', vehicle: 't34', vca: 2 })).toMatch(/Beneath the trench: no VCA change/);
    // D4.221 "the vehicle's TCA may be" moved: only the hull is held.
    expect(check(pf.engine, pf.s, { type: 'vehicle.face', vehicle: 't34', tca: 2 })).toBeNull();
    const r = act(pf.engine, pf.s, { type: 'vehicle.face', vehicle: 't34', tca: 2 });
    expect(r.state.pieces['t34']!.tags['ca']).toBe(2);
    expect(r.state.pieces['t34']!.tags['vca']).toBe(0);
    // Out of the trench (on top in the same hex) the same tank starts normally.
    const top = game([t34(), ...far], { phase: 'MPh', first: 'ru' });
    const s2 = place(top.engine, top.state, 'ru', [trench('uN5')]);
    expect(check(top.engine, s2, { type: 'vmove.start', vehicle: 't34' })).toBeNull();
  });

  it('the Motion attempt is not offered to it in the enemy MPh', () => {
    const { engine, s } = dug('MPh', [{ id: 'g', def: 'ge.467', side: 'ge', hex: 'uN8' }], 'ge');
    const moving = act(engine, s, { type: 'move.start', units: ['g'] }).state;
    const stepped = act(engine, moving, { type: 'move.step', to: 'uN7' }).state;
    expect(engine.currentDecision(stepped)?.kind).toBe('firstFire');
    expect(engine.legalActions(stepped, 'ru').some((a) => a.type === 'defMotion')).toBe(false);
    expect(check(engine, stepped, { type: 'defMotion', vehicle: 't34' })).toMatch(/Beneath the trench: no Motion attempt/);
  });

  it('an NT vehicle beneath it may not pivot its hull to fire outside its CA', () => {
    const g = game([{ id: 'sg', def: 'ge.stug3g', side: 'ge', hex: 'uN5', tags: { vca: 0, ca: 0 } }, { id: 'r', def: 'ru.447', side: 'ru', hex: 'uK3' }, ...far], { phase: 'PFPh', first: 'ge' });
    let s = place(g.engine, g.state, 'ge', [trench('uN5')]);
    // The pivot that brings the Russian squad in K3 into the StuG's arc: legal on top of the trench, refused beneath it.
    const shot = (ca: number) => ({ weapon: 'sg', target: 'uK3', targetType: 'ITT', ca });
    const illegal = (x: GameState, ca: number) => g.engine.env(x).query('ordnance.illegal', { shot: shot(ca) as never, mode: 'prep', side: 'ge' }, null);
    const ca = [1, 2, 3, 4, 5].find((c) => illegal(s, c) === null)!;
    expect(ca).toBeDefined();
    s = tele(g.engine, s, 'sg', 'uN5', 'trench');
    expect(illegal(s, ca)).toMatch(/Beneath the trench: an NT vehicle may not pivot its hull to fire \(ASLRB B27.52\)/);
  });

  it('Infantry in its Location get no +1 from it (D9.3); a tank on top of the trench still gives it', () => {
    const sq: PieceSpec = { id: 'sq', def: 'ru.447', side: 'ru', hex: 'uN5' };
    const g: PieceSpec = { id: 'g', def: 'ge.467', side: 'ge', hex: 'uN8' };
    const attack = { mode: 'prep', side: 'ge', target: 'uN5', parts: [{ piece: 'g', firer: 'g', kind: 'unit', hex: 'uN8', range: 3, dist: 3 }], targets: ['sq'], hindrance: 0 };
    const drm = (beneath: boolean) => {
      const x = game([t34(), sq, g, ...far], { phase: 'PFPh', first: 'ge' });
      let s = place(x.engine, x.state, 'ru', [trench('uN5')]);
      if (beneath) s = tele(x.engine, s, 't34', 'uN5', 'trench');
      return x.engine.env(s).explain('fire.unitDrm', { attack: attack as never, unit: 'sq' }, 0);
    };
    const onTop = drm(false);
    const beneath = drm(true);
    expect(onTop.trace.some((t) => t.id === 'sk3.drm.afv-cover' && !t.suppressedBy)).toBe(true);
    expect(beneath.trace.some((t) => t.id === 'sk3.drm.afv-cover' && !t.suppressedBy)).toBe(false);
    expect(onTop.value - beneath.value).toBe(1);
  });
});
