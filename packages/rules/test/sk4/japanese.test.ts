import { describe, expect, it } from 'vitest';
import type { Action, Ctx, GameState, RuleModule } from '@asl/engine';
import { FP, P as MP, attemptRally, ccAttackPreview, hiddenUnitsModule, hthActive, japaneseModule, sk2CoreModules, sk3CoreModules, type CheckGroupFn, type FireDeclaration, type FireMode, type ResolveFireFn, type SetupAction, type UnitFn } from '../../src';
import { act, makeEngine, type PieceSpec } from '../fixtures';

/**
 * The Japanese (SK4 8.1): Step Reduction instead of breaking, leaders wounded rather than broken, forced rallies with
 * Replacement, Hand-to-Hand CC, the −1 ambush, MG/ATR B# and ROF, no PAATC, LLMC as LLTC, 10% HIP. The rulebook's own
 * examples (8.1.3 the stack under a 1MC; 8.1.7 the 9-1 rallying three units in jungle) are reproduced DR for DR.
 */
const testHooks: RuleModule = {
  id: 'test.hooks',
  install(r) {
    r.action<Action & { units: string[]; kind: 'MC' | 'PTC'; mod: number }>({
      type: 'test.check',
      decisionKinds: ['phase'],
      resolve: (ctx, a) => void ctx.proc<CheckGroupFn>(MP.checkGroup)(ctx, a.units, { kind: a.kind, mod: a.mod, reason: 'test' }),
    });
    r.action<Action & { unit: string }>({ type: 'test.break', decisionKinds: ['phase'], resolve: (ctx, a) => ctx.proc<UnitFn>(MP.breakUnit)(ctx, a.unit) });
    r.action<Action & { unit: string; leader: string }>({ type: 'test.rally', decisionKinds: ['phase'], resolve: (ctx, a) => attemptRally(ctx, a.unit, a.leader, false, false) });
    r.action<Action & { decl: FireDeclaration; mode: FireMode }>({
      type: 'test.fire',
      decisionKinds: ['phase'],
      validate: (env, a) => env.query('fire.illegal', { decl: a.decl, mode: a.mode, side: a.side }, null),
      resolve: (ctx: Ctx, a) => ctx.proc<ResolveFireFn>(FP.resolve)(ctx, a.decl, a.mode),
    });
    r.action<Action & { hex: string; step: string; ambusher?: string | null }>({
      type: 'test.ccState',
      decisionKinds: ['phase', 'ccHex', 'ccDeclare'],
      resolve: (ctx, a) => ctx.emit('sk1.cc.state', { state: { pending: [], hex: a.hex, step: a.step, ambusher: a.ambusher ?? null, declared: {} } }),
    });
  },
};
const extra = [...sk2CoreModules, ...sk3CoreModules, hiddenUnitsModule, japaneseModule, testHooks];
const JA_VS_AM = {
  firstSide: 'am',
  sides: [
    { side: 'am', name: 'U.S. Marine Corps', nationality: 'am', elr: 5 },
    { side: 'ja', name: 'Japanese', nationality: 'ja', elr: 3 },
  ],
};
const WOODS = { yK5: { terrain: 'woods' } };
const game = (pieces: PieceSpec[], opts: { startPhase?: string; firstSide?: string; dice?: number[]; terrain?: Record<string, { terrain: string }>; hexMarkers?: Record<string, Record<string, unknown>>; forces?: unknown[] } = {}) =>
  makeEngine({
    scenario: { ...JA_VS_AM, firstSide: opts.firstSide ?? 'am', ...(opts.forces ? { forces: opts.forces as never } : {}) },
    extra,
    terrain: opts.terrain ?? WOODS,
    startPhase: opts.startPhase ?? 'PFPh',
    pieces,
    ...(opts.dice ? { dice: opts.dice } : {}),
    ...(opts.hexMarkers ? { hexMarkers: opts.hexMarkers } : {}),
  });
type Ev = { type: string; payload: unknown };
/** The events of every action so far, for assertions on what was emitted. */
let events: Ev[] = [];
const step = (r: { state: GameState; events: Ev[] }) => {
  events = [...events, ...r.events];
  return r.state;
};
const check = (engine: ReturnType<typeof game>['engine'], s: GameState, units: string[], mod = 1, kind: 'MC' | 'PTC' = 'MC') => step(act(engine, s, { type: 'test.check', units, kind, mod }));
const piece = (s: GameState, id: string) => s.pieces[id]!;
const outcomes = (unit: string) => events.filter((e) => e.type === 'sk1.check' && (e.payload as { unit: string }).unit === unit).map((e) => (e.payload as { outcome: string }).outcome);
const emitted = (type: string) => events.some((e) => e.type === type);

describe('Step Reduction (SK4 8.1.1–8.1.6)', () => {
  it('reproduces the 8.1.3 example: a 4-4-7 steps to 3-4-7r, the 2-3-7r exceeding its ELR becomes an unbroken Conscript 1-2-6 HS, the 1-3-7 HS breaks', () => {
    // 1MC; checks in id order: a (4+3+1 = 8 > 7), b (5+5+1 = 11, fails by 4 > ELR 3), c (4+4+1 = 9, fails by 2).
    const { engine, state: s0 } = game(
      [
        { id: 'a', def: 'ja.447', side: 'ja', hex: 'yK5', tags: { pinned: true } },
        { id: 'b', def: 'ja.237r', side: 'ja', hex: 'yK5' },
        { id: 'c', def: 'ja.137h', side: 'ja', hex: 'yK5' },
      ],
      { dice: [4, 3, 5, 5, 4, 4] },
    );
    const s = check(engine, s0, ['a', 'b', 'c']);
    expect(piece(s, 'a').defId).toBe('ja.347r');
    expect(piece(s, 'a').tags['broken']).toBeUndefined();
    // "retains any Pinned/CX status it has"
    expect(piece(s, 'a').tags['pinned']).toBe(true);
    expect(outcomes('a')).toEqual(['stepReduced']);
    expect(piece(s, 'b').defId).toBe('ja.126h');
    expect(piece(s, 'b').tags['broken']).toBeUndefined();
    expect(events.some((e) => e.type === 'sk1.elr' && (e.payload as { unit: string; to: string }).unit === 'b' && (e.payload as { to: string }).to === 'ja.226r')).toBe(true);
    expect(piece(s, 'c').defId).toBe('ja.137h');
    expect(piece(s, 'c').tags['broken']).toBe(true);
    expect(piece(s, 'c').tags['dm']).toBe(true);
    expect(outcomes('c')).toEqual(['broken']);
  });

  it('a Conscript exceeding its ELR becomes one of its broken HS, Full or Reduced', () => {
    const { engine, state: s0 } = game([{ id: 'a', def: 'ja.336', side: 'ja', hex: 'yK5' }, { id: 'b', def: 'ja.226r', side: 'ja', hex: 'yK5' }], { dice: [5, 5, 5, 5] });
    const s = check(engine, s0, ['a', 'b']);
    for (const id of ['a', 'b']) {
      expect(piece(s, id).defId).toBe('ja.126h');
      expect(piece(s, id).tags['broken']).toBe(true);
    }
  });

  it('a non-Conscript Full-Strength squad exceeding its ELR drops a Class and then steps', () => {
    // 6+4+1 = 11 vs 7: by 4 > ELR 3: 4-4-7 → 3-4-7 (2nd Line) → 2-3-7r.
    const { engine, state: s0 } = game([{ id: 'a', def: 'ja.447', side: 'ja', hex: 'yK5' }], { dice: [6, 4] });
    const s = check(engine, s0, ['a']);
    expect(piece(s, 'a').defId).toBe('ja.237r');
    expect(piece(s, 'a').tags['broken']).toBeUndefined();
  });

  it('an original 12 is a Casualty Reduction in the normal manner (8.1.4): the squad ends as a broken HS', () => {
    const { engine, state: s0 } = game([{ id: 'a', def: 'ja.447', side: 'ja', hex: 'yK5' }], { dice: [6, 6] });
    const s = check(engine, s0, ['a']);
    // ELR first (by 6: 4-4-7 → 3-4-7), then the reduction to that squad's HS, broken.
    expect(piece(s, 'a').defId).toBe('ja.137h');
    expect(piece(s, 'a').tags['broken']).toBe(true);
  });

  it('crews: 2-2-8 flips to 1-2-8r, which becomes a broken 1-2-7 crew (8.1.6)', () => {
    const { engine, state: s0 } = game([{ id: 'c', def: 'ja.228c', side: 'ja', hex: 'yK5' }], { dice: [4, 4, 4, 4] });
    let s = check(engine, s0, ['c']);
    expect(piece(s, 'c').defId).toBe('ja.128cr');
    expect(piece(s, 'c').tags['broken']).toBeUndefined();
    s = check(engine, s, ['c']);
    expect(piece(s, 'c').defId).toBe('ja.127c');
    expect(piece(s, 'c').tags['broken']).toBe(true);
  });

  it('a break from a KIA result is a step too (8.1.3), and a Reduced squad steps to its unbroken HS', () => {
    const { engine, state: s0 } = game([{ id: 'a', def: 'ja.447', side: 'ja', hex: 'yK5' }, { id: 'b', def: 'ja.347r', side: 'ja', hex: 'yK5' }]);
    let s = step(act(engine, s0, { type: 'test.break', unit: 'a' }));
    s = step(act(engine, s, { type: 'test.break', unit: 'b' }));
    expect(piece(s, 'a').defId).toBe('ja.347r');
    expect(piece(s, 'b').defId).toBe('ja.237h');
    expect(piece(s, 'b').tags['broken']).toBeUndefined();
  });

  it('a stepped squad moves and fires normally in its next Player Turn', () => {
    const { engine, state: s0 } = game([{ id: 'a', def: 'ja.447', side: 'ja', hex: 'yK5' }, { id: 'm', def: 'am.768', side: 'am', hex: 'yM5' }], { dice: [4, 4, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3] });
    let s = check(engine, s0, ['a']);
    expect(piece(s, 'a').defId).toBe('ja.347r');
    for (let guard = 0; guard < 12 && !(s.attacker === 'ja' && s.phase === 'PFPh'); guard++) s = step(act(engine, s, { type: 'endPhase' }));
    expect(s.phase).toBe('PFPh');
    events = [];
    s = step(act(engine, s, { type: 'test.fire', decl: { units: ['a'], sw: [], target: 'yM5' }, mode: 'prep' }));
    const shot = events.find((e) => e.type === 'sk1.fire.attack') as { payload: { fp: number } } | undefined;
    expect(shot?.payload.fp).toBe(3);
  });
});

describe('Japanese leaders (SK4 8.1.7)', () => {
  it('take no PTC, are wounded by a failed MC and killed by an original 12', () => {
    const { engine, state: s0 } = game([{ id: 'l', def: 'ja.L91', side: 'ja', hex: 'yK5' }, { id: 'k', def: 'ja.L80', side: 'ja', hex: 'yM5' }], { dice: [5, 5, 2, 6, 6] });
    events = [];
    let s = check(engine, s0, ['l'], 0, 'PTC');
    expect(emitted('sk4.ja.leaderPtc')).toBe(true);
    expect(piece(s, 'l').tags['pinned']).toBeUndefined();
    // MC: 10 > 9 fails; wound severity dr 2 < 5: wounded, not broken.
    s = check(engine, s, ['l'], 0);
    expect(piece(s, 'l').tags['wounds']).toBe(1);
    expect(piece(s, 'l').tags['broken']).toBeUndefined();
    expect(outcomes('l')).toEqual(['reduced']);
    // An original 12 eliminates.
    s = check(engine, s, ['k'], 0);
    expect(piece(s, 'k').loc.kind).toBe('eliminated');
  });

  it('raise the morale of Japanese MMC with them by one, and are not replaced by ELR', () => {
    const { engine, state } = game([{ id: 'l', def: 'ja.L91', side: 'ja', hex: 'yK5' }, { id: 'a', def: 'ja.447', side: 'ja', hex: 'yK5' }, { id: 'b', def: 'ja.447', side: 'ja', hex: 'yM5' }]);
    const env = engine.env(state);
    expect(env.query('unit.morale', { unit: 'a' }, 7)).toBe(8);
    expect(env.query('unit.morale', { unit: 'b' }, 7)).toBe(7);
    expect(env.query('unit.elrExempt', { unit: 'l' }, false)).toBe(true);
  });

  it('reproduce the rally example: DM ignored, the 2-3-7 HS that fails is Replaced, the crew must rally by the leader', () => {
    const broken = { broken: true, dm: true };
    const pieces: PieceSpec[] = [
      { id: 'l', def: 'ja.L91', side: 'ja', hex: 'yK5' },
      { id: 'e', def: 'ja.238h', side: 'ja', hex: 'yK5', tags: broken },
      { id: 'f', def: 'ja.237h', side: 'ja', hex: 'yK5', tags: broken },
      { id: 'c', def: 'ja.127c', side: 'ja', hex: 'yK5', tags: broken },
    ];
    // Three original 11s in jungle (woods: -1), -1 leadership, no +4 DM.
    const { engine, state: s0 } = game(pieces, { startPhase: 'RPh', firstSide: 'ja', dice: [5, 6, 5, 6, 5, 6] });
    let s = step(act(engine, s0, { type: 'test.rally', unit: 'e', leader: 'l' }));
    s = step(act(engine, s, { type: 'test.rally', unit: 'f', leader: 'l' }));
    s = step(act(engine, s, { type: 'test.rally', unit: 'c', leader: 'l' }));
    expect(piece(s, 'e').tags['broken']).toBeUndefined();
    expect(piece(s, 'f').defId).toBe('ja.137h');
    expect(piece(s, 'f').tags['broken']).toBe(true);
    expect(piece(s, 'c').tags['broken']).toBeUndefined();
    // With a 9-0 instead: the 2-3-8 is replaced by a broken 2-3-7 HS and the crew is eliminated.
    const alt = game(pieces.map((p) => (p.id === 'l' ? { ...p, def: 'ja.L90' } : p)), { startPhase: 'RPh', firstSide: 'ja', dice: [5, 6, 5, 6, 5, 6] });
    let t = act(alt.engine, alt.state, { type: 'test.rally', unit: 'e', leader: 'l' }).state;
    t = act(alt.engine, t, { type: 'test.rally', unit: 'c', leader: 'l' }).state;
    expect(piece(t, 'e').defId).toBe('ja.237h');
    expect(piece(t, 'e').tags['broken']).toBe(true);
    expect(piece(t, 'c').loc.kind).toBe('eliminated');
  });

  it('must attempt to rally every broken Japanese unit with them before the Rally Phase ends', () => {
    const { engine, state: s0 } = game([{ id: 'l', def: 'ja.L91', side: 'ja', hex: 'yK5' }, { id: 'f', def: 'ja.237h', side: 'ja', hex: 'yK5', tags: { broken: true, dm: true } }], { startPhase: 'RPh', firstSide: 'ja', dice: [2, 2] });
    events = [];
    const s = step(act(engine, s0, { type: 'endPhase' }));
    expect(events.some((e) => e.type === 'sk1.check' && (e.payload as { kind: string; unit: string }).kind === 'rally' && (e.payload as { unit: string }).unit === 'f')).toBe(true);
    expect(piece(s, 'f').tags['broken']).toBeUndefined();
  });

  it('Japanese MMC never create a leader', () => {
    const { engine, state } = game([{ id: 'a', def: 'ja.447', side: 'ja', hex: 'yK5' }, { id: 'm', def: 'am.768', side: 'am', hex: 'yK5' }]);
    const env = engine.env(state);
    expect(env.query('rally.promotes', { unit: 'a' }, true)).toBe(false);
    expect(env.query('cc.promotionBase', { units: ['a'] }, 'a')).toBeNull();
    expect(env.query('cc.promotionBase', { units: ['a', 'm'] }, 'a')).toBe('m');
  });
});

describe('Miscellaneous (SK4 8.1.8)', () => {
  it('8.1.8.1: Good Order Elite and 1st Line Japanese Infantry ambush at -1, Conscripts and Banzai units not', () => {
    const { engine, state } = game([{ id: 'a', def: 'ja.447', side: 'ja', hex: 'yK5' }, { id: 'c', def: 'ja.336', side: 'ja', hex: 'yM5' }, { id: 'z', def: 'ja.447', side: 'ja', hex: 'yO5', tags: { banzai: 'done' } }]);
    const env = engine.env(state);
    expect(env.query('cc.ambushDrm', { hex: 'yK5', side: 'ja', units: ['a'] }, 0)).toBe(-1);
    // A Conscript is Inexperienced (+1, SK1 5.4) and not Elite/1st Line: no -1.
    expect(env.query('cc.ambushDrm', { hex: 'yM5', side: 'ja', units: ['c'] }, 0)).toBe(1);
    expect(env.query('cc.ambushDrm', { hex: 'yO5', side: 'ja', units: ['z'] }, 0)).toBe(0);
  });

  it('8.1.8.2: a MMG fired by a Japanese squad has B# 10 and ROF 1, and an original 11 removes it for good', () => {
    const { engine, state: s0 } = game(
      [{ id: 'a', def: 'ja.447', side: 'ja', hex: 'yK5' }, { id: 'g', def: 'ja.MMG', side: 'ja', heldBy: 'a' }, { id: 'c', def: 'ja.228c', side: 'ja', hex: 'yO5' }, { id: 'h', def: 'ja.MMG', side: 'ja', heldBy: 'c' }, { id: 'm', def: 'am.768', side: 'am', hex: 'yM5' }],
      { firstSide: 'ja', dice: [6, 5, 3, 3, 3, 3] },
    );
    const env = engine.env(s0);
    expect(env.query('sw.breakdown', { sw: 'g', user: 'a' }, null)).toBe(10);
    expect(env.query('sw.rof', { sw: 'g', user: 'a' }, 0)).toBe(1);
    expect(env.query('sw.breakdown', { sw: 'h', user: 'c' }, null)).toBe(11);
    expect(env.query('sw.rof', { sw: 'h', user: 'c' }, 0)).toBe(2);
    const s = act(engine, s0, { type: 'test.fire', decl: { units: ['a'], sw: ['g'], target: 'yM5' }, mode: 'prep' }).state;
    expect(piece(s, 'g').loc.kind).toBe('eliminated');
    expect(piece(s, 'g').tags['malf']).toBeUndefined();
  });

  it('8.1.8.3: no PAATC, and an unbroken Japanese unit treats a LLMC as a LLTC', () => {
    const { engine, state } = game([{ id: 'a', def: 'ja.447', side: 'ja', hex: 'yK5' }, { id: 'b', def: 'ja.237h', side: 'ja', hex: 'yK5', tags: { broken: true } }, { id: 'm', def: 'am.768', side: 'am', hex: 'yM5' }]);
    const env = engine.env(state);
    expect(env.query('paatc.exempt', { unit: 'a' }, false)).toBe(true);
    expect(env.query('paatc.exempt', { unit: 'm' }, false)).toBe(false);
    expect(env.query('leaderLoss.kind', { unit: 'a', kind: 'LLMC' }, 'LLMC')).toBe('LLTC');
    expect(env.query('leaderLoss.kind', { unit: 'b', kind: 'LLMC' }, 'LLMC')).toBe('LLMC');
    expect(env.query('leaderLoss.kind', { unit: 'm', kind: 'LLMC' }, 'LLMC')).toBe('LLMC');
  });

  it('8.1.8.4: a CC the Japanese attack in is Hand-to-Hand: kill numbers two higher, -1 per Japanese attack, reverting when every Japanese unit is pinned', () => {
    const { engine, state: s0 } = game([{ id: 'a', def: 'ja.447', side: 'ja', hex: 'yK5' }, { id: 'r', def: 'ja.347r', side: 'ja', hex: 'yK5' }, { id: 'm', def: 'am.768', side: 'am', hex: 'yK5' }], { firstSide: 'ja', startPhase: 'CCPh' });
    events = [];
    const s = step(act(engine, s0, { type: 'test.ccState', hex: 'yK5', step: 'simultaneous-attacker' }));
    expect(s.hexMarkers['yK5']?.['hth']).toBe(true);
    expect(emitted('sk4.ja.handToHand')).toBe(true);
    const env = engine.env(s);
    expect(hthActive(env, 'yK5')).toBe(true);
    const pv = ccAttackPreview(env, 'yK5', 'ja', { attackers: ['a', 'r'], targets: ['m'] });
    // A Reduced-Strength squad keeps its Full-Strength CCV: 4 + 4 = 8 vs 7: 1:1.
    expect(pv.attackFp).toBe(8);
    expect(pv.odds).toBe('1:1');
    expect(pv.kill).toBe(7);
    expect(pv.drm).toBe(-1);
    // The Marines' own attack (7 vs 4: 3:2) uses the HtH chart too, without the Japanese -1.
    const back = ccAttackPreview(env, 'yK5', 'am', { attackers: ['m'], targets: ['a'] });
    expect(back.odds).toBe('3:2');
    expect(back.kill).toBe(8);
    expect(back.drm).toBe(0);
    // Every Japanese unit pinned: back to the normal chart.
    const pinned = { ...s, pieces: { ...s.pieces, a: { ...s.pieces['a']!, tags: { pinned: true } }, r: { ...s.pieces['r']!, tags: { pinned: true } } } } as GameState;
    expect(hthActive(engine.env(pinned), 'yK5')).toBe(false);
    expect(ccAttackPreview(engine.env(pinned), 'yK5', 'am', { attackers: ['m'], targets: ['a'] }).kill).toBe(6);
  });

  it('8.1.8.4: no Hand-to-Hand when the Marines attack and the Japanese neither attack nor ambush', () => {
    const { engine, state: s0 } = game([{ id: 'a', def: 'ja.447', side: 'ja', hex: 'yK5' }, { id: 'm', def: 'am.768', side: 'am', hex: 'yK5' }], { firstSide: 'am', startPhase: 'CCPh' });
    const s = act(engine, s0, { type: 'test.ccState', hex: 'yK5', step: 'simultaneous-attacker' }).state;
    expect(s.hexMarkers['yK5']?.['hth']).toBeUndefined();
    const t = act(engine, s0, { type: 'test.ccState', hex: 'yK5', step: 'ambusher', ambusher: 'ja' }).state;
    expect(t.hexMarkers['yK5']?.['hth']).toBe(true);
  });

  it('8.1.8.5: up to 10% of the on-board squad equivalents may set up HIP, not in Open Ground, SMC only with a hidden MMC', () => {
    const forces = [{ side: 'ja', units: [{ def: 'ja.447', count: 9 }, { def: 'ja.228c', count: 4 }], setup: { kind: 'area', description: 'anywhere', hexes: ['yK5', 'yM5', 'yO5'] } }];
    const pieces: PieceSpec[] = [
      { id: 'a', def: 'ja.447', side: 'ja' },
      { id: 'b', def: 'ja.447', side: 'ja' },
      { id: 'c', def: 'ja.447', side: 'ja' },
      { id: 'l', def: 'ja.L91', side: 'ja' },
    ];
    const { engine, state } = game(pieces, { forces, terrain: { yK5: { terrain: 'woods' }, yO5: { terrain: 'woods' } } });
    const env = engine.env(state);
    const todo = ['a', 'b', 'c', 'l'];
    const illegal = (hidden: string[], placements: Record<string, string>) => env.query('setup.illegal', { side: 'ja', todo, action: { type: 'setup.place', side: 'ja', decisionId: 'd', placements, hidden } as unknown as SetupAction }, null);
    const woods = { a: 'yK5', b: 'yK5', c: 'yO5', l: 'yK5' };
    // 9 + 2 = 11 squad equivalents: 10% rounded up is 2.
    expect(illegal(['a', 'b'], woods)).toBeNull();
    expect(illegal(['a', 'b', 'c'], woods)).toMatch(/Only 2 squad equivalents/);
    expect(illegal(['a'], { ...woods, a: 'yM5' })).toMatch(/Open Ground/);
    expect(illegal(['a', 'l'], woods)).toBeNull();
    expect(illegal(['l'], woods)).toMatch(/stacked with a hidden MMC/);
  });
});
