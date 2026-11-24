import { describe, expect, it } from 'vitest';
import type { Action, Engine, GameState, RuleModule } from '@asl/engine';
import { aslCoreModules, fortCounters, parseLabor, piecesModule, sideToward, statics, turnModule, type FortPlacement, type HexTerrainSpec } from '../../src';
import { sk1CoreModules } from '../../src/sk1';
import { sk2CoreModules } from '../../src/sk2';
import { sk3CoreModules } from '../../src/sk3';
import { act, makeEngine, type PieceSpec } from '../fixtures';

/*
 * Manhandling in full ASL (ASLRB C10.3, B24.8, A4.8, A4.51): Labor after a failed Manhandling DR (on the crew, its helper
 * and the Gun; -1, then -2), the next attempt at its Labor, TI for the Gun and its pushers once the pushing has ended, CX
 * +1, and a roadblock hexside's +2. A German crew pushes a 75L AT Gun (M# 10) with a helper half-squad over board u's Open
 * Ground: each push costs 2 MF (double the Open Ground MF), so +2 on the DR before anything else.
 */

const SK: RuleModule[] = [piecesModule, turnModule, ...sk1CoreModules, ...sk2CoreModules, ...sk3CoreModules];
const ASL: RuleModule[] = [...SK, ...aslCoreModules];
const GROUND: Record<string, HexTerrainSpec> = {
  uN5: { terrain: 'open', features: ['road:dirt'] },
  uN6: { terrain: 'open', features: ['road:dirt'] },
};

const testModule: RuleModule = {
  id: 'test.manhandle',
  install(r) {
    r.action<Action & { fortSide: string; counters: FortPlacement[] }>({
      type: 'test.fortPlace',
      decisionKinds: ['phase', 'firstFire'],
      resolve(ctx, a) {
        const n = fortCounters(ctx).length;
        ctx.emit('asl.fort.placed', { side: a.fortSide, counters: a.counters.map((c, i) => ({ ...c, id: `${a.fortSide}.fort${n + i + 1}`, side: a.fortSide })) });
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

type Eng = Engine;
const ev = (r: { events: { type: string; payload: unknown }[] }, type: string) => r.events.filter((e) => e.type === type).map((e) => e.payload as Record<string, unknown>);
const far: PieceSpec[] = [
  { id: 'gfar', def: 'ge.467', side: 'ge', hex: 'uGG1' },
  { id: 'rfar', def: 'ru.447', side: 'ru', hex: 'uA10' },
];
const crew = (hex = 'uN4'): PieceSpec[] => [
  { id: 'crew', def: 'ge.228c', side: 'ge', hex },
  { id: 'gun', def: 'ge.AT75L', side: 'ge', heldBy: 'crew', tags: { ca: 0 } },
  { id: 'hs', def: 'ge.247', side: 'ge', hex },
];

function bed(dice: number[], opts: { pieces?: PieceSpec[]; roadblock?: boolean } = {}) {
  const scenario = {
    firstSide: 'ge',
    sides: [
      { side: 'ge', name: 'German', nationality: 'ge', elr: 3 },
      { side: 'ru', name: 'Russian', nationality: 'ru', elr: 3 },
    ],
    forces: [],
  };
  const g = makeEngine({ board: 'u', terrain: GROUND, roadHexsides: [['uN5', 'uN6']], scenario, modules: ASL, extra: [testModule], pieces: [...crew(), ...(opts.pieces ?? []), ...far], startPhase: 'MPh', dice });
  let s = g.state;
  if (opts.roadblock) s = act(g.engine, s, { type: 'test.fortPlace', fortSide: 'ge', counters: [{ kind: 'roadblock', hex: 'uN5', hidden: false, hexside: sideToward(statics(g.engine.env(s)).map, 'uN5', 'uN6')! }] }).state;
  return { engine: g.engine, state: s };
}
const pass = (engine: Eng, s: GameState) => {
  let x = s;
  while (engine.currentDecision(x)?.kind === 'firstFire') x = act(engine, x, { type: 'defPass' }).state;
  return x;
};
/** The crew and the helper push the Gun from their hex into `to`; the defender passes. */
function push(engine: Eng, s: GameState, to: string, opts: { doubleTime?: boolean } = {}) {
  let x = act(engine, s, { type: 'move.start', units: ['crew', 'hs'], manhandle: 'gun', ...(opts.doubleTime ? { doubleTime: true } : {}) }).state;
  const r = act(engine, x, { type: 'move.manhandle', to });
  x = pass(engine, r.state);
  if (x.decisions.length && engine.currentDecision(x)?.kind === 'phase' && engine.legalActions(x, 'ge').some((a) => a.type === 'move.end')) x = pass(engine, act(engine, x, { type: 'move.end' }).state);
  return { r, s: x, push: ev(r, 'sk2.gun.manhandle')[0]! };
}
const labor = (s: GameState, id: string) => parseLabor(s.pieces[id]!.tags['labor']);
const advanceTo = (engine: Eng, s0: GameState, phase: string, attacker: string, turn: number) => {
  let s = s0;
  for (let i = 0; i < 800 && !(s.turn === turn && s.phase === phase && s.attacker === attacker && engine.currentDecision(s)?.kind === 'phase'); i++) {
    const d = engine.currentDecision(s)!;
    const legal = engine.legalActions(s, d.owner);
    const a = legal.find((x) => x.type === 'defPass') ?? legal.find((x) => x.type === 'move.end') ?? legal.find((x) => x.type === 'endPhase') ?? legal.find((x) => x.type === 'wa.done') ?? legal[0]!;
    s = act(engine, s, a).state;
  }
  expect(s).toMatchObject({ turn, phase, attacker });
  return s;
};

describe('B24.8, C10.3: Labor after a failed Manhandling DR', () => {
  it('a failed push earns Labor -1 for the crew, its helper and the Gun; nobody moves', () => {
    // 6+6 = 12, +2 MF, -1 for the helper HS: 13 > M# 10.
    const { engine, state } = bed([6, 6]);
    const { s, push: p } = push(engine, state, 'uN5');
    expect(p).toMatchObject({ outcome: 'failed', m: 10 });
    for (const id of ['crew', 'hs', 'gun']) expect(labor(s, id)).toEqual({ task: 'manhandle:uN4', drm: -1 });
    expect(s.pieces['crew']!.loc).toMatchObject({ hex: 'uN4' });
  });

  it('the next attempt takes the Labor, even with a new unit joining; a second failure flips it to -2 for all of them (B24.8)', () => {
    // As after a first failure in O4: crew and Gun under Labor -1; the helper half-squad is new to the Task.
    const { engine, state } = bed([6, 6]);
    let s = act(engine, state, { type: 'test.tag', id: 'crew', tags: { labor: 'manhandle:uN4@-1' } }).state;
    s = act(engine, s, { type: 'test.tag', id: 'gun', tags: { labor: 'manhandle:uN4@-1' } }).state;
    const { s: after, push: p } = push(engine, s, 'uN5');
    expect((p['explain'] as { id: string; label?: string }[]).find((n) => n.id === 'asl.manhandle.labor')?.label).toMatch(/-1 Labor \(ASLRB B24.8\)/);
    expect(p['outcome']).toBe('failed');
    for (const id of ['crew', 'hs', 'gun']) expect(labor(after, id)).toEqual({ task: 'manhandle:uN4', drm: -2 });
  });

  it('a Labor of another Task gives nothing to a push (B24.8 "only to the specific Task")', () => {
    const { engine, state } = bed([6, 6]);
    let s = act(engine, state, { type: 'test.tag', id: 'crew', tags: { labor: 'entrench:uN4@-1' } }).state;
    s = act(engine, s, { type: 'test.tag', id: 'gun', tags: { labor: 'entrench:uN4@-1' } }).state;
    const { push: p } = push(engine, s, 'uN5');
    expect((p['explain'] as { id: string }[]).map((n) => n.id)).not.toContain('asl.manhandle.labor');
  });

  it('a roadblock hexside crossed adds its +2 (C10.3 "+X"); a CX pusher +1 (A4.51)', () => {
    const plain = push(bed([1, 1]).engine, bed([1, 1]).state, 'uN5');
    const rb = bed([1, 1, 1, 1], { roadblock: true });
    // Into N5 first (no hexside of the roadblock crossed), then across N5–N6.
    let s = rb.state;
    const into = push(rb.engine, s, 'uN5');
    s = into.s;
    expect(into.push['drm']).toBe(plain.push['drm']);
    s = advanceTo(rb.engine, s, 'MPh', 'ge', 2);
    s = rb.engine.submit(s, { type: 'test.tag', id: 'crew', tags: { ti: null }, side: 'ge', decisionId: rb.engine.currentDecision(s)!.id } as Action).state;
    const across = push(rb.engine, s, 'uN6');
    expect((across.push['explain'] as { id: string }[]).map((n) => n.id)).toContain('asl.manhandle.hexside');
    expect((across.push['drm'] as number) - (plain.push['drm'] as number)).toBe(2);
    const cx = bed([1, 1]);
    const dt = push(cx.engine, cx.state, 'uN5', { doubleTime: true });
    expect((dt.push['explain'] as { id: string; label?: string }[]).find((n) => n.id === 'asl.manhandle.cx')?.label).toMatch(/\+1 CX \(ASLRB A4.51\)/);
  });
});

describe('C10.3, A4.8: TI after pushing', () => {
  it('the crew, its helper and the Gun are TI once the push has ended: no AFPh fire (A4.8)', () => {
    // 1+1 = 2, +2 MF, -1 helper: 3 < 10, the Gun goes on; the move ends there.
    const { engine, state } = bed([1, 1], { pieces: [{ id: 'r', def: 'ru.447', side: 'ru', hex: 'uN7' }] });
    const { s, push: p } = push(engine, state, 'uN5');
    expect(p['outcome']).toBe('moved');
    for (const id of ['crew', 'hs', 'gun']) expect(s.pieces[id]!.tags['ti']).toBe(true);
    const afph = advanceTo(engine, s, 'AFPh', 'ge', 1);
    expect(engine.env(afph).query('fire.illegal', { decl: { units: ['hs'], sw: [], target: 'uN7' }, mode: 'advancing', side: 'ge' }, null)).toMatch(/TI this Player Turn and may not fire \(ASLRB A4.8\)/);
  });

  it('a stack that starts a manhandling move but makes no Manhandling DR is not TI', () => {
    const { engine, state } = bed([]);
    let s = act(engine, state, { type: 'move.start', units: ['crew', 'hs'], manhandle: 'gun' }).state;
    s = pass(engine, act(engine, s, { type: 'move.end' }).state);
    expect(s.pieces['crew']!.tags['ti']).toBeUndefined();
  });
});

describe('Manhandling across Player Turns (B24.8, C10.3, A4.8)', () => {
  it('fail (TI, Labor -1); TI off at the end of the CCPh; next turn the push at -1 succeeds; Labor and TI gone the turn after', () => {
    // Turn 1: 6+6 fails. Turn 2: 2+2 +2 -1 helper -1 Labor = 4, moved.
    const { engine, state } = bed([6, 6, ...Array(60).fill(2)]);
    let s = push(engine, state, 'uN5').s;
    expect(s.pieces['crew']!.tags['ti']).toBe(true);
    expect(labor(s, 'crew')?.drm).toBe(-1);
    s = advanceTo(engine, s, 'MPh', 'ru', 1);
    for (const id of ['crew', 'hs', 'gun']) expect(s.pieces[id]!.tags['ti']).toBeUndefined();
    expect(labor(s, 'crew')?.drm).toBe(-1);
    s = advanceTo(engine, s, 'MPh', 'ge', 2);
    const second = push(engine, s, 'uN5');
    expect((second.push['explain'] as { id: string; label?: string }[]).find((n) => n.id === 'asl.manhandle.labor')?.label).toMatch(/-1 Labor/);
    expect(second.push['outcome']).toBe('moved');
    s = second.s;
    // The Task is achieved: the Gun has left the Location, and nobody keeps the Labor.
    expect(s.pieces['crew']!.loc).toMatchObject({ hex: 'uN5' });
    for (const id of ['crew', 'hs', 'gun']) expect(s.pieces[id]!.tags['labor']).toBeUndefined();
    // The turn after: no TI, no Labor; the half-squad may fire and the crew push again.
    s = advanceTo(engine, s, 'PFPh', 'ge', 3);
    for (const id of ['crew', 'hs', 'gun']) {
      expect(s.pieces[id]!.tags['ti']).toBeUndefined();
      expect(s.pieces[id]!.tags['labor']).toBeUndefined();
    }
    expect(engine.env(s).query('fire.illegal', { decl: { units: ['hs'], sw: [], target: 'uA10' }, mode: 'prep', side: 'ge' }, null) ?? '').not.toMatch(/TI/);
    s = advanceTo(engine, s, 'MPh', 'ge', 3);
    expect(engine.validate(s, { type: 'move.start', units: ['crew', 'hs'], manhandle: 'gun', side: 'ge', decisionId: engine.currentDecision(s)!.id } as Action)).toBeNull();
  });
});
