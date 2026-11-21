import { describe, expect, it } from 'vitest';
import type { Action, Engine, GameState, RuleModule } from '@asl/engine';
import { acrossSide, aslCoreModules, beltHexes, beltsIllegal, clearanceTasks, fortCounters, fortificationView, moveState, piecesModule, redactState, sideToward, statics, trailBreaksAt, turnModule, type FortPlacement, type HexTerrainSpec } from '../../src';
import { planRout } from '../../src/sk1/rout';
import { AERIAL_AF, aerialAf, lastMineAttacks, mineExitExempt, tbVehicleIllegal } from '../../src/asl/mines';
import { boobyTrapsModule } from '../../src/asl/boobyTraps';
import { P as MP, type CheckUnitFn } from '../../src/sk1/morale';
import { fortifiedModule } from '../../src/sk1/fortified';
import { exitTargets } from '../../src/sk1/movement';
import { sk1CoreModules } from '../../src/sk1';
import { sk2CoreModules } from '../../src/sk2';
import { sk3CoreModules } from '../../src/sk3';
import { act, makeEngine, type PieceSpec } from '../fixtures';

/*
 * Minefields in play (ASLRB B28.1–B28.413, B28.44, B28.47, A4.32, A8.22, A12.15): the A-P attack on entry and on exit, in
 * the MPh, APh and RtPh, one DR for the stack, no DRM, the reveal of presence and strength, a unit broken or pinned by
 * the exit attack staying, building hexsides and Trench movement, Bypass, the hidden-unit bounce, Dummies, and rout
 * round known minefields. Board u: L4 and M6 woods, K4–K5 one stone building, everything else Open Ground. The test IFT
 * is the fixture's (8 column: DR 3 1KIA, 4 K/2, 5 K/1, 6 2MC, 7 1MC, 8 NMC, 9 PTC, 10+ no effect).
 */

const SK: RuleModule[] = [piecesModule, turnModule, ...sk1CoreModules, ...sk2CoreModules, ...sk3CoreModules];
const ASL: RuleModule[] = [...SK, ...aslCoreModules];
const GROUND: Record<string, HexTerrainSpec> = {
  uL4: { terrain: 'woods' },
  uM6: { terrain: 'woods' },
  uK4: { terrain: 'building-stone', buildingId: 'u-B16' },
  uK5: { terrain: 'building-stone', buildingId: 'u-B16' },
  uM4: { terrain: 'open', features: ['road:paved'] },
};

const testModule: RuleModule = {
  id: 'test.mines',
  install(r) {
    r.action<Action & { fortSide: string; counters: FortPlacement[] }>({
      type: 'test.fortPlace',
      decisionKinds: ['phase', 'firstFire'],
      resolve(ctx, a) {
        const n = fortCounters(ctx).length;
        ctx.emit('asl.fort.placed', { side: a.fortSide, counters: a.counters.map((c, i) => ({ ...c, id: `${a.fortSide}.fort${n + i + 1}`, side: a.fortSide })) });
      },
    });
    r.action<Action & { id: string; hex: string; ent?: 'trench' }>({
      type: 'test.teleport',
      decisionKinds: ['phase'],
      resolve(ctx, a) {
        ctx.emit('piece.moved', { id: a.id, loc: { kind: 'hex', hex: a.hex, ...(a.ent ? { pos: { ent: a.ent } } : {}) } });
      },
    });
    r.action<Action & { unit: string }>({
      type: 'test.ptc',
      decisionKinds: ['phase'],
      resolve(ctx, a) {
        ctx.proc<CheckUnitFn>(MP.checkUnit)(ctx, a.unit, { kind: 'PTC', mod: 0, reason: 'test' });
      },
    });
    r.action<Action & { hex: string; tbs: [number, number][] }>({
      type: 'test.tbs',
      decisionKinds: ['phase'],
      resolve(ctx, a) {
        ctx.emit('asl.tb', { hex: a.hex, tbs: a.tbs });
      },
    });
    r.action<Action & { id: string; tags: Record<string, unknown> }>({
      type: 'test.tag',
      decisionKinds: ['phase'],
      resolve(ctx, a) {
        ctx.emit('piece.tagged', { id: a.id, tags: a.tags as Record<string, never> });
      },
    });
  },
};

export function game(pieces: PieceSpec[], opts: { dice?: number[]; phase?: string; first?: 'ge' | 'ru'; ground?: Record<string, HexTerrainSpec>; extra?: RuleModule[]; ssr?: { module: string; params: Record<string, unknown>; text: string }[]; exits?: { side: string; hexes: string[] }[] } = {}) {
  const scenario = {
    ...(opts.exits ? { exits: opts.exits } : {}),
    ...(opts.ssr ? { ssr: opts.ssr } : {}),
    firstSide: opts.first ?? 'ge',
    sides: [
      { side: 'ge', name: 'German', nationality: 'ge', elr: 3 },
      { side: 'ru', name: 'Russian', nationality: 'ru', elr: 3 },
    ],
    forces: [],
  };
  return makeEngine({ board: 'u', terrain: { ...GROUND, ...opts.ground }, roadHexsides: [['uM4', 'uM5']], scenario, modules: ASL, extra: [...(opts.extra ?? []), testModule], pieces, startPhase: opts.phase ?? 'MPh', dice: opts.dice ?? [] });
}
type Eng = Engine;
export const mines = (hex: string, m: FortPlacement['mines'], hidden = !m?.known && !m?.dummy): FortPlacement => ({ kind: 'mines', hex, hidden, mines: m });
export const place = (engine: Eng, state: GameState, fortSide: string, counters: FortPlacement[]) => act(engine, state, { type: 'test.fortPlace', fortSide, counters }).state;
const tag = (engine: Eng, state: GameState, id: string, tags: Record<string, unknown>) => act(engine, state, { type: 'test.tag', id, tags }).state;
const check = (engine: Eng, state: GameState, a: Record<string, unknown>) => {
  const d = engine.currentDecision(state)!;
  return engine.validate(state, { side: d.owner, decisionId: d.id, ...a } as never);
};
const legal = (engine: Eng, s: GameState, type: string) => engine.legalActions(s, engine.currentDecision(s)!.owner).filter((a) => a.type === type);
export const pass = (engine: Eng, s: GameState) => {
  let x = s;
  while (engine.currentDecision(x)?.kind === 'firstFire') x = act(engine, x, { type: 'defPass' }).state;
  return x;
};
const ge = (id: string, hex: string, def = 'ge.467'): PieceSpec => ({ id, def, side: 'ge', hex });
const ru = (id: string, hex: string, def = 'ru.447'): PieceSpec => ({ id, def, side: 'ru', hex });
const far = [ge('gfar', 'uGG1'), ru('rfar', 'uA1')];
type Ev = { type: string; payload: unknown };
const attacks = (events: Ev[]) => events.filter((e) => e.type === 'asl.mines.attack').map((e) => e.payload as { hex: string; way: string; by: string; units: string[]; dr: number[]; result: { kind: string }; factors?: number });
const results = (events: Ev[]) => events.filter((e) => e.type === 'sk1.fire.result').map((e) => e.payload as { unit: string; finalDr: number; result: { kind: string } });
const hexOf = (s: GameState, id: string) => (s.pieces[id]!.loc as { hex?: string }).hex;

describe('The A-P minefield attack (B28.1, B28.3, B28.41, B28.411)', () => {
  it('a stack entering a hidden minefield takes one DR, with no DRM at all, even in woods', () => {
    // 4 + 3 = 7 on the 8 column: 1MC for both; their MC DRs 3 and 4 pass.
    const { engine, state } = game([ge('a', 'uM5'), ge('b', 'uM5'), ...far], { dice: [4, 3, 1, 2, 2, 2] });
    let s = place(engine, state, 'ru', [mines('uM6', { ap: 8 })]);
    s = act(engine, s, { type: 'move.start', units: ['a', 'b'] }).state;
    const r = act(engine, s, { type: 'move.step', to: 'uM6' });
    const att = attacks(r.events);
    expect(att).toEqual([{ counter: 'ru.fort1', hex: 'uM6', way: 'enter', by: 'move', units: ['a', 'b'], dr: [4, 3], result: { kind: 'MC', n: 1 }, factors: 8 }]);
    // No woods TEM, FFNAM or anything else: the Final DR is the Original DR (B28.3, A4.6).
    expect(results(r.events).map((x) => [x.unit, x.finalDr])).toEqual([['a', 7], ['b', 7]]);
    // The counter is on the board for everyone, its strength shown since the result had to be verified (B28.41).
    expect(fortificationView(engine.env(r.state), 'ge')).toMatchObject([{ hex: 'uM6', revealed: true, mines: { ap: 8, strengthRevealed: true } }]);
    // No Residual FP is left (A8.22).
    expect(r.state.hexMarkers['uM6']?.['residualFp']).toBeUndefined();
    // The DEFENDER's First Fire question and the stack card name the attack the stack just survived; gone with the MPh.
    expect(lastMineAttacks(engine.env(r.state))).toEqual([expect.objectContaining({ hex: 'uM6', way: 'enter', units: ['a', 'b'] })]);
    const later = playTo(engine, pass(engine, r.state), (x) => x.phase !== 'MPh');
    expect(later.s.ext['asl.mines.last']).toBeUndefined();
  });

  it('a "no effect" attack shows the minefield but not its strength (B28.1)', () => {
    const { engine, state } = game([ge('a', 'uM5'), ...far], { dice: [6, 5] });
    let s = place(engine, state, 'ru', [mines('uN5', { ap: 12 })]);
    s = act(engine, s, { type: 'move.start', units: ['a'] }).state;
    s = act(engine, s, { type: 'move.step', to: 'uN5' }).state;
    expect(fortificationView(engine.env(s), 'ge')).toMatchObject([{ hex: 'uN5', revealed: true, mines: {} }]);
    expect(fortificationView(engine.env(s), 'ge')[0]!.mines!.ap).toBeUndefined();
    // Online: the German seat and a spectator see the counter with no strength; the owner sees it all.
    expect((redactState(engine, s, 'ge').ext['asl.fortifications'] as { counters: { mines: object }[] }).counters[0]!.mines).toEqual({});
    expect((redactState(engine, s, null).ext['asl.fortifications'] as { counters: { mines: object }[] }).counters[0]!.mines).toEqual({});
    expect((redactState(engine, s, 'ru').ext['asl.fortifications'] as { counters: { mines: object }[] }).counters[0]!.mines).toEqual({ ap: 12 });
  });

  it('a step into a hidden minefield costs what the hex costs: no extra MF (B28.4)', () => {
    const { engine, state } = game([ge('a', 'uM5'), ...far], { dice: [6, 6] });
    let s = place(engine, state, 'ru', [mines('uN5', { ap: 6 })]);
    s = act(engine, s, { type: 'move.start', units: ['a'] }).state;
    s = act(engine, s, { type: 'move.step', to: 'uN5' }).state;
    expect(moveState(engine.env(s))!.spent).toEqual({ a: 1 });
  });

  it('A-T mines never attack Infantry, and reveal nothing to them (B28.41, B28.5)', () => {
    const { engine, state } = game([ge('a', 'uM5'), ...far]);
    let s = place(engine, state, 'ru', [mines('uN5', { at: 2 })]);
    s = act(engine, s, { type: 'move.start', units: ['a'] }).state;
    const r = act(engine, s, { type: 'move.step', to: 'uN5' });
    expect(attacks(r.events)).toEqual([]);
    expect(fortificationView(engine.env(r.state), 'ge')).toEqual([]);
  });

  it('only the moving units are attacked, not the others in the Location (B28.411)', () => {
    const { engine, state } = game([ge('a', 'uM5'), ge('there', 'uN5'), ...far], { dice: [6, 6] });
    let s = place(engine, state, 'ru', [mines('uN5', { ap: 8 })]);
    s = act(engine, s, { type: 'move.start', units: ['a'] }).state;
    const r = act(engine, s, { type: 'move.step', to: 'uN5' });
    expect(attacks(r.events)[0]!.units).toEqual(['a']);
  });

  it('the owner\'s own minefield attacks his own unit and so reveals itself (B28.41)', () => {
    const { engine, state } = game([ru('r', 'uM5'), ...far], { first: 'ru', dice: [6, 6] });
    let s = place(engine, state, 'ru', [mines('uN5', { ap: 8 })]);
    s = act(engine, s, { type: 'move.start', units: ['r'] }).state;
    const r = act(engine, s, { type: 'move.step', to: 'uN5' });
    expect(attacks(r.events)).toHaveLength(1);
    expect(fortificationView(engine.env(r.state), 'ge')).toMatchObject([{ hex: 'uN5', revealed: true }]);
  });

  it('the attack comes before Residual FP and the First Fire question (A8.22)', () => {
    const { engine, state } = game([ge('a', 'uM5'), ru('r', 'uN8'), ...far], { dice: [6, 6, 6, 6] });
    let s = place(engine, state, 'ru', [mines('uN5', { ap: 8 })]);
    s = { ...s, hexMarkers: { ...s.hexMarkers, uN5: { residualFp: 2 } } };
    s = act(engine, s, { type: 'move.start', units: ['a'] }).state;
    const r = act(engine, s, { type: 'move.step', to: 'uN5' });
    const order = r.events.filter((e) => e.type === 'asl.mines.attack' || e.type === 'sk1.fire.attack').map((e) => e.type);
    expect(order).toEqual(['asl.mines.attack', 'sk1.fire.attack']);
    expect(engine.currentDecision(r.state)?.kind).toBe('firstFire');
  });
});

describe('Leaving a minefield hex (B28.41, B28.412)', () => {
  it('the exit attack is resolved in the hex left; survivors move on', () => {
    const { engine, state } = game([ge('a', 'uN5'), ...far], { dice: [6, 6] });
    let s = place(engine, state, 'ru', [mines('uN5', { ap: 8 }, false)]);
    s = { ...s, ext: { ...s.ext } };
    s = act(engine, s, { type: 'move.start', units: ['a'] }).state;
    const r = act(engine, s, { type: 'move.step', to: 'uO5' });
    expect(attacks(r.events)).toMatchObject([{ hex: 'uN5', way: 'exit', units: ['a'] }]);
    expect(hexOf(r.state, 'a')).toBe('uO5');
  });

  it('a unit broken by the exit attack stays, its MF spent there; the rest go on (B28.412 EX)', () => {
    // DR 5 + 2 = 7: 1MC; a passes (2+2), b fails (5+6) and breaks.
    const { engine, state } = game([ge('a', 'uN5'), ge('b', 'uN5'), ...far], { dice: [5, 2, 2, 2, 5, 6] });
    let s = place(engine, state, 'ru', [mines('uN5', { ap: 8 })]);
    s = act(engine, s, { type: 'move.start', units: ['a', 'b'] }).state;
    s = act(engine, s, { type: 'move.step', to: 'uO5' }).state;
    expect(hexOf(s, 'a')).toBe('uO5');
    expect(hexOf(s, 'b')).toBe('uN5');
    expect(s.pieces['b']!.tags['broken']).toBe(true);
    expect(moveState(engine.env(s))!.units).toEqual(['a']);
  });

  it('a stack wholly stopped by the exit attack spends the step there and its move ends (B28.412 EX)', () => {
    const { engine, state } = game([ge('a', 'uN5'), ...far], { dice: [5, 2, 6, 6] });
    let s = place(engine, state, 'ru', [mines('uN5', { ap: 8 })]);
    s = act(engine, s, { type: 'move.start', units: ['a'] }).state;
    s = pass(engine, act(engine, s, { type: 'move.step', to: 'uO5' }).state);
    expect(hexOf(s, 'a')).toBe('uN5');
    expect(s.pieces['a']!.tags['broken']).toBe(true);
    expect(moveState(engine.env(s))).toBeUndefined();
  });

  it('from one minefield straight into another: two attacks, exit then entry (B28.412 EX)', () => {
    const { engine, state } = game([ge('a', 'uN5'), ...far], { dice: [6, 6, 6, 5] });
    let s = place(engine, state, 'ru', [mines('uN5', { ap: 8 }), mines('uO5', { ap: 6 })]);
    s = act(engine, s, { type: 'move.start', units: ['a'] }).state;
    const r = act(engine, s, { type: 'move.step', to: 'uO5' });
    expect(attacks(r.events).map((a) => [a.hex, a.way])).toEqual([['uN5', 'exit'], ['uO5', 'enter']]);
  });
});

describe('Building hexsides, trenches and Bypass (B28.44, A4.32)', () => {
  it('no attack through a building hexside of one building, in either direction', () => {
    const { engine, state } = game([ge('a', 'uK5'), ...far]);
    let s = place(engine, state, 'ru', [mines('uK4', { ap: 8 })]);
    s = act(engine, s, { type: 'move.start', units: ['a'] }).state;
    let r = act(engine, s, { type: 'move.step', to: 'uK4' });
    expect(attacks(r.events)).toEqual([]);
    r = act(engine, pass(engine, r.state), { type: 'move.step', to: 'uK5' });
    expect(attacks(r.events)).toEqual([]);
  });

  it('a unit entering the building hex from outside it is attacked', () => {
    const { engine, state } = game([ge('a', 'uJ4'), ...far], { dice: [6, 6] });
    let s = place(engine, state, 'ru', [mines('uK4', { ap: 8 })]);
    s = act(engine, s, { type: 'move.start', units: ['a'] }).state;
    const r = act(engine, s, { type: 'move.step', to: 'uK4' });
    expect(attacks(r.events)).toHaveLength(1);
  });
});

describe('Leaving the map from a minefield hex (B28.41)', () => {
  it('the stack takes the exit attack first; a unit broken by it stays on the map, the rest exit', () => {
    // DR 5 + 2 = 7: 1MC; a passes (2+2), b fails (5+6) and breaks.
    const { engine, state } = game([ge('a', 'uA5'), ge('b', 'uA5'), ...far], { dice: [5, 2, 2, 2, 5, 6], exits: [{ side: 'ge', hexes: ['uA5'] }] });
    let s = place(engine, state, 'ru', [mines('uA5', { ap: 8 })]);
    s = act(engine, s, { type: 'move.start', units: ['a', 'b'] }).state;
    const off = exitTargets(engine.env(s), moveState(engine.env(s))!)[0]!;
    const r = act(engine, s, { type: 'move.step', to: off });
    expect(attacks(r.events)).toMatchObject([{ hex: 'uA5', way: 'exit', units: ['a', 'b'] }]);
    expect(r.events.filter((e) => e.type === 'sk1.exited').map((e) => (e.payload as { unit: string }).unit)).toEqual(['a']);
    expect(hexOf(r.state, 'b')).toBe('uA5');
  });
});

describe('Trench movement and Bypass (B28.44, A4.32)', () => {
  it('no attack on Trench movement out of one mined trench hex into another', () => {
    const { engine, state } = game([ge('g', 'uN5'), ...far]);
    let s = place(engine, state, 'ge', [{ kind: 'trench', hex: 'uN5', hidden: false }, { kind: 'trench', hex: 'uO5', hidden: false }]);
    s = place(engine, s, 'ru', [mines('uN5', { ap: 8 }), mines('uO5', { ap: 8 })]);
    s = act(engine, s, { type: 'test.teleport', id: 'g', hex: 'uN5', ent: 'trench' }).state;
    s = act(engine, s, { type: 'move.start', units: ['g'] }).state;
    const r = act(engine, s, { type: 'move.step', to: 'uO5', beneath: true });
    expect(hexOf(r.state, 'g')).toBe('uO5');
    expect(attacks(r.events)).toEqual([]);
  });

  it('Bypass of a mined building hex is still entry: the mines attack (A4.32)', () => {
    const { engine, state } = game([ge('g', 'uQ4'), ...far], { dice: [6, 6], ground: { uR3: { terrain: 'building-wood', bypassBlocked: [] } } });
    let s = place(engine, state, 'ru', [mines('uR3', { ap: 6 })]);
    s = act(engine, s, { type: 'move.start', units: ['g'] }).state;
    const r = act(engine, s, { type: 'move.step', to: 'uR3', bypass: ['uR4'] });
    expect(attacks(r.events)).toMatchObject([{ hex: 'uR3', way: 'enter' }]);
  });
});

describe('A refusal that stops the step comes first (Q&A to B23.922 & B28.41)', () => {
  it('a unit refused entry to a Fortified Building Location takes no attack from the minefield it tried to leave', () => {
    const { engine, state } = game([ge('a', 'uJ4'), { ...ru('h', 'uK4'), tags: { hip: true } }, ...far], { dice: [6, 6, 6, 6], extra: [fortifiedModule] });
    let s = place(engine, state, 'ru', [mines('uJ4', { ap: 8 })]);
    s = { ...s, ext: { ...s.ext, 'sk1.fortified': { side: 'ru', buildings: ['u-B16'], revealed: [], locations: ['uK4'], revealedLocs: [] } } };
    s = act(engine, s, { type: 'move.start', units: ['a'] }).state;
    const r = act(engine, s, { type: 'move.step', to: 'uK4' });
    expect(r.events.some((e) => e.type === 'asl.fortified.refused')).toBe(true);
    expect(attacks(r.events)).toEqual([]);
    expect(hexOf(r.state, 'a')).toBe('uJ4');
  });
});

describe('Turned back by hidden units (A12.15)', () => {
  it('a stack leaving a minefield takes the exit attack, bounces off hidden units and is attacked as it re-enters', () => {
    const { engine, state } = game([ge('a', 'uN5'), { ...ru('h', 'uO5'), tags: { hip: true } }, ...far], { dice: [6, 6, 6, 5] });
    let s = place(engine, state, 'ru', [mines('uN5', { ap: 8 })]);
    s = act(engine, s, { type: 'move.start', units: ['a'] }).state;
    const r = act(engine, s, { type: 'move.step', to: 'uO5' });
    expect(attacks(r.events).map((a) => [a.hex, a.way])).toEqual([['uN5', 'exit'], ['uN5', 'enter']]);
    expect(hexOf(r.state, 'a')).toBe('uN5');
  });
});

describe('Dummy minefields (B28.47)', () => {
  it('a Dummy is found and removed when any ground unit enters its hex; the attacker\'s DR is never rolled', () => {
    const { engine, state } = game([ge('a', 'uM5'), ...far]);
    let s = place(engine, state, 'ru', [mines('uN5', { known: true, dummy: true })]);
    expect(fortificationView(engine.env(s), 'ge')).toMatchObject([{ hex: 'uN5', mines: { known: true } }]);
    s = act(engine, s, { type: 'move.start', units: ['a'] }).state;
    const r = act(engine, s, { type: 'move.step', to: 'uN5' });
    expect(attacks(r.events)).toEqual([]);
    expect(fortCounters(engine.env(r.state))).toEqual([]);
    expect(r.events.find((e) => e.type === 'asl.fort.removed')?.payload).toMatchObject({ hex: 'uN5', reason: expect.stringMatching(/Dummy/) });
  });
});

describe('Advancing (B28.411)', () => {
  it('an advance out of one minefield into another: exit then entry attack', () => {
    const { engine, state } = game([ge('a', 'uN5'), ...far], { phase: 'APh', dice: [6, 6, 6, 5] });
    const s = place(engine, state, 'ru', [mines('uN5', { ap: 8 }), mines('uO5', { ap: 6 })]);
    const r = act(engine, s, { type: 'advance', units: ['a'], to: 'uO5' });
    expect(attacks(r.events).map((a) => [a.hex, a.way, a.by])).toEqual([['uN5', 'exit', 'advance'], ['uO5', 'enter', 'advance']]);
    expect(hexOf(r.state, 'a')).toBe('uO5');
  });

  it('an advancing unit pinned by the exit attack stays (B28.412 EX)', () => {
    // DR 8 on the 8 column: NMC; MC DR 7 = Morale 7: pinned.
    const { engine, state } = game([ge('a', 'uN5'), ...far], { phase: 'APh', dice: [4, 4, 4, 3] });
    const s = place(engine, state, 'ru', [mines('uN5', { ap: 8 })]);
    const r = act(engine, s, { type: 'advance', units: ['a'], to: 'uO5' });
    expect(hexOf(r.state, 'a')).toBe('uN5');
    expect(r.state.pieces['a']!.tags['pinned']).toBe(true);
  });
});

describe('Rout and known minefields (B28.413, A10.51)', () => {
  it('a router need not go through a known minefield: the shelter round it is a legal destination too', () => {
    // From P5 the woods of M6 is nearest through the Known minefield of N5/N6; L4 lies round it.
    const pieces = [{ ...ru('b', 'uO5'), tags: { broken: true, dm: true } }, ge('g', 'uR5'), ...far];
    const plain = game(pieces, { phase: 'RtPh', first: 'ru' });
    const before = planRout(plain.engine.env(plain.state), 'b');
    const { engine, state } = game(pieces, { phase: 'RtPh', first: 'ru' });
    const s = place(engine, state, 'ge', [mines('uN6', { ap: 8, known: true }), mines('uN5', { ap: 8, known: true })]);
    const plan = planRout(engine.env(s), 'b');
    expect([...before.destinations]).toEqual(['uM6']);
    // Round the minefield L4 is the nearest shelter, and through it M6 still is: both are legal (A10.51 "at its option").
    expect([...plan.destinations].sort()).toEqual(['uL4', 'uM6']);
    expect(engine.env(s).query('rout.avoid', { unit: 'b' }, [])).toEqual(['uN5', 'uN6']);
  });

  it('a router never avoids its own hidden minefield, which attacks it on entry (Q&A to A10.51 & B28.413)', () => {
    const { engine, state } = game([{ ...ru('b', 'uN4'), tags: { broken: true, dm: true } }, ge('g', 'uP3'), ...far], { phase: 'RtPh', first: 'ru', dice: [6, 6] });
    const s = place(engine, state, 'ru', [mines('uM4', { ap: 8 })]);
    expect(engine.env(s).query('rout.avoid', { unit: 'b' }, [])).toEqual([]);
    const r = act(engine, s, { type: 'rout.step', unit: 'b', to: 'uM4' });
    expect(attacks(r.events)).toMatchObject([{ hex: 'uM4', way: 'enter', by: 'rout' }]);
  });

  it('a broken squad Reduced to a HS by the attack may end its rout there (B28.413)', () => {
    // DR 5 on the 8 column: K/1; the squad is Reduced; its 1MC with a broken HS: DR 2+3 passes.
    const { engine, state } = game([{ ...ru('b', 'uN4'), tags: { broken: true, dm: true } }, ...far], { phase: 'RtPh', first: 'ru', dice: [3, 2, 2, 3] });
    const s = place(engine, state, 'ru', [mines('uM4', { ap: 8 })]);
    const r = act(engine, s, { type: 'rout.step', unit: 'b', to: 'uM4' });
    expect(r.state.pieces['b']!.defId).toBe('ru.247');
    expect(legal(engine, r.state, 'rout.endHere')).toMatchObject([{ type: 'rout.endHere', unit: 'b' }]);
    const e = act(engine, r.state, { type: 'rout.endHere', unit: 'b' });
    expect(hexOf(e.state, 'b')).toBe('uM4');
    expect(legal(engine, e.state, 'rout.endHere')).toEqual([]);
    expect(e.state.ext['asl.mines.routOption']).toBeUndefined();
  });
});

describe('A DC Placed from a mined hex draws nothing (Q&A to A23.3 & B28.41)', () => {
  it('the placer neither enters nor leaves', () => {
    const { engine, state } = game([ge('a', 'uN5'), { id: 'dc', def: 'ge.DC', side: 'ge', heldBy: 'a' }, ru('r', 'uO5'), ...far]);
    let s = place(engine, state, 'ru', [mines('uN5', { ap: 8 })]);
    s = act(engine, s, { type: 'move.start', units: ['a'] }).state;
    if (check(engine, s, { type: 'move.placeDc', dc: 'dc', target: 'uO5' })) return;
    const r = act(engine, s, { type: 'move.placeDc', dc: 'dc', target: 'uO5' });
    expect(attacks(r.events)).toEqual([]);
  });
});

describe('Across Player Turns', () => {
  const advanceTo = (engine: Eng, s0: GameState, phase: string, attacker: string) => {
    let s = s0;
    for (let i = 0; i < 400 && !(s.phase === phase && s.attacker === attacker && engine.currentDecision(s)?.kind === 'phase'); i++) {
      const d = engine.currentDecision(s)!;
      const lg = engine.legalActions(s, d.owner);
      const a = lg.find((x) => x.type === 'defPass') ?? lg.find((x) => x.type === 'move.end') ?? lg.find((x) => x.type === 'endPhase') ?? lg[0]!;
      s = act(engine, s, a).state;
    }
    return s;
  };

  it('a squad that survived a hidden minefield leaves it next turn: the exit attack, then it moves on and is fired on normally; nothing is left behind', () => {
    const { engine, state } = game([ge('a', 'uO5'), ru('r', 'uN9'), ...far], { dice: [6, 6, ...Array(40).fill(6)] });
    let s = place(engine, state, 'ru', [mines('uN5', { ap: 8 })]);
    s = act(engine, s, { type: 'move.start', units: ['a'] }).state;
    s = act(engine, s, { type: 'move.step', to: 'uN5' }).state;
    s = advanceTo(engine, s, 'MPh', 'ru');
    s = advanceTo(engine, s, 'MPh', 'ge');
    expect(s.turn).toBe(2);
    expect(hexOf(s, 'a')).toBe('uN5');
    expect(s.pieces['a']!.tags['moved']).toBeUndefined();
    expect(Object.keys(s.ext).filter((k) => k.startsWith('asl.mines'))).toEqual([]);
    s = act(engine, s, { type: 'move.start', units: ['a'] }).state;
    const on = act(engine, s, { type: 'move.step', to: 'uO5' });
    expect(attacks(on.events)).toMatchObject([{ hex: 'uN5', way: 'exit' }]);
    expect(hexOf(on.state, 'a')).toBe('uO5');
    expect(engine.currentDecision(on.state)).toMatchObject({ kind: 'firstFire', owner: 'ru' });
    // The minefield stays, never reduced by its own attacks (B28.1).
    expect(fortCounters(engine.env(on.state))).toMatchObject([{ hex: 'uN5', mines: { ap: 8 } }]);
  });
});

/** Plays on, passing and ending phases, until `until` holds. */
const playTo = (engine: Eng, s0: GameState, until: (s: GameState) => boolean, dice?: { at: (s: GameState) => boolean; dice: number[] }) => {
  let s = s0;
  let forced = false;
  const events: Ev[] = [];
  for (let i = 0; i < 600 && !until(s); i++) {
    if (dice && !forced && dice.at(s)) {
      engine.forceDice(...dice.dice);
      forced = true;
    }
    const d = engine.currentDecision(s)!;
    const lg = engine.legalActions(s, d.owner);
    const a = lg.find((x) => x.type === 'defPass') ?? lg.find((x) => x.type === 'move.end') ?? lg.find((x) => x.type === 'endPhase') ?? lg[0]!;
    const r = act(engine, s, a);
    events.push(...(r.events as Ev[]));
    s = r.state;
  }
  return { s, events };
};
// The CCPh holds no decision when there is no Close Combat: the dice are queued in the APh, which rolls none here.
const atCcph = (x: GameState) => x.phase === 'APh';
const side = (engine: Eng, s: GameState, hex: string, nb: string) => sideToward(statics(engine.env(s)).map, hex, nb)!;
const drEvent = (events: Ev[]) => events.find((e) => e.type === 'asl.clearance.dr')?.payload as { success?: boolean; casualty?: true; labor?: number; abandoned?: true } | undefined;

describe('Minefield Clearance (B24.74, B24.7, B24.8)', () => {
  it('declared before any stack moves by a squad already in a Known minefield: no MF, no First Fire, TI; a Final DR ≤ 2 at the end of the CCPh places the TB', () => {
    const { engine, state } = game([ge('a', 'uN5'), ru('r', 'uN8'), ...far]);
    let s = place(engine, state, 'ru', [mines('uN5', { ap: 8, known: true })]);
    const k = side(engine, s, 'uN5', 'uO5');
    const k2 = side(engine, s, 'uN5', 'uM5');
    const offered = legal(engine, s, 'clearance.declare');
    expect(offered).toEqual([expect.objectContaining({ kind: 'mines', counter: 'ru.fort1', loc: 'uN5', units: ['a'] })]);
    expect(check(engine, s, { type: 'clearance.declare', kind: 'mines', counter: 'ru.fort1', loc: 'uN5', units: ['a'] })).toMatch(/two hexsides/);
    s = act(engine, s, { type: 'clearance.declare', kind: 'mines', counter: 'ru.fort1', loc: 'uN5', units: ['a'], hexsides: [k, k2] }).state;
    expect(s.pieces['a']!.tags['ti']).toBe(true);
    // No MF, so no First Fire is drawn (Q&A to B24.74): the German has the phase again.
    expect(engine.currentDecision(s)).toMatchObject({ kind: 'phase', owner: 'ge' });
    const { s: end, events } = playTo(engine, s, (x) => x.attacker === 'ru', { at: atCcph, dice: [1, 1] });
    expect(drEvent(events)).toMatchObject({ success: true });
    expect(trailBreaksAt(engine.env(end), 'uN5')).toEqual([[k, k2]]);
    expect(end.pieces['a']!.tags['ti']).toBeUndefined();
    expect(clearanceTasks(engine.env(end))).toEqual([]);
  });

  it('an Original 12 Casualty Reduces the clearing squad (B24.74)', () => {
    const { engine, state } = game([ge('a', 'uN5'), ...far]);
    let s = place(engine, state, 'ru', [mines('uN5', { ap: 8, known: true })]);
    s = act(engine, s, { type: 'clearance.declare', kind: 'mines', counter: 'ru.fort1', loc: 'uN5', units: ['a'], hexsides: [0, 1] }).state;
    const { s: end, events } = playTo(engine, s, (x) => x.attacker === 'ru', { at: atCcph, dice: [6, 6] });
    expect(drEvent(events)).toMatchObject({ success: false, casualty: true });
    expect(end.pieces['a']!.defId).toBe('ge.247');
  });

  it('a stack entering a Known minefield with all its MF to clear it takes no attack, places a partial TB, is TI and stays as a First Fire target for every MF (B24.74; Q&A)', () => {
    const { engine, state } = game([ge('a', 'uO5'), ge('l', 'uO5', 'ge.L91'), ru('r', 'uN8'), ...far]);
    let s = place(engine, state, 'ru', [mines('uN5', { ap: 8, known: true })]);
    s = act(engine, s, { type: 'move.start', units: ['a', 'l'] }).state;
    const variants = legal(engine, s, 'move.step').filter((a) => a['to'] === 'uN5');
    expect(variants.map((a) => a['mines'] ?? 'plain')).toEqual(['plain', 'clear']);
    const k = side(engine, s, 'uN5', 'uO5');
    const r = act(engine, s, { type: 'move.step', to: 'uN5', mines: 'clear' });
    expect(attacks(r.events)).toEqual([]);
    const ms = moveState(engine.env(r.state))!;
    expect(ms.mfHere).toBe(6);
    expect(ms.spent).toEqual({ a: 6, l: 6 });
    expect(r.state.ext['asl.mines.partial']).toEqual({ uN5: [{ side: k, units: ['a', 'l'] }] });
    expect(r.state.pieces['a']!.tags['ti']).toBe(true);
    expect(clearanceTasks(engine.env(r.state))).toEqual([expect.objectContaining({ kind: 'mines', units: ['a'], director: 'l', hexsides: expect.arrayContaining([k]) })]);
    expect(engine.currentDecision(r.state)).toMatchObject({ kind: 'firstFire', owner: 'ru' });
  });

  it('the stack that moved may not clear; a step into a minefield with no TB has no TB variant (B24.74, B28.61)', () => {
    const { engine, state } = game([ge('a', 'uP5'), ...far]);
    let s = place(engine, state, 'ru', [mines('uN5', { ap: 8, known: true })]);
    s = act(engine, s, { type: 'move.start', units: ['a'] }).state;
    s = pass(engine, act(engine, s, { type: 'move.step', to: 'uO5' }).state);
    expect(check(engine, s, { type: 'move.step', to: 'uN5', mines: 'clear' })).toMatch(/entire MF allotment/);
    expect(check(engine, s, { type: 'move.step', to: 'uN5', mines: 'tb' })).toMatch(/No Trail Break/);
  });

  it('across turns: entry to clear, a failed DR (Labor -1), the units leave free only by the hexside they came in by; next turn they clear it and a following stack uses the TB at twice the cost, free of attack, with the -1', () => {
    const { engine, state } = game([ge('a', 'uO5'), ge('b', 'uP5'), ru('r', 'uN8'), ...far]);
    let s = place(engine, state, 'ru', [mines('uN5', { ap: 8, known: true })]);
    const k = side(engine, s, 'uN5', 'uO5');
    const k2 = side(engine, s, 'uN5', 'uM5');
    s = act(engine, s, { type: 'move.start', units: ['a'] }).state;
    s = pass(engine, act(engine, s, { type: 'move.step', to: 'uN5', mines: 'clear', hexsides: [k, k2] }).state);
    // A failure: Labor -1 for the next attempt there (B24.8).
    let r = playTo(engine, s, (x) => x.attacker === 'ru', { at: atCcph, dice: [5, 5] });
    expect(drEvent(r.events)).toMatchObject({ success: false, labor: -1 });
    expect(r.s.ext['asl.mines.partial']).toEqual({ uN5: [{ side: k, units: ['a'] }] });
    r = playTo(engine, r.s, (x) => x.attacker === 'ge' && x.phase === 'MPh' && engine.currentDecision(x)?.kind === 'phase');
    s = r.s;
    expect(s.pieces['a']!.tags['ti']).toBeUndefined();
    // Leaving by another hexside it is attacked (Q&A to B24.74); the partial TB's own hexside is free.
    {
      let t = act(engine, s, { type: 'move.start', units: ['a'] }).state;
      const out = act(engine, t, { type: 'move.step', to: 'uM5' });
      expect(attacks(out.events)).toHaveLength(1);
      t = act(engine, s, { type: 'move.start', units: ['a'] }).state;
      const back = act(engine, t, { type: 'move.step', to: 'uO5' });
      expect(attacks(back.events)).toEqual([]);
      // Gone from the hex: the partial TB goes with it.
      expect(back.state.ext['asl.mines.partial']).toBeUndefined();
    }
    // Instead it stays and clears: the declaration names the partial TB's hexside (B24.74).
    expect(check(engine, s, { type: 'clearance.declare', kind: 'mines', counter: 'ru.fort1', loc: 'uN5', units: ['a'], hexsides: [k2, (k2 + 1) % 6 === k ? (k2 + 2) % 6 : (k2 + 1) % 6] })).toMatch(/partial TB/);
    s = act(engine, s, { type: 'clearance.declare', kind: 'mines', counter: 'ru.fort1', loc: 'uN5', units: ['a'], hexsides: [k, k2] }).state;
    r = playTo(engine, s, (x) => x.attacker === 'ru', { at: atCcph, dice: [1, 2] });
    expect(drEvent(r.events)).toMatchObject({ success: true });
    expect(trailBreaksAt(engine.env(r.s), 'uN5')).toEqual([[k, k2]]);
    expect(r.s.ext['asl.mines.partial']).toBeUndefined();
    r = playTo(engine, r.s, (x) => x.attacker === 'ge' && x.phase === 'MPh' && engine.currentDecision(x)?.kind === 'phase');
    s = r.s;
    expect(clearanceTasks(engine.env(s))).toEqual([]);
    s = act(engine, s, { type: 'move.start', units: ['b'] }).state;
    s = pass(engine, act(engine, s, { type: 'move.step', to: 'uO5' }).state);
    expect(legal(engine, s, 'move.step').filter((a) => a['to'] === 'uN5').map((a) => a['mines'] ?? 'plain')).toEqual(['plain', 'tb']);
    const tb = act(engine, s, { type: 'move.step', to: 'uN5', mines: 'tb' });
    expect(attacks(tb.events)).toEqual([]);
    expect(moveState(engine.env(tb.state))!.spent).toEqual({ b: 3 });
    expect(moveState(engine.env(tb.state))!.tb).toBe(true);
    // Out along the TB: not attacked (B28.61).
    const out = act(engine, pass(engine, tb.state), { type: 'move.step', to: 'uM5' });
    expect(attacks(out.events)).toEqual([]);
  });

  it('into woods by a TB: 1½ MF with the -1, or 3 MF free of attack; declined, the woods cost and no -1 (B13.4212, B28.61 EX)', () => {
    const { engine, state } = game([ge('a', 'uM5'), ...far], { dice: Array(20).fill(6) });
    let s = place(engine, state, 'ru', [mines('uM6', { ap: 8, known: true })]);
    const k = side(engine, s, 'uM6', 'uM5');
    s = act(engine, s, { type: 'test.tbs', hex: 'uM6', tbs: [[k, (k + 3) % 6]] }).state;
    s = act(engine, s, { type: 'move.start', units: ['a'] }).state;
    const plain = act(engine, s, { type: 'move.step', to: 'uM6' });
    expect(moveState(engine.env(plain.state))).toMatchObject({ spent: { a: 1.5 }, tb: true });
    expect(attacks(plain.events)).toHaveLength(1);
    const tb = act(engine, s, { type: 'move.step', to: 'uM6', mines: 'tb' });
    expect(moveState(engine.env(tb.state))).toMatchObject({ spent: { a: 3 }, tb: true });
    expect(attacks(tb.events)).toEqual([]);
    const no = act(engine, s, { type: 'move.step', to: 'uM6', noTb: true });
    expect(moveState(engine.env(no.state))!.spent).toEqual({ a: 2 });
    expect(moveState(engine.env(no.state))!.tb).toBeUndefined();
  });

  it('a TB over every hexside clears the minefield (B24.74)', () => {
    const { engine, state } = game([ge('a', 'uN5'), ...far]);
    let s = place(engine, state, 'ru', [mines('uN5', { ap: 8, known: true })]);
    s = act(engine, s, { type: 'test.tbs', hex: 'uN5', tbs: [[0, 1], [2, 3]] }).state;
    s = act(engine, s, { type: 'clearance.declare', kind: 'mines', counter: 'ru.fort1', loc: 'uN5', units: ['a'], hexsides: [4, 5] }).state;
    const { s: end } = playTo(engine, s, (x) => x.attacker === 'ru', { at: atCcph, dice: [1, 1] });
    expect(fortCounters(engine.env(end))).toEqual([]);
    expect(trailBreaksAt(engine.env(end), 'uN5')).toEqual([]);
  });
});

describe('Vehicles (B28.42, B28.43, B28.5–B28.52, B28.61)', () => {
  const pz = (hex = 'uO5'): PieceSpec => ({ id: 'pz', def: 'ge.pzivf2', side: 'ge', hex, tags: { vca: 3 } });
  const vev = (events: Ev[]) => events.filter((e) => e.type === 'asl.mines.vehicle').map((e) => e.payload as { kind: string; effect: string; dr: number[]; drm?: number; factors?: number });

  it('the Aerial AF of the C7.11 table: the T-50 example (AF 3 → 2), and an AF the table does not print takes the next lower', () => {
    expect(AERIAL_AF[3]).toBe(2);
    expect(aerialAf(3)).toBe(2);
    expect(aerialAf(5)).toBe(3);
    expect(aerialAf(1)).toBe(0);
    expect(aerialAf(11)).toBe(4);
  });

  it('A-P first, then the A-T dr and attack on the 36+ column with the Aerial AF of the lowest hull AF as a DRM: a KIA wrecks it (B28.42, B28.52)', () => {
    // A-P DR 12: no effect (its strength stays hidden). A-T dr 1 ≤ 2: an attack, DR 3+3 +2 (hull AF 3) = 8 on the fixture 36 column: a KIA.
    const { engine, state } = game([pz(), ...far], { dice: [6, 6, 1, 3, 3] });
    let s = place(engine, state, 'ru', [mines('uN5', { ap: 8, at: 2 })]);
    s = act(engine, s, { type: 'vmove.start', vehicle: 'pz' }).state;
    const r = act(engine, s, { type: 'move.step', to: 'uN5' });
    expect(vev(r.events)).toEqual([
      expect.objectContaining({ kind: 'ap', effect: 'none' }),
      expect.objectContaining({ kind: 'atDr', dr: [1], effect: 'attack', factors: 2 }),
      expect.objectContaining({ kind: 'at', dr: [3, 3], drm: 2, effect: 'wreck' }),
    ]);
    expect(r.state.pieces['pz']!.tags['wreck']).toBe(true);
    expect(fortificationView(engine.env(r.state), 'ge')).toMatchObject([{ hex: 'uN5', revealed: true, mines: { at: 2, strengthRevealed: true } }]);
  });

  it('an A-P KIA immobilizes the AFV and cancels the A-T attack; no other result affects it (B28.42)', () => {
    const { engine, state } = game([pz(), ...far], { dice: [1, 1] });
    let s = place(engine, state, 'ru', [mines('uN5', { ap: 8, at: 2 })]);
    s = act(engine, s, { type: 'vmove.start', vehicle: 'pz' }).state;
    const r = act(engine, s, { type: 'move.step', to: 'uN5' });
    expect(vev(r.events)).toEqual([expect.objectContaining({ kind: 'ap', effect: 'immobilized', factors: 8 })]);
    expect(r.state.pieces['pz']!.tags['immob']).toBe(true);
    // Infantry fire's 1MC on the A-P column would have done nothing to it either.
    const two = game([pz(), ...far], { dice: [4, 3, 6] });
    let t = place(two.engine, two.state, 'ru', [mines('uN5', { ap: 8, at: 2 })]);
    t = act(two.engine, t, { type: 'vmove.start', vehicle: 'pz' }).state;
    const q = act(two.engine, t, { type: 'move.step', to: 'uN5' });
    expect(vev(q.events).map((x) => [x.kind, x.effect])).toEqual([['ap', 'none'], ['atDr', 'none']]);
    expect(q.state.pieces['pz']!.tags['immob']).toBeUndefined();
    // Neither the A-P strength nor the A-T factors had to be verified: the Germans see the minefield, nothing of its strength.
    expect(fortificationView(two.engine.env(q.state), 'ge')).toEqual([expect.objectContaining({ hex: 'uN5', revealed: true, mines: {} })]);
  });

  it('a fully-tracked AFV that gets through leaves a partial TB; driving out by another hexside it is attacked, and the TB then runs through the hex (B28.61, B13.421)', () => {
    const { engine, state } = game([pz(), ...far], { dice: [6, 6, 6, 6, 6, 6] });
    let s = place(engine, state, 'ru', [mines('uN5', { ap: 8 })]);
    const k = side(engine, s, 'uN5', 'uO5');
    s = act(engine, s, { type: 'vmove.start', vehicle: 'pz' }).state;
    s = pass(engine, act(engine, s, { type: 'move.step', to: 'uN5' }).state);
    expect(s.ext['asl.mines.partial']).toEqual({ uN5: [{ side: k, vehicle: 'pz' }] });
    const ms = moveState(engine.env(s))!;
    // Back across its own partial TB it is not attacked (Q&A to B28.41 & B28.61 (a), (b)).
    expect(mineExitExempt(engine.env(s), ms, 'uO5', 'pz')).toBe(true);
    const ahead = acrossSide(statics(engine.env(s)).map, 'uN5', (k + 3) % 6)!;
    expect(mineExitExempt(engine.env(s), ms, ahead, 'pz')).toBe(false);
    const out = act(engine, s, { type: 'move.step', to: ahead });
    expect(vev(out.events)).toEqual([expect.objectContaining({ kind: 'ap', effect: 'none' })]);
    const k2 = side(engine, s, 'uN5', ahead);
    expect(trailBreaksAt(engine.env(out.state), 'uN5')).toEqual([[Math.min(k, k2), Math.max(k, k2)]]);
    expect(out.state.ext['asl.mines.partial']).toBeUndefined();
  });

  it('along a TB at twice the MP, free of attack (B28.61; Q&A: 2 MP in Open Ground)', () => {
    const { engine, state } = game([pz(), ...far]);
    let s = place(engine, state, 'ru', [mines('uN5', { ap: 8, at: 3, known: undefined }, false)]);
    s = { ...s };
    const k = side(engine, s, 'uN5', 'uO5');
    s = act(engine, s, { type: 'test.tbs', hex: 'uN5', tbs: [[k, (k + 3) % 6]] }).state;
    s = act(engine, s, { type: 'vmove.start', vehicle: 'pz' }).state;
    const plainCost = engine.env(s).query('move.stepCost', { ms: moveState(engine.env(s))!, to: 'uN5' }, 1);
    const r = act(engine, s, { type: 'move.step', to: 'uN5', mines: 'tb' });
    expect(vev(r.events)).toEqual([]);
    const before = moveState(engine.env(s))!.spent['pz']!;
    expect(moveState(engine.env(r.state))!.spent['pz']! - before).toBe(2 * plainCost);
  });

  it('a TB is one way for vehicles, as a One-Lane bridge: the first sets the direction, one going the other way closes it for the Player Turn; a vehicle on it blocks it; next Player Turn it opens again (B13.4212, B6.431)', () => {
    const probe = game([...far]);
    const map = statics(probe.engine.env(probe.state)).map;
    const k = sideToward(map, 'uN5', 'uO5')!;
    const ahead = acrossSide(map, 'uN5', (k + 3) % 6)!;
    const ahead2 = acrossSide(map, ahead, (k + 3) % 6)!;
    const behind = acrossSide(map, 'uO5', sideToward(map, 'uO5', 'uN5')! + 3)!;
    const vcaIn = 3;
    const { engine, state } = game(
      [
        { id: 'a', def: 'ge.pzivf2', side: 'ge', hex: 'uO5', tags: { vca: vcaIn } },
        { id: 'b', def: 'ge.stug3g', side: 'ge', hex: ahead, tags: { vca: 0 } },
        { id: 'c', def: 'ge.pzivf2', side: 'ge', hex: 'uO5', tags: { vca: vcaIn } },
        ...far,
      ],
      { dice: Array(80).fill(6), ground: { uM6: { terrain: 'open' }, uL4: { terrain: 'open' } } },
    );
    let s = place(engine, state, 'ru', [mines('uN5', { ap: 8, known: true })]);
    s = act(engine, s, { type: 'test.tbs', hex: 'uN5', tbs: [[k, (k + 3) % 6]] }).state;
    const drive = (x: GameState, v: string, path: { to: string; tb?: true }[]) => {
      let y = act(engine, x, { type: 'vmove.start', vehicle: v }).state;
      for (const st of path) {
        const why = check(engine, y, { type: 'move.step', to: st.to, ...(st.tb ? { mines: 'tb' } : {}) });
        if (why) throw new Error(`${v} → ${st.to}: ${why} (${JSON.stringify(moveState(engine.env(y)))})`);
        const rr = act(engine, y, { type: 'move.step', to: st.to, ...(st.tb ? { mines: 'tb' } : {}) });
        y = pass(engine, rr.state);
      }
      for (let i = 0; i < 4 && moveState(engine.env(y)); i++) {
        const lg = engine.legalActions(y, 'ge').map((a) => a.type);
        const t = ['vmove.end', 'move.end', 'vmove.stop'].find((x) => lg.includes(x));
        if (!t) throw new Error(`cannot end: ${lg.join(',')}`);
        y = pass(engine, act(engine, y, { type: t }).state);
      }
      return y;
    };
    // a goes along it westward, through and out: the direction is set.
    s = drive(s, 'a', [{ to: 'uN5', tb: true }, { to: ahead }, { to: ahead2 }]);
    expect(Object.values(s.ext['asl.tb.dir'] as object)).toEqual([{ from: k }]);
    // b goes the other way: allowed, and it closes the TB to vehicles for the rest of the Player Turn.
    s = drive(s, 'b', [{ to: 'uN5', tb: true }, { to: 'uO5' }, { to: behind }]);
    expect(Object.values(s.ext['asl.tb.dir'] as object)).toEqual([{ from: k, closed: true }]);
    let t = act(engine, s, { type: 'vmove.start', vehicle: 'c' }).state;
    expect(check(engine, t, { type: 'move.step', to: 'uN5', mines: 'tb' })).toMatch(/both ways this Player Turn.*B13\.4212/);
    // Next German Player Turn: open again.
    t = playTo(engine, s, (x) => x.attacker === 'ge' && x.turn === 2 && x.phase === 'MPh' && engine.currentDecision(x)?.kind === 'phase').s;
    expect(t.ext['asl.tb.dir']).toBeUndefined();
    t = act(engine, t, { type: 'vmove.start', vehicle: 'c' }).state;
    expect(check(engine, t, { type: 'move.step', to: 'uN5', mines: 'tb' })).toBeNull();
    // c stops on the TB: it blocks any other vehicle until it leaves.
    t = pass(engine, act(engine, t, { type: 'move.step', to: 'uN5', mines: 'tb' }).state);
    for (let i = 0; i < 4 && moveState(engine.env(t)); i++) {
      const lg = engine.legalActions(t, 'ge').map((a) => a.type);
      t = pass(engine, act(engine, t, { type: ['vmove.end', 'move.end', 'vmove.stop'].find((x) => lg.includes(x))! }).state);
    }
    expect(Object.keys(t.ext['asl.tb.on'] as object)).toEqual(['c']);
    expect(tbVehicleIllegal(engine.env(t), 'uN5', [k, (k + 3) % 6], 'a')).toMatch(/c is on the Trail Break/);
    // Not itself.
    expect(tbVehicleIllegal(engine.env(t), 'uN5', [k, (k + 3) % 6], 'c')).toBeNull();
  });

  it('an AFV immobilized by the exit attack stays in the hex it tried to leave (B28.412 EX, D8.1) and is Immobile next turn', () => {
    const { engine, state } = game([pz('uN5'), ...far], { dice: [1, 1, ...Array(40).fill(6)] });
    let s = place(engine, state, 'ru', [mines('uN5', { ap: 8 })]);
    s = act(engine, s, { type: 'vmove.start', vehicle: 'pz' }).state;
    const ahead = acrossSide(statics(engine.env(s)).map, 'uN5', (side(engine, s, 'uN5', 'uO5') + 3) % 6)!;
    s = pass(engine, act(engine, s, { type: 'move.step', to: ahead }).state);
    expect(hexOf(s, 'pz')).toBe('uN5');
    expect(s.pieces['pz']!.tags['immob']).toBe(true);
    const { s: next } = playTo(engine, s, (x) => x.attacker === 'ge' && x.turn === 2 && x.phase === 'MPh' && engine.currentDecision(x)?.kind === 'phase');
    expect(next.pieces['pz']!.tags['immob']).toBe(true);
    expect(legal(engine, next, 'vmove.start').filter((a) => a['vehicle'] === 'pz')).toEqual([]);
  });

  it('Infantry spending one more MF removes open A-T mines at the end of the MPh; pinned during that MF it does not; pinned afterwards it still does (B28.53)', () => {
    const run = (when: 'never' | 'during' | 'after') => {
      const { engine, state } = game([ru('r', 'uM5'), ...far], { first: 'ru' });
      let s = place(engine, state, 'ge', [{ kind: 'mines', hex: 'uM4', hidden: false, mines: { at: 2 } }]);
      s = act(engine, s, { type: 'move.start', units: ['r'] }).state;
      s = pass(engine, act(engine, s, { type: 'move.step', to: 'uM4' }).state);
      expect(legal(engine, s, 'move.removeMines')).toHaveLength(1);
      s = pass(engine, act(engine, s, { type: 'move.removeMines' }).state);
      expect(moveState(engine.env(s))!.spent).toEqual({ r: 2 });
      // Pinned while that MF is the stack's latest expenditure (the DEFENDER's First Fire at it), here simply marked so.
      if (when === 'during') s = tag(engine, s, 'r', { pinned: true });
      // Or the stack goes on, and is pinned later, elsewhere.
      if (when === 'after') {
        s = pass(engine, act(engine, s, { type: 'move.step', to: 'uM5' }).state);
        s = tag(engine, s, 'r', { pinned: true });
      }
      if (engine.legalActions(s, 'ru').some((x) => x.type === 'move.end')) s = pass(engine, act(engine, s, { type: 'move.end' }).state);
      const { s: end } = playTo(engine, s, (x) => x.phase !== 'MPh');
      return { engine, end };
    };
    const ok = run('never');
    expect(fortCounters(ok.engine.env(ok.end))).toEqual([]);
    expect(ok.end.ext['asl.mines.removal']).toBeUndefined();
    const during = run('during');
    expect(fortCounters(during.engine.env(during.end))).toHaveLength(1);
    const after = run('after');
    expect(after.end.pieces['r']!.tags['pinned']).toBe(true);
    expect(fortCounters(after.engine.env(after.end))).toEqual([]);
  });

  it('a unit already pinned may not spend the MF to remove A-T mines, and is told why (B28.53)', () => {
    const { engine, state } = game([ru('r', 'uM5'), ru('q', 'uM5'), ...far], { first: 'ru' });
    let s = place(engine, state, 'ge', [{ kind: 'mines', hex: 'uM4', hidden: false, mines: { at: 2 } }]);
    s = act(engine, s, { type: 'move.start', units: ['r', 'q'] }).state;
    s = pass(engine, act(engine, s, { type: 'move.step', to: 'uM4' }).state);
    s = tag(engine, s, 'q', { pinned: true });
    expect(check(engine, s, { type: 'move.removeMines', units: ['q'] })).toMatch(/q is pinned.*B28\.53/);
    expect(check(engine, s, { type: 'move.removeMines' })).toMatch(/q is pinned/);
    expect(check(engine, s, { type: 'move.removeMines', units: ['r'] })).toBeNull();
  });
});

describe('Known minefield belts (B28.46, B28.47)', () => {
  it('a belt runs along a Hex Grain or one zigzag of an Alternate Hex Grain, its ends inclusive', () => {
    const { engine, state } = game([...far]);
    const env = engine.env(state);
    const map = statics(env).map;
    const k = side(engine, state, 'uN5', 'uO5');
    const o5 = 'uO5';
    const p5 = acrossSide(map, o5, side(engine, state, 'uO5', 'uN5') + 3)!;
    expect(beltHexes(env, { from: 'uN5', to: p5, grain: 'hex' })).toEqual(['uN5', o5, p5]);
    void k;
    expect(beltHexes(env, { from: 'uN5', to: 'uN5', grain: 'hex' })).toBeNull();
    // Two hexes off one grain: no Hex Grain belt, but an Alternate one, left and right zigzags differing in the middle hex.
    const a = 'uN5';
    const b = acrossSide(map, acrossSide(map, a, 0)!, 1)!;
    expect(beltHexes(env, { from: a, to: b, grain: 'hex' })).toBeNull();
    const left = beltHexes(env, { from: a, to: b, grain: 'alt-left' })!;
    const right = beltHexes(env, { from: a, to: b, grain: 'alt-right' })!;
    expect(left).toHaveLength(3);
    expect(right).toHaveLength(3);
    expect(left[1]).not.toBe(right[1]);
  });

  it('every hex of a belt holds one Known minefield record, A-P or none; a hex off the belt cannot claim it', () => {
    const { engine, state } = game([...far]);
    const env = engine.env(state);
    const map = statics(env).map;
    const p5 = acrossSide(map, 'uO5', side(engine, state, 'uO5', 'uN5') + 3)!;
    const belt = { id: 'b1', from: 'uN5', to: p5, grain: 'hex' as const };
    const full: FortPlacement[] = [mines('uN5', { ap: 6, known: true }), mines('uO5', { known: true, dummy: true }), mines(p5, { ap: 8, known: true })].map((c) => ({ ...c, belt: 'b1' }));
    expect(beltsIllegal(env, full, [belt])).toBeNull();
    expect(beltsIllegal(env, full.slice(0, 2), [belt])).toMatch(/record its mines/);
    expect(beltsIllegal(env, [...full, { ...mines('uM5', { ap: 6, known: true }), belt: 'b1' }], [belt])).toMatch(/not on the belt/);
  });

  it('an unmined belt hex found by a unit entering is marked as a Dummy for everyone, not removed (B28.47 EXC)', () => {
    const { engine, state } = game([ge('a', 'uM5'), ...far]);
    let s = place(engine, state, 'ru', [{ ...mines('uN5', { known: true, dummy: true }), belt: 'b1' }]);
    s = act(engine, s, { type: 'move.start', units: ['a'] }).state;
    const r = act(engine, s, { type: 'move.step', to: 'uN5' });
    expect(fortCounters(engine.env(r.state))).toHaveLength(1);
    expect(fortificationView(engine.env(r.state), 'ge')).toMatchObject([{ hex: 'uN5', mines: { known: true, dummy: true, found: true } }]);
    expect(engine.env(r.state).query('rout.avoid', { unit: 'a' }, [])).toEqual([]);
  });
});

describe('Booby Traps (B28.9)', () => {
  const bt = (level: string, side = 'ru') => ({ dice: [] as number[], extra: [boobyTrapsModule], ssr: [{ module: 'booby-traps', params: { side, boards: ['u'], level }, text: 'Booby Traps' }] });
  const traps = (events: Ev[]) => events.filter((e) => e.type === 'asl.boobyTrap').map((e) => e.payload as { level: string; unit: string; dr: number; victims: string[] });

  it('Level C: an enemy PTC of an Original 12 Casualty Reduces a Personnel unit of its Location, by Random Selection, not necessarily the one that took it', () => {
    // PTC DR 6+6; Random Selection dr 2 for a, 5 for b: b, the highest, is Reduced.
    const { engine, state } = game([ge('a', 'uN5'), ge('b', 'uN5'), ...far], { ...bt('C'), dice: [6, 6, 2, 5] });
    const r = act(engine, state, { type: 'test.ptc', unit: 'a' });
    expect(traps(r.events)).toEqual([expect.objectContaining({ level: 'C', unit: 'a', dr: 12, victims: ['b'] })]);
    expect(r.state.pieces['b']!.defId).toBe('ge.247');
  });

  it('an 11 does not trigger Level C, and only an 11 triggers Level B; Level A any ≥ 11', () => {
    const run = (level: string, dice: number[]) => traps(act(game([ge('a', 'uN5'), ...far], { ...bt(level), dice: [...dice, 3] }).engine, game([ge('a', 'uN5'), ...far], { ...bt(level), dice: [...dice, 3] }).state, { type: 'test.ptc', unit: 'a' }).events).length;
    expect(run('C', [5, 6])).toBe(0);
    expect(run('B', [5, 6])).toBe(1);
    expect(run('B', [6, 6])).toBe(0);
    expect(run('A', [6, 6])).toBe(1);
    expect(run('A', [5, 6])).toBe(1);
    expect(run('A', [5, 5])).toBe(0);
  });

  it('the placing side\'s own TC never triggers them', () => {
    const { engine, state } = game([ru('r', 'uN5'), ...far], { ...bt('A'), dice: [6, 6] });
    expect(traps(act(engine, state, { type: 'test.ptc', unit: 'r' }).events)).toEqual([]);
  });

  it('a broken unit, normally immune to a PTC, takes it for the Booby Trap only', () => {
    const { engine, state } = game([{ ...ge('a', 'uN5'), tags: { broken: true } }, ...far], { ...bt('C'), dice: [6, 6, 4] });
    const r = act(engine, state, { type: 'test.ptc', unit: 'a' });
    expect(r.events.some((e) => e.type === 'asl.boobyTrap.ptc')).toBe(true);
    expect(traps(r.events)).toEqual([expect.objectContaining({ victims: ['a'] })]);
    expect(r.state.pieces['a']!.defId).toBe('ge.247');
    // Without Booby Traps nothing is rolled at all.
    const plain = game([{ ...ge('a', 'uN5'), tags: { broken: true } }, ...far]);
    expect(act(plain.engine, plain.state, { type: 'test.ptc', unit: 'a' }).events.some((e) => e.type === 'dice.rolled')).toBe(false);
  });
});

void tag;
