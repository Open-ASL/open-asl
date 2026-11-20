import { describe, expect, it } from 'vitest';
import type { Action, Engine, GameState, RuleModule } from '@asl/engine';
import { TAG_LIFECYCLE, aslCoreModules, fortCounters, moveState, piecesModule, redactState, stackedOn, turnModule, type FortPlacement, type HexTerrainSpec } from '../../src';
import { planRout } from '../../src/sk1/rout';
import { sk1CoreModules } from '../../src/sk1';
import { sk2CoreModules } from '../../src/sk2';
import { sk3CoreModules } from '../../src/sk3';
import { act, makeEngine, type PieceSpec } from '../fixtures';

/*
 * Wire in play (ASLRB B26, A4.61, A12.33, D8.21): units entering a Wire Location stand on top of it, the Wire Exit dr that
 * takes them beneath (one per unit, its own MF, hung up when it exceeds the MF left), what a unit on top may not do, the
 * +1 to attacks from on top and the -1 in CC against it, the dr in the RtPh and Failure to Rout, a Placed DC's Original
 * KIA, and vehicles. The ground is a stretch of board u: L4 and M6 woods, M4 a paved road, everything else Open Ground.
 */

const SK: RuleModule[] = [piecesModule, turnModule, ...sk1CoreModules, ...sk2CoreModules, ...sk3CoreModules];
const ASL: RuleModule[] = [...SK, ...aslCoreModules];
const GROUND: Record<string, HexTerrainSpec> = {
  uL4: { terrain: 'woods' },
  uM4: { terrain: 'open', features: ['road:paved'] },
  uM6: { terrain: 'woods' },
};

const testModule: RuleModule = {
  id: 'test.wire',
  install(r) {
    r.action<Action & { fortSide: string; counters: FortPlacement[] }>({
      type: 'test.fortPlace',
      decisionKinds: ['phase', 'firstFire'],
      resolve(ctx, a) {
        const n = fortCounters(ctx).length;
        ctx.emit('asl.fort.placed', { side: a.fortSide, counters: a.counters.map((c, i) => ({ ...c, id: `${a.fortSide}.fort${n + i + 1}`, side: a.fortSide })) });
      },
    });
    r.action<Action & { id: string; hex: string; wire?: 'on' | 'beneath' }>({
      type: 'test.teleport',
      decisionKinds: ['phase'],
      resolve(ctx, a) {
        ctx.emit('piece.moved', { id: a.id, loc: { kind: 'hex', hex: a.hex, ...(a.wire ? { pos: { wire: a.wire } } : {}) } });
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

function game(pieces: PieceSpec[], opts: { dice?: number[]; phase?: string; first?: 'ge' | 'ru' } = {}) {
  const scenario = {
    firstSide: opts.first ?? 'ge',
    sides: [
      { side: 'ge', name: 'German', nationality: 'ge', elr: 3 },
      { side: 'ru', name: 'Russian', nationality: 'ru', elr: 3 },
    ],
    forces: [],
  };
  return makeEngine({ board: 'u', terrain: GROUND, roadHexsides: [['uM4', 'uM5']], scenario, modules: ASL, extra: [testModule], pieces, startPhase: opts.phase ?? 'MPh', dice: opts.dice ?? [] });
}
type Eng = Engine;
const wire = (hex: string, hidden = false): FortPlacement => ({ kind: 'wire', hex, hidden });
const place = (engine: Eng, state: GameState, fortSide: string, counters: FortPlacement[]) => act(engine, state, { type: 'test.fortPlace', fortSide, counters }).state;
const tele = (engine: Eng, state: GameState, id: string, hex: string, w?: 'on' | 'beneath') => act(engine, state, { type: 'test.teleport', id, hex, ...(w ? { wire: w } : {}) }).state;
const tag = (engine: Eng, state: GameState, id: string, tags: Record<string, unknown>) => act(engine, state, { type: 'test.tag', id, tags }).state;
const check = (engine: Eng, state: GameState, a: Record<string, unknown>) => {
  const d = engine.currentDecision(state)!;
  return engine.validate(state, { side: d.owner, decisionId: d.id, ...a } as never);
};
const legal = (engine: Eng, s: GameState, type: string) => engine.legalActions(s, engine.currentDecision(s)!.owner).filter((a) => a.type === type);
const pos = (s: GameState, id: string) => (s.pieces[id]!.loc as { pos?: { wire?: string } }).pos?.wire;
const pass = (engine: Eng, s: GameState, side: string) => {
  let x = s;
  while (engine.currentDecision(x)?.owner === side && engine.currentDecision(x)?.kind === 'firstFire') x = act(engine, x, { type: 'defPass' }).state;
  return x;
};
const ge = (id: string, hex: string, def = 'ge.467'): PieceSpec => ({ id, def, side: 'ge', hex });
const ru = (id: string, hex: string, def = 'ru.447'): PieceSpec => ({ id, def, side: 'ru', hex });
const far = [ge('gfar', 'uGG1'), ru('rfar', 'uA1')];
const labels = (events: { type: string; payload: unknown }[], type = 'sk1.fire.attack') => ((events.find((e) => e.type === type)?.payload as { explain?: { label?: string }[] } | undefined)?.explain ?? []).map((n) => n.label ?? '');
const unitLabels = (events: { type: string; payload: unknown }[], unit: string) =>
  ((events.find((e) => e.type === 'sk1.fire.result' && (e.payload as { unit: string }).unit === unit)?.payload as { explain?: { label?: string }[] } | undefined)?.explain ?? []).map((n) => n.label ?? '');
const exitEvent = (events: { type: string; payload: unknown }[]) => events.find((e) => e.type === 'asl.wire.exit')?.payload as { units: { unit: string; dr: number; mf: number; outcome: string }[]; phase: string } | undefined;

describe('Entering a Wire Location (B26.4, B26.3, B26.32)', () => {
  it('a stack entering the Wire hex pays only the COT and stands on top, in the MPh', () => {
    const { engine, state } = game([ge('a', 'uO5'), ge('b', 'uO5'), ru('r', 'uN9'), ...far]);
    let s = place(engine, state, 'ru', [wire('uN5')]);
    s = act(engine, s, { type: 'move.start', units: ['a', 'b'] }).state;
    s = act(engine, s, { type: 'move.step', to: 'uN5' }).state;
    expect(moveState(engine.env(s))!.spent).toEqual({ a: 1, b: 1 });
    expect([pos(s, 'a'), pos(s, 'b')]).toEqual(['on', 'on']);
    // Both are one Location with a unit beneath: stacking and targets are per Location (B26.32).
    expect(engine.currentDecision(s)).toMatchObject({ kind: 'firstFire', data: { hex: 'uN5', units: ['a', 'b'] } });
  });

  it('an advance into the Wire hex arrives on top; no advance goes beneath the Wire (B26.4)', () => {
    const { engine, state } = game([ge('a', 'uO5'), ...far], { phase: 'APh' });
    const s = place(engine, state, 'ru', [wire('uN5')]);
    const r = act(engine, s, { type: 'advance', units: ['a'], to: 'uN5' });
    expect(pos(r.state, 'a')).toBe('on');
  });

  it('a unit entering the other side\'s hidden Wire knows nothing of it and passes freely; its own hidden Wire costs nothing (A12.33)', () => {
    const { engine, state } = game([{ ...ru('b', 'uO5'), tags: { broken: true, dm: true } }, ge('g', 'uR5'), ...far], { phase: 'RtPh', first: 'ru' });
    // A broken German stack never reveals it; here the Russian router enters German hidden Wire.
    let s = place(engine, state, 'ge', [wire('uN5', true)]);
    s = act(engine, s, { type: 'rout.step', unit: 'b', to: 'uN5' }).state;
    expect(pos(s, 'b')).toBeUndefined();
    // Its own hidden Wire: a stack entering is beneath at once, nothing seen by the other side.
    // (In woods, Concealment Terrain, beyond 16 hexes of every German: still hidden.)
    const own = game([ru('r', 'uM5'), ...far], { first: 'ru' });
    let o = place(own.engine, own.state, 'ru', [wire('uM6', true)]);
    o = act(own.engine, o, { type: 'move.start', units: ['r'] }).state;
    o = act(own.engine, o, { type: 'move.step', to: 'uM6' }).state;
    expect(pos(o, 'r')).toBe('beneath');
    expect((redactState(own.engine, o, 'ge').pieces['r']!.loc as { pos?: unknown }).pos).toBeUndefined();
  });
});

describe('The Wire Exit dr in the MPh (B26.4, A4.61, A8.12)', () => {
  it('each unit rolls and spends its own dr, goes beneath, and the DEFENDER sees the drs before his First Fire question', () => {
    const { engine, state } = game([ge('a', 'uN5'), ge('b', 'uN5'), ru('r', 'uN9'), ...far], { dice: [2, 4] });
    let s = place(engine, state, 'ru', [wire('uN5')]);
    s = tele(engine, s, 'a', 'uN5', 'on');
    s = tele(engine, s, 'b', 'uN5', 'on');
    s = act(engine, s, { type: 'move.start', units: ['a', 'b'] }).state;
    expect(check(engine, s, { type: 'move.step', to: 'uO5' })).toMatch(/on top of the Wire in uN5: get beneath it first/);
    expect(legal(engine, s, 'move.wire')).toHaveLength(1);
    const r = act(engine, s, { type: 'move.wire' });
    expect(exitEvent(r.events)!.units).toEqual([
      { unit: 'a', dr: 2, mf: 2, outcome: 'beneath' },
      { unit: 'b', dr: 4, mf: 4, outcome: 'beneath' },
    ]);
    expect([pos(r.state, 'a'), pos(r.state, 'b')]).toEqual(['beneath', 'beneath']);
    const ms = moveState(engine.env(r.state))!;
    // The squad that rolled 4 used all its MF: finished there, still a First Fire target with the stack (A8.12).
    expect(ms.spent).toMatchObject({ a: 2, b: 4 });
    expect(ms.units).toEqual(['a']);
    expect(ms.stopped).toEqual(['b']);
    expect(ms.mfHere).toBe(4);
    const types = r.events.map((e) => e.type);
    expect(types.indexOf('asl.wire.exit')).toBeLessThan(types.lastIndexOf('decision.pushed'));
    expect(engine.currentDecision(r.state)).toMatchObject({ kind: 'firstFire', owner: 'ru', data: { units: ['a', 'b'] } });
    // FFMO in Open Ground and FFNAM, the Wire adding no TEM (B26.3, B26.4).
    const f = act(engine, r.state, { type: 'defFire', decl: { units: ['r'], sw: [], target: 'uN5' } });
    expect(labels(f.events)).toEqual(expect.arrayContaining(['-1 FFMO', '-1 FFNAM']));
    // The squad beneath with 2 MF left steps back the way it came.
    const back = pass(engine, f.state, 'ru');
    expect(check(engine, back, { type: 'move.step', to: 'uO5' })).toBeNull();
  });

  it('a dr above the MF left uses the rest and hangs the unit up on top; it is left behind and fired on with FFNAM (B26.4)', () => {
    const { engine, state } = game([ge('a', 'uO5'), ge('b', 'uO5'), ru('r', 'uN9'), ...far], { dice: [3, 1] });
    let s = place(engine, state, 'ru', [wire('uN5')]);
    s = act(engine, s, { type: 'move.start', units: ['a', 'b'] }).state;
    s = pass(engine, act(engine, s, { type: 'move.step', to: 'uN5' }).state, 'ru');
    // 3 MF left each: a rolls 3 (beneath, none left), b rolls 1 (beneath, 2 left).
    let r = act(engine, s, { type: 'move.wire' });
    expect(exitEvent(r.events)!.units.map((u) => u.outcome)).toEqual(['beneath', 'beneath']);
    const hung = game([ge('a', 'uO5'), ru('r', 'uN9'), ...far], { dice: [6] });
    let h = place(hung.engine, hung.state, 'ru', [wire('uN5')]);
    h = act(hung.engine, h, { type: 'move.start', units: ['a'] }).state;
    h = pass(hung.engine, act(hung.engine, h, { type: 'move.step', to: 'uN5' }).state, 'ru');
    r = act(hung.engine, h, { type: 'move.wire' });
    expect(exitEvent(r.events)!.units).toEqual([{ unit: 'a', dr: 6, mf: 3, outcome: 'hung' }]);
    expect(pos(r.state, 'a')).toBe('on');
    expect(r.state.pieces['a']!.tags['moved']).toBe(true);
    expect(moveState(hung.engine.env(r.state))).toMatchObject({ units: [], stopped: ['a'], halted: true });
    const f = act(hung.engine, r.state, { type: 'defFire', decl: { units: ['r'], sw: [], target: 'uN5' } });
    expect(labels(f.events)).toEqual(expect.arrayContaining(['-1 FFNAM']));
  });

  it('the rest of the stack goes on without the unit hung up (B26.4)', () => {
    const { engine, state } = game([ge('a', 'uN5'), ge('b', 'uN5'), ...far], { dice: [5, 1] });
    let s = place(engine, state, 'ru', [wire('uN5')]);
    s = tele(engine, s, 'a', 'uN5', 'on');
    s = tele(engine, s, 'b', 'uN5', 'on');
    s = act(engine, s, { type: 'move.start', units: ['a', 'b'] }).state;
    s = act(engine, s, { type: 'move.wire' }).state;
    // a rolled 5 with 4 MF: hung; b rolled 1: beneath with 3 MF.
    expect(moveState(engine.env(s))).toMatchObject({ units: ['b'], stopped: ['a'] });
    s = act(engine, s, { type: 'move.step', to: 'uO5' }).state;
    expect(s.pieces['a']!.loc).toEqual({ kind: 'hex', hex: 'uN5', pos: { wire: 'on' } });
    expect(s.pieces['b']!.loc).toEqual({ kind: 'hex', hex: 'uO5' });
    expect(moveState(engine.env(s))!.stopped).toBeUndefined();
  });

  it('a leader moving with the squad gives it the MF bonus for its dr, but no leadership DRM: the dr is ∆ (B26.4, A.10)', () => {
    const { engine, state } = game([ge('a', 'uN5'), ge('l', 'uN5', 'ge.L91'), ...far], { dice: [5, 2] });
    let s = place(engine, state, 'ru', [wire('uN5')]);
    s = tele(engine, s, 'a', 'uN5', 'on');
    s = tele(engine, s, 'l', 'uN5', 'on');
    s = act(engine, s, { type: 'move.start', units: ['a', 'l'] }).state;
    const r = act(engine, s, { type: 'move.wire' });
    expect(exitEvent(r.events)!.units).toEqual([
      { unit: 'a', dr: 5, mf: 5, outcome: 'beneath' },
      { unit: 'l', dr: 2, mf: 2, outcome: 'beneath' },
    ]);
  });

  it('an Assault Moving unit whose dr uses all its MF loses Assault Movement and takes FFNAM; its partner moves on Assault Moving (B26.4, A4.61)', () => {
    const { engine, state } = game([ge('a', 'uN5'), ge('b', 'uN5'), ru('r', 'uN9'), ...far], { dice: [4, 1] });
    let s = place(engine, state, 'ru', [wire('uN5')]);
    s = tele(engine, s, 'a', 'uN5', 'on');
    s = tele(engine, s, 'b', 'uN5', 'on');
    s = act(engine, s, { type: 'move.start', units: ['a', 'b'], assault: true }).state;
    const r = act(engine, s, { type: 'move.wire' });
    const ms = moveState(engine.env(r.state))!;
    expect(ms).toMatchObject({ assault: true, units: ['b'], stopped: ['a'], assaultVoided: ['a'] });
    const f = act(engine, r.state, { type: 'defFire', decl: { units: ['r'], sw: [], target: 'uN5' } });
    expect(labels(f.events)).not.toContain('-1 FFNAM');
    expect(unitLabels(f.events, 'a')).toContain('-1 FFNAM (Assault Movement voided by its Wire Exit dr)');
    expect(unitLabels(f.events, 'b')).not.toContain('-1 FFNAM (Assault Movement voided by its Wire Exit dr)');
    // b moves on, one hex, still Assault Moving.
    const on = pass(engine, f.state, 'ru');
    expect(check(engine, on, { type: 'move.step', to: 'uO5' })).toBeNull();
  });

  it('no dr under Double Time (B26.46, A4.5); a stack CX from an earlier turn may roll', () => {
    const { engine, state } = game([ge('a', 'uN5'), ...far]);
    let s = place(engine, state, 'ru', [wire('uN5')]);
    s = tele(engine, s, 'a', 'uN5', 'on');
    const dt = act(engine, s, { type: 'move.start', units: ['a'], doubleTime: true }).state;
    expect(check(engine, dt, { type: 'move.wire' })).toMatch(/B26.46/);
    expect(legal(engine, dt, 'move.wire')).toEqual([]);
    const cx = act(engine, tag(engine, s, 'a', { cx: true }), { type: 'move.start', units: ['a'] }).state;
    expect(check(engine, cx, { type: 'move.wire' })).toBeNull();
  });

  it('a unit that started the turn on the Wire may leave excess PP on top after its dr (B26.4)', () => {
    // A 4-6-7 with an MMG (4 PP) and a LMG (1 PP): 5 PP, IPC 3, so 2 MF. It rolls 3.
    const { engine, state } = game([ge('a', 'uN5'), { id: 'mmg', def: 'ge.MMG', side: 'ge', heldBy: 'a' }, { id: 'lmg', def: 'ge.LMG', side: 'ge', heldBy: 'a' }, ...far], { dice: [3] });
    let s = place(engine, state, 'ru', [wire('uN5')]);
    s = tele(engine, s, 'a', 'uN5', 'on');
    s = act(engine, s, { type: 'move.start', units: ['a'] }).state;
    expect(moveState(engine.env(s))!.allowance['a']).toBe(2);
    const r = act(engine, s, { type: 'move.wire' });
    expect(engine.currentDecision(r.state)).toMatchObject({ kind: 'wireDrop', owner: 'ge', data: { unit: 'a', dr: 3, mf: 2 } });
    expect(legal(engine, r.state, 'wire.drop')).toEqual([expect.objectContaining({ sw: ['mmg'] })]);
    const kept = act(engine, r.state, { type: 'wire.keep', unit: 'a' });
    expect(exitEvent(kept.events)!.units).toEqual([{ unit: 'a', dr: 3, mf: 2, outcome: 'hung' }]);
    const dropped = act(engine, r.state, { type: 'wire.drop', unit: 'a', sw: ['mmg'] });
    expect(exitEvent(dropped.events)!.units).toEqual([{ unit: 'a', dr: 3, mf: 3, outcome: 'beneath' }]);
    expect(dropped.state.pieces['mmg']!.loc).toEqual({ kind: 'hex', hex: 'uN5', pos: { wire: 'on' } });
    // A unit that entered the Wire this MPh is not offered the drop.
    const fresh = game([ge('a', 'uO5'), { id: 'mmg', def: 'ge.MMG', side: 'ge', heldBy: 'a' }, { id: 'lmg', def: 'ge.LMG', side: 'ge', heldBy: 'a' }, ...far], { dice: [1] });
    let f = place(fresh.engine, fresh.state, 'ru', [wire('uN5')]);
    f = act(fresh.engine, f, { type: 'move.start', units: ['a'] }).state;
    f = act(fresh.engine, f, { type: 'move.step', to: 'uN5' }).state;
    const fr = act(fresh.engine, f, { type: 'move.wire' });
    expect(fresh.engine.currentDecision(fr.state)?.kind).not.toBe('wireDrop');
    expect(exitEvent(fr.events)!.units).toEqual([{ unit: 'a', dr: 1, mf: 1, outcome: 'beneath' }]);
  });

  it('a unit on its own hidden Wire goes beneath for no MF and no dr, unseen by the other side (A12.33)', () => {
    const { engine, state } = game([ru('r', 'uM6'), ...far], { first: 'ru' });
    let s = place(engine, state, 'ru', [wire('uM6', true)]);
    s = tele(engine, s, 'r', 'uM6', 'on');
    s = act(engine, s, { type: 'move.start', units: ['r'] }).state;
    // Going beneath is still its Wire Exit, made before it leaves (Q&A [K33] to A12.33) ...
    expect(check(engine, s, { type: 'move.step', to: 'uM5' })).toMatch(/on top of the Wire/);
    // ... for nothing.
    const r = act(engine, s, { type: 'move.wire' });
    expect(exitEvent(r.events)).toMatchObject({ units: [{ unit: 'r', dr: 0, mf: 0, outcome: 'beneath' }] });
    expect(moveState(engine.env(r.state))!.spent['r']).toBe(0);
    expect(r.events.some((e) => e.type.startsWith('dice'))).toBe(false);
    expect(check(engine, r.state, { type: 'move.step', to: 'uM5' })).toBeNull();
  });

  it('the non-MF restrictions apply to hidden Wire: no CX unit crosses it, none gets beneath it in the APh (B26.46, B26.4; Q&A [K33] to A12.33)', () => {
    // Double Time: a stack entering its own hidden Wire stays on top, may not get beneath, and so may not go on.
    const dt = game([ru('r', 'uM5'), ...far], { first: 'ru' });
    let s = place(dt.engine, dt.state, 'ru', [wire('uM6', true)]);
    s = act(dt.engine, s, { type: 'move.start', units: ['r'], doubleTime: true }).state;
    s = act(dt.engine, s, { type: 'move.step', to: 'uM6' }).state;
    expect(pos(s, 'r')).toBe('on');
    expect(check(dt.engine, s, { type: 'move.wire' })).toMatch(/Double Time/);
    expect(check(dt.engine, s, { type: 'move.step', to: 'uM7' })).toMatch(/on top of the Wire/);
    // Still hidden from the other side, position and all.
    expect((redactState(dt.engine, s, 'ge').pieces['r']!.loc as { pos?: unknown }).pos).toBeUndefined();
    // Without Double Time the same step is beneath at once.
    const go = game([ru('r', 'uM5'), ...far], { first: 'ru' });
    let g = place(go.engine, go.state, 'ru', [wire('uM6', true)]);
    g = act(go.engine, g, { type: 'move.start', units: ['r'] }).state;
    g = act(go.engine, g, { type: 'move.step', to: 'uM6' }).state;
    expect(pos(g, 'r')).toBe('beneath');
    // An advance onto it stays on top (no unit gets beneath Wire in the APh).
    const ap = game([ru('r', 'uM5'), ...far], { first: 'ru', phase: 'APh' });
    const a = act(ap.engine, place(ap.engine, ap.state, 'ru', [wire('uM6', true)]), { type: 'advance', units: ['r'], to: 'uM6' });
    expect(pos(a.state, 'r')).toBe('on');
  });
});

describe('On top of the Wire (B26.4, B26.31, B26.45)', () => {
  it('+1 to every attack a unit on top makes; a Fire Group with one unit on top takes it once (B26.31)', () => {
    const { engine, state } = game([ge('a', 'uN5'), ge('b', 'uN5'), ru('r', 'uN8'), ...far], { phase: 'PFPh' });
    let s = place(engine, state, 'ru', [wire('uN5')]);
    s = tele(engine, s, 'a', 'uN5', 'on');
    s = tele(engine, s, 'b', 'uN5', 'beneath');
    const fg = act(engine, s, { type: 'fire', decl: { units: ['a', 'b'], sw: [], target: 'uN8' } });
    expect(labels(fg.events).filter((l) => l === '+1 firer on Wire')).toHaveLength(1);
    const beneath = act(engine, s, { type: 'fire', decl: { units: ['b'], sw: [], target: 'uN8' } });
    expect(labels(beneath.events)).not.toContain('+1 firer on Wire');
  });

  it('a unit on top cannot Place a DC; beneath it can (B26.45)', () => {
    const { engine, state } = game([ge('a', 'uN5'), { id: 'dc', def: 'ge.DC', side: 'ge', heldBy: 'a' }, ru('r', 'uN6'), ...far]);
    let s = place(engine, state, 'ru', [wire('uN5')]);
    s = tele(engine, s, 'a', 'uN5', 'on');
    const top = act(engine, s, { type: 'move.start', units: ['a'] }).state;
    expect(check(engine, top, { type: 'move.placeDc', dc: 'dc', target: 'uN6' })).toMatch(/B26.45/);
    const ben = act(engine, tele(engine, s, 'a', 'uN5', 'beneath'), { type: 'move.start', units: ['a'] }).state;
    expect(check(engine, ben, { type: 'move.placeDc', dc: 'dc', target: 'uN6' })).toBeNull();
  });

  it('a unit on top cannot advance out of the Wire Location; one beneath advances freely (B26.4)', () => {
    const { engine, state } = game([ge('a', 'uN5'), ge('b', 'uN5'), ru('r', 'uN9'), ...far], { phase: 'APh' });
    let s = place(engine, state, 'ru', [wire('uN5')]);
    s = tele(engine, s, 'a', 'uN5', 'on');
    s = tele(engine, s, 'b', 'uN5', 'beneath');
    expect(check(engine, s, { type: 'advance', units: ['a'], to: 'uO5' })).toMatch(/a is on top of the Wire: no advance out of the Wire Location/);
    expect(check(engine, s, { type: 'advance', units: ['a', 'b'], to: 'uO5' })).toMatch(/on top of the Wire/);
    expect(legal(engine, s, 'advance').some((a) => (a as unknown as { units: string[] }).units.includes('a'))).toBe(false);
    // The unit beneath goes; the one on top stays there, and the turn plays on.
    s = act(engine, s, { type: 'advance', units: ['b'], to: 'uO5' }).state;
    expect(s.pieces['b']!.loc).toEqual({ kind: 'hex', hex: 'uO5' });
    expect(pos(s, 'a')).toBe('on');
    s = act(engine, s, { type: 'endPhase' }).state;
    // No Close Combat anywhere: on to the next Player Turn.
    expect(s.phase).toBe('RPh');
    expect(s.pieces['a']!.loc).toEqual({ kind: 'hex', hex: 'uN5', pos: { wire: 'on' } });
  });

  it('a weapon on top cannot be Recovered from beneath, nor one beneath from on top (B26.4, A4.44)', () => {
    const { engine, state } = game([ge('a', 'uN5'), { id: 'lmg', def: 'ge.LMG', side: 'ge', hex: 'uN5' }, ...far]);
    let s = place(engine, state, 'ru', [wire('uN5')]);
    s = act(engine, s, { type: 'test.teleport', id: 'lmg', hex: 'uN5', wire: 'on' }).state;
    s = tele(engine, s, 'a', 'uN5', 'beneath');
    const b = act(engine, s, { type: 'move.start', units: ['a'] }).state;
    expect(check(engine, b, { type: 'move.recover', unit: 'a', sw: 'lmg' })).toMatch(/lies on top of the Wire/);
    const t = act(engine, tele(engine, s, 'a', 'uN5', 'on'), { type: 'move.start', units: ['a'] }).state;
    expect(check(engine, t, { type: 'move.recover', unit: 'a', sw: 'lmg' })).toBeNull();
  });

  it('CC: +1 for an attacker on top, -1 against each defender on top (B26.31)', () => {
    const { engine, state } = game([ge('a', 'uN5'), ru('r', 'uN5'), ru('r2', 'uN5'), ...far], { phase: 'PFPh' });
    let s = place(engine, state, 'ru', [wire('uN5')]);
    s = tele(engine, s, 'a', 'uN5', 'on');
    s = tele(engine, s, 'r', 'uN5', 'on');
    s = tele(engine, s, 'r2', 'uN5', 'beneath');
    const env = engine.env(s);
    expect(env.query('cc.drm', { hex: 'uN5', attackers: ['a'], targets: ['r', 'r2'], side: 'ge' }, 0)).toBe(1);
    expect(env.query('cc.targetDrm', { hex: 'uN5', attackers: ['a'], targets: ['r', 'r2'], side: 'ge', target: 'r' }, 0)).toBe(-1);
    expect(env.query('cc.targetDrm', { hex: 'uN5', attackers: ['a'], targets: ['r', 'r2'], side: 'ge', target: 'r2' }, 0)).toBe(0);
  });

  it('the +1 from on top is a positive DRM from outside the target Location: it lowers the Residual FP left (A8.26)', () => {
    const { engine, state } = game([ge('a', 'uN5'), ...far]);
    const env = engine.env(place(engine, state, 'ru', [wire('uN5')]));
    expect(env.query('fire.residualOutside', { attack: { mode: 'first', side: 'ge', target: 'uO5', parts: [], targets: [], hindrance: 0 } }, ['sk1.drm.cx'])).toEqual(['sk1.drm.cx', 'asl.wire.firer']);
  });
});

describe('Rout over Wire (B26.41, A10.5, A10.53)', () => {
  it('a broken unit on top rolls, spends the dr from its rout MF, goes beneath and routs on to the woods', () => {
    const { engine, state } = game([{ ...ru('b', 'uN5'), tags: { broken: true, dm: true } }, ge('g', 'uR5'), ...far], { phase: 'RtPh', first: 'ru', dice: [2] });
    let s = place(engine, state, 'ge', [wire('uN5')]);
    s = tele(engine, s, 'b', 'uN5', 'on');
    expect(check(engine, s, { type: 'rout.step', unit: 'b', to: 'uM6' })).toMatch(/Wire Exit dr comes first/);
    expect(legal(engine, s, 'rout.wire')).toEqual([expect.objectContaining({ unit: 'b' })]);
    const r = act(engine, s, { type: 'rout.wire', unit: 'b' });
    expect(exitEvent(r.events)).toMatchObject({ phase: 'RtPh', units: [{ unit: 'b', dr: 2, mf: 2, outcome: 'beneath' }] });
    expect(pos(r.state, 'b')).toBe('beneath');
    const on = act(engine, r.state, { type: 'rout.step', unit: 'b', to: 'uM6' });
    expect(on.state.pieces['b']!.loc).toEqual({ kind: 'hex', hex: 'uM6' });
  });

  it('the nearest shelter counts getting beneath Wire as one MF: on top at the start, and on the way; not beneath, not unknown (A10.51, A10.531; Q&A to A10.51 & B26)', () => {
    const run = (w: 'on' | 'beneath' | null, hidden = false) => {
      const { engine, state } = game([{ ...ru('b', 'uN5'), tags: { broken: true, dm: true } }, ge('g', 'uR5'), ...far], { phase: 'RtPh', first: 'ru' });
      let s = w || hidden ? place(engine, state, 'ge', [wire('uN5', hidden)]) : state;
      if (w) s = tele(engine, s, 'b', 'uN5', w);
      return planRout(engine.env(s), 'b').cost;
    };
    const bare = run(null);
    const top = run('on');
    expect(top.get('uM6')).toBe(bare.get('uM6')! + 1);
    expect(run('beneath').get('uM6')).toBe(bare.get('uM6'));
    // Hidden Wire of the other side is not known to the router: it does not enter the count.
    expect(run(null, true).get('uM6')).toBe(bare.get('uM6'));
    // On the way: a router from O5 through the Wire of N5 counts one more MF beyond it than its COT.
    const via = (wired: boolean) => {
      const { engine, state } = game([{ ...ru('b', 'uO5'), tags: { broken: true, dm: true } }, ge('g', 'uR5'), ...far], { phase: 'RtPh', first: 'ru' });
      const s = wired ? place(engine, state, 'ge', [wire('uN5')]) : state;
      return planRout(engine.env(s), 'b').cost;
    };
    expect(via(true).get('uN5')).toBe(via(false).get('uN5'));
  });

  it('a rout that begins with the Wire Exit dr may take a Good Order leader stacked with it (A10.711); each on top rolls its own dr', () => {
    const { engine, state } = game([{ ...ru('b', 'uN5'), tags: { broken: true, dm: true } }, ru('l', 'uN5', 'ru.L91'), ge('g', 'uR5'), ...far], { phase: 'RtPh', first: 'ru', dice: [2, 1] });
    let s = place(engine, state, 'ge', [wire('uN5')]);
    s = tele(engine, s, 'b', 'uN5', 'on');
    s = tele(engine, s, 'l', 'uN5', 'on');
    expect(legal(engine, s, 'rout.wire')).toContainEqual(expect.objectContaining({ unit: 'b', leaders: ['l'] }));
    expect(check(engine, s, { type: 'rout.wire', unit: 'b', leaders: ['gfar'] })).toMatch(/cannot rout with the unit.*A10.711/);
    const r = act(engine, s, { type: 'rout.wire', unit: 'b', leaders: ['l'] });
    expect(exitEvent(r.events)).toMatchObject({ phase: 'RtPh', units: [{ unit: 'b', dr: 2, outcome: 'beneath' }, { unit: 'l', dr: 1, outcome: 'beneath' }] });
    const on = act(engine, r.state, { type: 'rout.step', unit: 'b', to: 'uM6' });
    expect(on.state.pieces['b']!.loc).toEqual({ kind: 'hex', hex: 'uM6' });
    expect(on.state.pieces['l']!.loc).toEqual({ kind: 'hex', hex: 'uM6' });
  });

  it('an escorting leader hung up on the Wire stays there and the broken unit routs on without him; into the next Player Turn neither is stuck and no rout record is left (A10.711, B26.4, B26.41)', () => {
    // b routs from O5 into the Wire of N5 with the leader l (1 MF, 5 left); b's dr 2 takes it beneath, l's 6 hangs him up.
    const { engine, state } = game([{ ...ru('b', 'uO5'), tags: { broken: true, dm: true } }, ru('l', 'uO5', 'ru.L91'), ...far], { phase: 'RtPh', first: 'ru', dice: [2, 6, ...Array(60).fill(4)] });
    let s = place(engine, state, 'ge', [wire('uN5')]);
    s = act(engine, s, { type: 'rout.step', unit: 'b', to: 'uN5', leaders: ['l'] }).state;
    expect([pos(s, 'b'), pos(s, 'l')]).toEqual(['on', 'on']);
    const w = act(engine, s, { type: 'rout.wire', unit: 'b' });
    expect(exitEvent(w.events)).toMatchObject({ units: [{ unit: 'b', dr: 2, outcome: 'beneath' }, { unit: 'l', dr: 6, outcome: 'hung' }] });
    expect([pos(w.state, 'b'), pos(w.state, 'l')]).toEqual(['beneath', 'on']);
    s = act(engine, w.state, { type: 'rout.step', unit: 'b', to: 'uM6' }).state;
    expect(s.pieces['b']!.loc).toEqual({ kind: 'hex', hex: 'uM6' });
    expect(s.pieces['l']!.loc).toMatchObject({ kind: 'hex', hex: 'uN5', pos: { wire: 'on' } });
    // On to the Russians' next MPh.
    for (let i = 0; i < 400 && !(s.turn > 1 && s.attacker === 'ru' && s.phase === 'MPh'); i++) {
      const d = engine.currentDecision(s)!;
      const legal = engine.legalActions(s, d.owner);
      s = act(engine, s, legal.find((x) => x.type === 'defPass') ?? legal.find((x) => x.type === 'move.end') ?? legal.find((x) => x.type === 'endPhase') ?? legal[0]!).state;
    }
    expect([s.turn, s.attacker, s.phase]).toEqual([2, 'ru', 'MPh']);
    expect(s.ext['sk1.rout']).toBeFalsy();
    // No escort, TI or other Player Turn record on either (a lasting tag such as the leader's `stackedOn` names a unit
    // he no longer shares a Location with, which reads as none).
    for (const id of ['b', 'l']) expect(Object.keys(s.pieces[id]!.tags).filter((t) => TAG_LIFECYCLE[t] !== 'lasting'), id).toEqual([]);
    expect(stackedOn(engine.env(s), s.pieces['l']!)).toBeNull();
    // The leader moves off the Wire as any unit on top does: the Wire Exit dr first, then on.
    s = act(engine, s, { type: 'move.start', units: ['l'] }).state;
    expect(check(engine, s, { type: 'move.wire' })).toBeNull();
  });

  it('a unit that must rout and is hung up on the Wire is eliminated for Failure to Rout (B26.41)', () => {
    const { engine, state } = game([{ ...ru('b', 'uN5'), tags: { broken: true, dm: true } }, ge('g', 'uR5'), ...far], { phase: 'RtPh', first: 'ru', dice: [6] });
    let s = place(engine, state, 'ge', [wire('uN5')]);
    s = tele(engine, s, 'b', 'uN5', 'on');
    // 6 rout MF, a dr of 6: beneath with nothing left to reach the woods.
    const r = act(engine, s, { type: 'rout.wire', unit: 'b' });
    expect(r.state.pieces['b']!.loc.kind).toBe('eliminated');
    expect(r.events.find((e) => e.type === 'piece.eliminated')?.payload).toMatchObject({ id: 'b', reason: expect.stringMatching(/B26.41/) });
  });

  it('a unit that need not rout may roll, fail and stay alive; getting beneath alone is a Low Crawl (B26.4)', () => {
    const { engine, state } = game([{ ...ru('b', 'uM6'), tags: { broken: true, dm: true } }, ...far], { phase: 'RtPh', first: 'ru', dice: [3] });
    let s = place(engine, state, 'ge', [wire('uM6')]);
    s = tele(engine, s, 'b', 'uM6', 'on');
    const crawl = legal(engine, s, 'rout.wire').find((a) => a['lowCrawl']);
    expect(crawl).toBeDefined();
    const r = act(engine, s, { type: 'rout.wire', unit: 'b', lowCrawl: true });
    expect(pos(r.state, 'b')).toBe('beneath');
    expect(r.state.pieces['b']!.loc.kind).toBe('hex');
    expect(r.events.some((e) => e.type === 'sk1.rout.state' && (e.payload as { step?: unknown }).step)).toBe(false);
  });

  it('a routing unit entering a Wire hex is on top, Interdicted once on entry, and rolls there to go on (B26.41, A10.53)', () => {
    const { engine, state } = game([{ ...ru('b', 'uO5'), tags: { broken: true, dm: true } }, ge('g', 'uR5'), ...far], { phase: 'RtPh', first: 'ru', dice: [1, 1, 1] });
    let s = place(engine, state, 'ge', [wire('uN5')]);
    const r = act(engine, s, { type: 'rout.step', unit: 'b', to: 'uN5' });
    s = r.state;
    expect(pos(s, 'b')).toBe('on');
    expect(engine.currentDecision(s)?.owner).toBe('ru');
    const w = act(engine, s, { type: 'rout.wire', unit: 'b' });
    expect(w.events.filter((e) => e.type === 'sk1.rout.state' && (e.payload as { step?: unknown }).step)).toHaveLength(0);
    expect(pos(w.state, 'b')).toBe('beneath');
  });
});

describe('Removing Wire (B26.51, B26.53) and vehicles (B26.43, D8.21)', () => {
  it('a Placed DC removes the Wire on an Original KIA whatever its DRM; the positions in the hex go with it (B26.51)', () => {
    const { engine, state } = game([ge('a', 'uO5'), { id: 'dc', def: 'ge.DC', side: 'ge', heldBy: 'a' }, ru('r', 'uN5'), ...far], { dice: [2, 3] });
    let s = place(engine, state, 'ru', [wire('uN5')]);
    s = tele(engine, s, 'r', 'uN5', 'on');
    s = act(engine, s, { type: 'move.start', units: ['a'] }).state;
    s = act(engine, s, { type: 'move.placeDc', dc: 'dc', target: 'uN5' }).state;
    for (let i = 0; i < 30 && s.phase !== 'AFPh'; i++) {
      const d = engine.currentDecision(s)!;
      const a = engine.legalActions(s, d.owner).find((x) => x.type === 'defPass' || x.type === 'move.end' || x.type === 'endPhase')!;
      s = act(engine, s, a).state;
    }
    expect(fortCounters(engine.env(s)).some((c) => c.kind === 'wire')).toBe(false);
    expect(pos(s, 'r')).toBeUndefined();
  });

  it('a DC cannot remove a hidden Wire (B26.51; Q&A [K33])', () => {
    // The Wire is in woods (Concealment Terrain) beyond 16 hexes of every Good Order German, and the placer breaks after
    // placing: nothing reveals it before the DC goes off on an Original 5.
    const { engine, state } = game([ge('a', 'uM5'), { id: 'dc', def: 'ge.DC', side: 'ge', heldBy: 'a' }, ...far], { dice: [2, 3] });
    let s = act(engine, state, { type: 'move.start', units: ['a'] }).state;
    s = act(engine, s, { type: 'move.placeDc', dc: 'dc', target: 'uM6' }).state;
    while (engine.currentDecision(s)?.kind === 'firstFire') s = act(engine, s, { type: 'defPass' }).state;
    s = tag(engine, s, 'a', { broken: true });
    s = place(engine, s, 'ru', [wire('uM6', true)]);
    for (let i = 0; i < 30 && s.phase !== 'RtPh'; i++) {
      const d = engine.currentDecision(s)!;
      const a = engine.legalActions(s, d.owner).find((x) => x.type === 'defPass' || x.type === 'move.end' || x.type === 'endPhase')!;
      s = act(engine, s, a).state;
    }
    const c = fortCounters(engine.env(s)).find((x) => x.kind === 'wire');
    expect(c).toBeDefined();
    expect(c!.revealed).toBeUndefined();
  });

  it('a fully-tracked vehicle pays 2 MP more to enter Wire and checks for Bog at +2; a colored 1 on a passed check removes it (B26.43, B26.53, D8.21)', () => {
    const { engine, state } = game([{ id: 'pz', def: 'ge.pzivf2', side: 'ge', hex: 'uO5', tags: { vca: 3 } }, ...far], { dice: [2, 1] });
    const before = engine.env(state).query('vehicle.bogDrm', { vehicle: 'pz', hex: 'uN5', halfMp: false }, 0);
    const s = place(engine, state, 'ru', [wire('uN5')]);
    const env = engine.env(s);
    expect(env.query('vehicle.extraMp', { vehicle: 'pz', hex: 'uN5' }, 0)).toBe(2);
    expect(env.query('vehicle.bogDrm', { vehicle: 'pz', hex: 'uN5', halfMp: false }, 0) - before).toBe(2);
    expect(env.query('vehicle.bogIn', { vehicle: 'pz', hex: 'uN5', turn: false }, false)).toBe(true);
    const truck = game([{ id: 't', def: 'ge.truck', side: 'ge', hex: 'uO5' }, ...far]);
    expect(truck.engine.env(place(truck.engine, truck.state, 'ru', [wire('uN5')])).query('vehicle.extraMp', { vehicle: 't', hex: 'uN5' }, 0)).toBe(4);
  });
});

describe('Vehicles and hidden Wire (B26.43; Q&A [K33] to A12.33)', () => {
  it('a vehicle pays the Wire MP and checks for Bog in its own side\'s hidden Wire: the free entry is Infantry\'s', () => {
    const { engine, state } = game([{ id: 'pz', def: 'ge.pzivf2', side: 'ge', hex: 'uO5', tags: { vca: 3 } }, ...far]);
    const env = engine.env(place(engine, state, 'ge', [wire('uN5', true)]));
    expect(env.query('vehicle.extraMp', { vehicle: 'pz', hex: 'uN5' }, 0)).toBe(2);
    expect(env.query('vehicle.bogIn', { vehicle: 'pz', hex: 'uN5', turn: false }, false)).toBe(true);
    // In play: the step into the hidden Wire costs 2 MP more than the same step with no Wire, and the Bog DR is made.
    const step = (wired: boolean) => {
      const g = game([{ id: 'pz', def: 'ge.pzivf2', side: 'ge', hex: 'uO5', tags: { vca: 3 } }, ...far], { dice: [3, 3, 3, 3, 3, 3] });
      let s = wired ? place(g.engine, g.state, 'ge', [wire('uN5', true)]) : g.state;
      s = act(g.engine, s, { type: 'vmove.start', vehicle: 'pz' }).state;
      const t = act(g.engine, s, { type: 'move.step', to: 'uN5' });
      const states = t.events.filter((e) => e.type === 'sk1.move.state').map((e) => (e.payload as { state: { spent: Record<string, number> } }).state);
      return { spent: states[0]!.spent['pz']!, bog: t.events.some((e) => e.type === 'sk3.vehicle.bog'), at: t.state.pieces['pz']!.loc };
    };
    const plain = step(false);
    const wired = step(true);
    expect(wired.at).toMatchObject({ hex: 'uN5' });
    expect(wired.spent - plain.spent).toBe(2);
    expect(plain.bog).toBe(false);
    expect(wired.bog).toBe(true);
  });

  it('a vehicle entering Wire it cannot know of finds it: revealed, the step refused with nothing spent; then it pays to enter', () => {
    const { engine, state } = game([{ id: 'pz', def: 'ge.pzivf2', side: 'ge', hex: 'uO5', tags: { vca: 3 } }, ...far], { dice: [3, 3, 3, 3] });
    const moving = act(engine, state, { type: 'vmove.start', vehicle: 'pz' }).state;
    const s = place(engine, moving, 'ru', [wire('uN5', true)]);
    expect(check(engine, s, { type: 'move.step', to: 'uN5' })).toBeNull();
    const spent = (x: GameState) => moveState(engine.env(x))!.spent['pz'];
    const r = act(engine, s, { type: 'move.step', to: 'uN5' });
    expect(r.events.find((e) => e.type === 'asl.wire.vehicleRefused')?.payload).toMatchObject({ vehicle: 'pz', hex: 'uN5' });
    expect(fortCounters(engine.env(r.state))[0]!.revealed).toBe(true);
    expect(r.state.pieces['pz']!.loc).toMatchObject({ hex: 'uO5' });
    expect(spent(r.state)).toBe(spent(s));
    const in2 = act(engine, r.state, { type: 'move.step', to: 'uN5' });
    expect(in2.state.pieces['pz']!.loc).toMatchObject({ hex: 'uN5' });
    expect(engine.env(r.state).query('vehicle.extraMp', { vehicle: 'pz', hex: 'uN5' }, 0)).toBe(2);
    expect(in2.events.some((e) => e.type === 'sk3.vehicle.bog')).toBe(true);
  });
});

describe('Across Player Turns (B26.4)', () => {
  const advanceTo = (engine: Eng, s0: GameState, phase: string, attacker: string) => {
    let s = s0;
    for (let i = 0; i < 400 && !(s.phase === phase && s.attacker === attacker && engine.currentDecision(s)?.kind === 'phase'); i++) {
      const d = engine.currentDecision(s)!;
      const legal = engine.legalActions(s, d.owner);
      const a = legal.find((x) => x.type === 'defPass') ?? legal.find((x) => x.type === 'move.end') ?? legal.find((x) => x.type === 'endPhase') ?? legal[0]!;
      s = act(engine, s, a).state;
    }
    return s;
  };

  it('a unit that entered the Wire stays on top into the next Player Turn, rolls then, moves on and is fired on normally', () => {
    const { engine, state } = game([ge('a', 'uO5'), ru('r', 'uN9'), ...far], { dice: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1] });
    let s = place(engine, state, 'ru', [wire('uN5')]);
    s = act(engine, s, { type: 'move.start', units: ['a'] }).state;
    s = act(engine, s, { type: 'move.step', to: 'uN5' }).state;
    s = advanceTo(engine, s, 'MPh', 'ru');
    expect(pos(s, 'a')).toBe('on');
    s = advanceTo(engine, s, 'MPh', 'ge');
    expect(s.turn).toBe(2);
    expect(pos(s, 'a')).toBe('on');
    expect(s.pieces['a']!.tags['moved']).toBeUndefined();
    expect(s.ext['asl.wire']).toBeUndefined();
    expect(s.ext['asl.wire.last']).toBeUndefined();
    s = act(engine, s, { type: 'move.start', units: ['a'] }).state;
    s = pass(engine, act(engine, s, { type: 'move.wire' }).state, 'ru');
    expect(pos(s, 'a')).toBe('beneath');
    const on = act(engine, s, { type: 'move.step', to: 'uO5' });
    expect(on.state.pieces['a']!.loc).toEqual({ kind: 'hex', hex: 'uO5' });
    expect(engine.currentDecision(on.state)).toMatchObject({ kind: 'firstFire', owner: 'ru' });
  });
});
