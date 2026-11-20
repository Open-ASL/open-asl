import { describe, expect, it } from 'vitest';
import type { Action, Engine, GameState, RuleModule } from '@asl/engine';
import { aslCoreModules, clearanceDrm, clearanceTasks, fortCounters, rubbleAt, trailBreaksAt, piecesModule, sideToward, statics, taskDrm, turnModule, type FortPlacement, type HexTerrainSpec } from '../../src';
import { sk1CoreModules } from '../../src/sk1';
import { sk2CoreModules } from '../../src/sk2';
import { sk3CoreModules } from '../../src/sk3';
import { act, makeEngine, type PieceSpec } from '../fixtures';

/*
 * Clearance Tasks (ASLRB B24.7, B24.73, B24.76, B24.8, A4.51, A4.62): Wire and roadblocks are declared in the MPh (before
 * any stack moves) or the DFPh, the participants TI at once, and cleared by one Final DR ≤ 2 at the end of the CCPh; a
 * failure earns Labor. The ground is board u, Open Ground; the Wire is in uN5, the roadblock on uN5–uN6.
 */

const SK: RuleModule[] = [piecesModule, turnModule, ...sk1CoreModules, ...sk2CoreModules, ...sk3CoreModules];
const ASL: RuleModule[] = [...SK, ...aslCoreModules];
const GROUND: Record<string, HexTerrainSpec> = { uN5: { terrain: 'open', features: ['road:dirt'] }, uN6: { terrain: 'open', features: ['road:dirt'] }, uK4: { terrain: 'building-stone', buildingId: 'u-B16' } };

const testModule: RuleModule = {
  id: 'test.clearance',
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
    r.action<Action & { hex: string }>({
      type: 'test.rubble',
      decisionKinds: ['phase'],
      resolve(ctx, a) {
        ctx.emit('asl.rubble', { hex: a.hex, from: 0, kind: 'stone', by: 'falling', burning: false });
      },
    });
    r.action<Action & { id: string; tags: Record<string, unknown> }>({
      type: 'test.tag',
      decisionKinds: ['phase', 'firstFire'],
      resolve(ctx, a) {
        ctx.emit('piece.tagged', { id: a.id, tags: a.tags as Record<string, never> });
      },
    });
  },
};

function game(pieces: PieceSpec[], opts: { dice?: number[]; phase?: string; first?: 'ge' | 'ru' } = {}) {
  const scenario = {
    firstSide: opts.first ?? 'ru',
    sides: [
      { side: 'ge', name: 'German', nationality: 'ge', elr: 3 },
      { side: 'ru', name: 'Russian', nationality: 'ru', elr: 3 },
    ],
    forces: [],
  };
  return makeEngine({ board: 'u', terrain: GROUND, roadHexsides: [['uN5', 'uN6']], scenario, modules: ASL, extra: [testModule], pieces, startPhase: opts.phase ?? 'MPh', dice: opts.dice ?? [] });
}
type Eng = Engine;
const wire = (hex: string): FortPlacement => ({ kind: 'wire', hex, hidden: false });
const roadblock = (engine: Eng, s: GameState): FortPlacement => ({ kind: 'roadblock', hex: 'uN5', hidden: false, hexside: sideToward(statics(engine.env(s)).map, 'uN5', 'uN6')! });
const place = (engine: Eng, state: GameState, side: string, counters: FortPlacement[]) => act(engine, state, { type: 'test.fortPlace', fortSide: side, counters }).state;
const tele = (engine: Eng, state: GameState, id: string, hex: string, w?: 'on' | 'beneath') => act(engine, state, { type: 'test.teleport', id, hex, ...(w ? { wire: w } : {}) }).state;
const check = (engine: Eng, state: GameState, a: Record<string, unknown>) => {
  const d = engine.currentDecision(state)!;
  return engine.validate(state, { side: d.owner, decisionId: d.id, ...a } as never);
};
const ge = (id: string, hex: string, def = 'ge.467'): PieceSpec => ({ id, def, side: 'ge', hex });
const ru = (id: string, hex: string, def = 'ru.447'): PieceSpec => ({ id, def, side: 'ru', hex });
const far = [ge('gfar', 'uGG1'), ru('rfar', 'uA10')];
/** Plays on, passing and ending phases, until `until` holds. */
const playTo = (engine: Eng, s0: GameState, until: (s: GameState) => boolean) => {
  let s = s0;
  const events: { type: string; payload: unknown }[] = [];
  for (let i = 0; i < 400 && !until(s); i++) {
    const d = engine.currentDecision(s)!;
    const legal = engine.legalActions(s, d.owner);
    const a = legal.find((x) => x.type === 'defPass') ?? legal.find((x) => x.type === 'move.end') ?? legal.find((x) => x.type === 'endPhase') ?? legal[0]!;
    const r = act(engine, s, a);
    events.push(...r.events);
    s = r.state;
  }
  return { s, events };
};
const drEvent = (events: { type: string; payload: unknown }[]) => events.find((e) => e.type === 'asl.clearance.dr')?.payload as { success?: boolean; drm?: number; explain?: string[]; labor?: number; abandoned?: true; units: string[] } | undefined;

describe('Wire Clearance (B24.73, B24.7, B24.8)', () => {
  it('declared in the MPh by units beneath the Wire, TI at once, rolled at the end of the CCPh: a Final DR ≤ 2 removes it and every position with it', () => {
    const { engine, state } = game([ru('a', 'uN5'), ru('b', 'uN5'), ...far], { dice: [2, 2] });
    let s = place(engine, state, 'ge', [wire('uN5')]);
    s = tele(engine, s, 'a', 'uN5', 'beneath');
    s = tele(engine, s, 'b', 'uN5', 'beneath');
    const offered = engine.legalActions(s, 'ru').filter((a) => a.type === 'clearance.declare');
    expect(offered).toEqual([expect.objectContaining({ kind: 'wire', loc: 'uN5', units: ['a', 'b'] })]);
    // Two squads: -1 for the first, -2 for the second; no EC DRM (B24.7 †: Flames only).
    expect(taskDrm(engine.env(s), { kind: 'wire', loc: 'uN5', units: ['a', 'b'] })).toMatchObject({ drm: -3, explain: ['-3 2 squads'] });
    s = act(engine, s, { type: 'clearance.declare', kind: 'wire', counter: 'ge.fort1', loc: 'uN5', units: ['a', 'b'] }).state;
    expect([s.pieces['a']!.tags['ti'], s.pieces['b']!.tags['ti']]).toEqual([true, true]);
    expect(s.pieces['a']!.tags['hazardous']).toBeUndefined();
    expect(clearanceTasks(engine.env(s))).toHaveLength(1);
    // TI: no advance in the APh (A4.8).
    const { s: end, events } = playTo(engine, s, (x) => x.attacker === 'ge');
    expect(drEvent(events)).toMatchObject({ success: true, drm: -3 });
    expect(fortCounters(engine.env(end)).some((c) => c.kind === 'wire')).toBe(false);
    expect(end.pieces['a']!.loc).toEqual({ kind: 'hex', hex: 'uN5' });
    expect(end.pieces['a']!.tags['ti']).toBeUndefined();
    expect(clearanceTasks(engine.env(end))).toEqual([]);
  });

  it('a unit on top, one that moved, and a leader alone may not declare (B24.73, B24.7)', () => {
    const { engine, state } = game([ru('a', 'uN5'), ru('l', 'uN5', 'ru.L91'), ...far]);
    let s = place(engine, state, 'ge', [wire('uN5')]);
    s = tele(engine, s, 'a', 'uN5', 'on');
    s = tele(engine, s, 'l', 'uN5', 'beneath');
    expect(check(engine, s, { type: 'clearance.declare', kind: 'wire', counter: 'ge.fort1', loc: 'uN5', units: ['a'] })).toMatch(/on top of the Wire.*B24.73/);
    expect(check(engine, s, { type: 'clearance.declare', kind: 'wire', counter: 'ge.fort1', loc: 'uN5', units: ['l'] })).toMatch(/not an Infantry MMC/);
    const moved = act(engine, tele(engine, s, 'a', 'uN5', 'beneath'), { type: 'test.tag', id: 'a', tags: { moved: true } }).state;
    expect(check(engine, moved, { type: 'clearance.declare', kind: 'wire', counter: 'ge.fort1', loc: 'uN5', units: ['a'] })).toMatch(/has moved/);
  });

  it('a failure leaves Labor -1 on the MMC, which the next attempt takes; a CX participant adds +1 (B24.8, A4.51)', () => {
    const { engine, state } = game([ru('a', 'uN5'), ...far], { dice: [6, 6] });
    let s = place(engine, state, 'ge', [wire('uN5')]);
    s = tele(engine, s, 'a', 'uN5', 'beneath');
    s = act(engine, s, { type: 'clearance.declare', kind: 'wire', counter: 'ge.fort1', loc: 'uN5', units: ['a'] }).state;
    const { s: end, events } = playTo(engine, s, (x) => x.attacker === 'ge');
    expect(drEvent(events)).toMatchObject({ success: false, labor: -1 });
    expect(end.pieces['a']!.tags['labor']).toBe('wire:uN5@-1');
    expect(taskDrm(engine.env(end), { kind: 'wire', loc: 'uN5', units: ['a'] }).explain).toEqual(['-1 Labor', '-1 one squad']);
    const cx = act(engine, end, { type: 'test.tag', id: 'a', tags: { cx: true } }).state;
    expect(taskDrm(engine.env(cx), { kind: 'wire', loc: 'uN5', units: ['a'] }).explain).toContain('+1 CX');
  });

  it('the DEFENDER may declare in the DFPh; a unit pinned before the DR drops out, and with no MMC left there is no DR', () => {
    const { engine, state } = game([ru('a', 'uN5'), ge('g', 'uN8'), ...far], { phase: 'DFPh', first: 'ge' });
    let s = place(engine, state, 'ge', [wire('uN5')]);
    s = tele(engine, s, 'a', 'uN5', 'beneath');
    expect(engine.currentDecision(s)?.owner).toBe('ru');
    s = act(engine, s, { type: 'clearance.declare', kind: 'wire', counter: 'ge.fort1', loc: 'uN5', units: ['a'] }).state;
    s = act(engine, s, { type: 'test.tag', id: 'a', tags: { pinned: true } }).state;
    expect(clearanceTasks(engine.env(s))[0]!.units).toEqual([]);
    const { s: end, events } = playTo(engine, s, (x) => x.attacker === 'ru');
    expect(drEvent(events)).toMatchObject({ abandoned: true });
    expect(end.pieces['a']!.tags['labor']).toBeUndefined();
  });
});

describe('Roadblock Clearance (B24.76, A4.62, B29.5)', () => {
  it('declared in the MPh it is Hazardous Movement until its DR: no MF, so no First Fire; the DFPh fire is at -2; success at the CCPh end removes the roadblock (B24.76, A4.62; Q&A [K33] to B24.7)', () => {
    const { engine, state } = game([ru('a', 'uN5'), ge('g', 'uN8'), ...far], { dice: [6, 6, 1, 1] });
    let s = place(engine, state, 'ge', [roadblock(engine, state)]);
    s = act(engine, s, { type: 'clearance.declare', kind: 'roadblock', counter: 'ge.fort1', loc: 'uN5', units: ['a'] }).state;
    expect(s.pieces['a']!.tags).toMatchObject({ ti: true, hazardous: true });
    // Declaring spends no MF: the Russian keeps the phase, no First Fire is offered.
    expect(engine.currentDecision(s)).toMatchObject({ kind: 'phase', owner: 'ru' });
    const dfph = playTo(engine, s, (x) => x.phase === 'DFPh' && engine.currentDecision(x)?.owner === 'ge').s;
    // The DEFENDER's DFPh fire meets the Hazardous Movement (-2): the clearers are engaged until their DR.
    const labels = engine.env(dfph).explain('fire.unitDrm', { attack: { target: 'uN5', parts: [{ firer: 'g' }], mode: 'final', side: 'ge', hindrance: 0 } as never, unit: 'a' }, 0).trace.map((c) => c.label ?? '');
    expect(labels).toContain('-2 Hazardous Movement (clearing a roadblock, ASLRB B24.76)');
    const f = act(engine, dfph, { type: 'fire', decl: { units: ['g'], sw: [], target: 'uN5' } });
    const { s: end, events } = playTo(engine, f.state, (x) => x.attacker === 'ge');
    expect(drEvent(events)).toMatchObject({ success: true });
    expect(fortCounters(engine.env(end)).some((c) => c.kind === 'roadblock')).toBe(false);
    expect(end.pieces['a']!.tags['hazardous']).toBeUndefined();
  });

  it('units in the two hexes of the hexside roll separate Tasks (B29.5)', () => {
    const { engine, state } = game([ru('a', 'uN5'), ru('b', 'uN6'), ...far]);
    let s = place(engine, state, 'ge', [roadblock(engine, state)]);
    const offered = engine.legalActions(s, 'ru').filter((a) => a.type === 'clearance.declare');
    expect(offered.map((a) => a['loc'])).toEqual(['uN5', 'uN6']);
    s = act(engine, s, offered[0]! as never).state;
    while (engine.currentDecision(s)?.kind === 'firstFire') s = act(engine, s, { type: 'defPass' }).state;
    s = act(engine, s, { type: 'clearance.declare', kind: 'roadblock', counter: 'ge.fort1', loc: 'uN6', units: ['b'] }).state;
    expect(clearanceTasks(engine.env(s)).map((t) => t.loc)).toEqual(['uN5', 'uN6']);
  });
});

describe('Flame clearance DRM (B24.7, A4.51)', () => {
  it('a CX participant adds +1 to the Flame Clearance DR as well; the EC DRM stays for Flames only', () => {
    const { engine, state } = game([{ ...ru('a', 'uN5'), tags: { cx: true } }, ...far], { phase: 'PFPh' });
    const env = engine.env(state);
    expect(clearanceDrm(env, 'uN5', ['a']).explain).toContain('+1 CX');
    expect(clearanceDrm(env, 'uN5', ['a'], undefined, { task: 'wire:uN5', ec: false }).explain.some((x) => x.startsWith('EC'))).toBe(false);
  });
});

describe('Rubble Clearance and Trail Breaks (B24.71, B13.4212, B24.121)', () => {
  // Fallen stone rubble in uN5, a road hex (Open Ground beneath); the TB crosses the uN5–uN6 hexside and one other.
  const rubbled = (pieces: PieceSpec[], dice: number[] = []) => {
    const g = game(pieces, { dice });
    const s = act(g.engine, g.state, { type: 'test.rubble', hex: 'uN5' }).state;
    const map = statics(g.engine.env(s)).map;
    return { ...g, s, k: sideToward(map, 'uN5', 'uN6')!, k4: sideToward(map, 'uN5', 'uN4')! };
  };

  it('a road under fallen rubble gives no road rate: three MF to enter, even along the road (B24.121)', () => {
    const { engine, s } = rubbled([ru('a', 'uN6'), ...far]);
    expect(engine.env(s).query('move.cost', { unit: 'a', from: 'uN6', to: 'uN5', viaRoad: true }, 1)).toBe(3);
  });

  it('declared by a squad remaining in the hex (Hazardous Movement, TI), the DR at the end of the CCPh places a TB across the two hexsides chosen', () => {
    const { engine, s: s0, k, k4 } = rubbled([ru('a', 'uN5'), ge('g', 'uN9'), ...far], [6, 6, 1, 1]);
    // Without a TB the Wire/roadblock Task kinds are not offered here; rubble is.
    const offered = engine.legalActions(s0, 'ru').filter((a) => a.type === 'clearance.declare');
    expect(offered).toEqual([expect.objectContaining({ kind: 'rubble', counter: 'uN5', loc: 'uN5', units: ['a'] })]);
    expect(check(engine, s0, { type: 'clearance.declare', kind: 'rubble', counter: 'uN5', loc: 'uN5', units: ['a'] })).toMatch(/two hexsides/);
    let s = act(engine, s0, { type: 'clearance.declare', kind: 'rubble', counter: 'uN5', loc: 'uN5', units: ['a'], hexsides: [k, k4] }).state;
    expect(s.pieces['a']!.tags).toMatchObject({ ti: true, hazardous: true });
    expect(engine.currentDecision(s)).toMatchObject({ kind: 'firstFire', owner: 'ge' });
    const f = act(engine, s, { type: 'defFire', decl: { units: ['g'], sw: [], target: 'uN5' } });
    const labels = ((f.events.find((e) => e.type === 'sk1.fire.result' && (e.payload as { unit: string }).unit === 'a')?.payload as { explain?: { label?: string }[] }).explain ?? []).map((n) => n.label ?? '');
    expect(labels).toContain('-2 Hazardous Movement (clearing rubble, ASLRB B24.71)');
    s = f.state;
    const { s: end, events } = playTo(engine, s, (x) => x.attacker === 'ge');
    expect(drEvent(events)).toMatchObject({ success: true });
    expect(trailBreaksAt(engine.env(end), 'uN5')).toEqual([[k, k4]]);
    expect(rubbleAt(engine.env(end), 'uN5')).toBeDefined();
    expect(end.pieces['a']!.tags['ti']).toBeUndefined();
    // A unit entering through the TB hexside pays the pre-rubble cost (the road: 1 MF); through another, the rubble's 3.
    expect(engine.env(end).query('move.cost', { unit: 'a', from: 'uN6', to: 'uN5', viaRoad: true }, 1)).toBe(1);
    expect(engine.env(end).query('move.cost', { unit: 'a', from: 'uM5', to: 'uN5', viaRoad: false }, 1)).toBe(3);
    // B13.4211: no second TB on the exact same hexsides.
  });

  it('a stack whose whole move is entering the hex may declare there, spending all its MF; units that moved on may not (B24.71)', () => {
    const { engine, s: s0, k, k4 } = rubbled([ru('a', 'uN6'), ru('b', 'uN6'), ...far]);
    let s = act(engine, s0, { type: 'move.start', units: ['a'] }).state;
    s = act(engine, s, { type: 'move.step', to: 'uN5' }).state;
    while (engine.currentDecision(s)?.kind === 'firstFire') s = act(engine, s, { type: 'defPass' }).state;
    expect(engine.legalActions(s, 'ru').filter((a) => a.type === 'clearance.declare')).toEqual([expect.objectContaining({ kind: 'rubble', units: ['a'] })]);
    // b (not moving) may not join while a stack moves.
    expect(check(engine, s, { type: 'clearance.declare', kind: 'rubble', counter: 'uN5', loc: 'uN5', units: ['a', 'b'], hexsides: [k, k4] })).toBeTruthy();
    s = act(engine, s, { type: 'clearance.declare', kind: 'rubble', counter: 'uN5', loc: 'uN5', units: ['a'], hexsides: [k, k4] }).state;
    while (engine.currentDecision(s)?.kind === 'firstFire') s = act(engine, s, { type: 'defPass' }).state;
    expect(s.pieces['a']!.tags).toMatchObject({ ti: true, hazardous: true });
    expect(clearanceTasks(engine.env(s))).toEqual([expect.objectContaining({ kind: 'rubble', units: ['a'], hexsides: [k, k4] })]);
    // A squad that moved through another hex first may not.
    const two = rubbled([ru('c', 'uN7'), ...far]);
    let t = act(two.engine, two.s, { type: 'move.start', units: ['c'] }).state;
    t = act(two.engine, t, { type: 'move.step', to: 'uN6' }).state;
    while (two.engine.currentDecision(t)?.kind === 'firstFire') t = act(two.engine, t, { type: 'defPass' }).state;
    t = act(two.engine, t, { type: 'move.step', to: 'uN5' }).state;
    while (two.engine.currentDecision(t)?.kind === 'firstFire') t = act(two.engine, t, { type: 'defPass' }).state;
    expect(check(two.engine, t, { type: 'clearance.declare', kind: 'rubble', counter: 'uN5', loc: 'uN5', units: ['c'], hexsides: [two.k, two.k4] })).toMatch(/all of its MF.*B24.71/);
  });

  it('across turns: a TB made in the Russian turn lowers the cost next turn, may be declined to avoid the -1 Defensive First Fire DRM, and three TB over every hexside clear the rubble', () => {
    const { engine, s: s0, k, k4 } = rubbled([ru('a', 'uN5'), ru('m', 'uN7'), ge('g', 'uN9'), ...far], Array(120).fill(1) as number[]);
    let s = act(engine, s0, { type: 'clearance.declare', kind: 'rubble', counter: 'uN5', loc: 'uN5', units: ['a'], hexsides: [k, k4] }).state;
    while (engine.currentDecision(s)?.kind === 'firstFire') s = act(engine, s, { type: 'defPass' }).state;
    ({ s } = playTo(engine, s, (x) => x.attacker === 'ru' && x.phase === 'MPh' && x.turn > s0.turn));
    expect(trailBreaksAt(engine.env(s), 'uN5')).toEqual([[k, k4]]);
    expect(s.pieces['a']!.tags['ti']).toBeUndefined();
    expect(s.pieces['a']!.tags['hazardous']).toBeUndefined();
    // m enters N6 then N5 through the TB hexside: 1 MF (the road), and the DEFENDER's First Fire there takes -1.
    s = act(engine, s, { type: 'move.start', units: ['m'] }).state;
    s = act(engine, s, { type: 'move.step', to: 'uN6' }).state;
    while (engine.currentDecision(s)?.kind === 'firstFire') s = act(engine, s, { type: 'defPass' }).state;
    expect(engine.legalActions(s, 'ru').filter((a) => a.type === 'move.step' && a['to'] === 'uN5').map((a) => !!a['noTb'])).toEqual([false, true]);
    const via = act(engine, s, { type: 'move.step', to: 'uN5' }).state;
    expect((via.ext['sk1.move'] as { mfHere: number; tb?: true }).mfHere).toBe(1);
    expect((via.ext['sk1.move'] as { tb?: true }).tb).toBe(true);
    const shot = act(engine, via, { type: 'defFire', decl: { units: ['g'], sw: [], target: 'uN5' } });
    const att = ((shot.events.find((e) => e.type === 'sk1.fire.attack')?.payload as { explain?: { label?: string }[] }).explain ?? []).map((n) => n.label ?? '');
    expect(att).toContain('-1 Trail Break (restricted movement)');
    // Declining it: the rubble's 3 MF and no -1.
    const decl = act(engine, s, { type: 'move.step', to: 'uN5', noTb: true }).state;
    expect((decl.ext['sk1.move'] as { mfHere: number; tb?: true }).mfHere).toBe(3);
    expect((decl.ext['sk1.move'] as { tb?: true }).tb).toBeUndefined();
    // Two more TB over the other four hexsides remove the rubble and the TB (B24.71).
    let c = act(engine, s0, { type: 'test.rubble', hex: 'uN5' }).state;
    const rest = [0, 1, 2, 3, 4, 5].filter((x) => x !== k && x !== k4);
    for (const pair of [[k, k4], [rest[0], rest[1]], [rest[2], rest[3]]] as [number, number][]) {
      c = act(engine, c, { type: 'clearance.declare', kind: 'rubble', counter: 'uN5', loc: 'uN5', units: ['a'], hexsides: pair }).state;
      while (engine.currentDecision(c)?.kind === 'firstFire') c = act(engine, c, { type: 'defPass' }).state;
      const turn = c.turn;
      ({ s: c } = playTo(engine, c, (x) => x.attacker === 'ru' && x.phase === 'MPh' && x.turn > turn));
    }
    expect(rubbleAt(engine.env(c), 'uN5')).toBeUndefined();
    expect(trailBreaksAt(engine.env(c), 'uN5')).toEqual([]);
  });

  it('a building hex\'s rubble is not cleared (B24.71: "any non-building hex ... even if completely rubbled")', () => {
    const g = game([ru('a', 'uN5'), ...far]);
    const b = 'uK4';
    const s = act(g.engine, act(g.engine, g.state, { type: 'test.teleport', id: 'a', hex: b }).state, { type: 'test.rubble', hex: b }).state;
    expect(g.engine.legalActions(s, 'ru').filter((a) => a.type === 'clearance.declare')).toEqual([]);
  });
});
