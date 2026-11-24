import { describe, expect, it } from 'vitest';
import type { Action, Engine, GameState, RuleModule } from '@asl/engine';
import { aslCoreModules, fortCounters, piecesModule, turnModule, type CounterDef, type FortPlacement } from '../../src';
import { sk1CoreModules } from '../../src/sk1';
import { sk2CoreModules } from '../../src/sk2';
import { sk3CoreModules } from '../../src/sk3';
import { act, makeEngine, type PieceSpec } from '../fixtures';

/*
 * Deployment and Recombination (ASLRB A1.3, A1.31, A1.32, A2.52, A2.8, A3.1, A5.5, A10.7, A25.2, A25.61; A4.431 with
 * its Q&A). Every unit stands in uN5 (Open Ground) unless a test says otherwise. The counters added below are the real
 * ones (the fixture set lacks them).
 */

const SK: RuleModule[] = [piecesModule, turnModule, ...sk1CoreModules, ...sk2CoreModules, ...sk3CoreModules];
const ASL: RuleModule[] = [...SK, ...aslCoreModules];

const REAL: Record<string, CounterDef> = {
  'ge.838': { id: 'ge.838', nationality: 'ge', kind: 'squad', quality: 'E', fp: 8, range: 3, morale: 8, brokenMorale: 8, selfRally: false, assaultFire: true, smoke: 3, elrExempt: true, reducesTo: 'ge.338h' },
  'ge.338h': { id: 'ge.338h', nationality: 'ge', kind: 'hs', quality: 'E', fp: 3, range: 3, morale: 8, brokenMorale: 7, selfRally: false, assaultFire: false, elrExempt: true },
  'ge.548': { id: 'ge.548', nationality: 'ge', kind: 'squad', quality: 'E', fp: 5, range: 4, morale: 8, brokenMorale: 8, selfRally: false, assaultFire: true, smoke: 2, elrExempt: false, reducesTo: 'ge.238h' },
  'ge.238h': { id: 'ge.238h', nationality: 'ge', kind: 'hs', quality: 'E', fp: 2, range: 3, morale: 8, brokenMorale: 7, selfRally: false, assaultFire: false, elrExempt: false },
  'ge.548.s': { id: 'ge.548.s', nationality: 'ge', kind: 'squad', quality: '1', fp: 5, range: 4, morale: 8, brokenMorale: 9, selfRally: false, assaultFire: true, smoke: 2, elrExempt: true, reducesTo: 'ge.238h.s' },
  'ge.238h.s': { id: 'ge.238h.s', nationality: 'ge', kind: 'hs', quality: '1', fp: 2, range: 3, morale: 8, brokenMorale: 8, selfRally: false, assaultFire: false, elrExempt: true },
  'it.447': { id: 'it.447', nationality: 'it', kind: 'squad', quality: 'E', fp: 4, range: 4, morale: 7, brokenMorale: 7, selfRally: false, assaultFire: false, smoke: 1, elrExempt: false, reducesTo: 'it.247h' },
  'it.247h': { id: 'it.247h', nationality: 'it', kind: 'hs', quality: 'E', fp: 2, range: 4, morale: 7, brokenMorale: 6, selfRally: false, assaultFire: false, elrExempt: false },
  'it.346': { id: 'it.346', nationality: 'it', kind: 'squad', quality: '1', fp: 3, range: 4, morale: 6, brokenMorale: 5, selfRally: false, assaultFire: false, elrExempt: false, reducesTo: 'it.136h' },
  'it.136h': { id: 'it.136h', nationality: 'it', kind: 'hs', quality: '1', fp: 1, range: 3, morale: 6, brokenMorale: 4, selfRally: false, assaultFire: false, elrExempt: false },
  'it.L80': { id: 'it.L80', nationality: 'it', kind: 'leader', morale: 8, brokenMorale: 8, leadership: 0, selfRally: true },
  'ge.L61': { id: 'ge.L61', nationality: 'ge', kind: 'leader', morale: 6, brokenMorale: 6, leadership: 1, selfRally: true },
  'ge.L92': { id: 'ge.L92', nationality: 'ge', kind: 'leader', morale: 9, brokenMorale: 9, leadership: -2, selfRally: true },
};

/** Test actions: fortification counters placed outright and units moved into a position or offboard. */
const testModule: RuleModule = {
  id: 'test.deploy',
  install(r) {
    r.action<Action & { fortSide: string; counters: FortPlacement[] }>({
      type: 'test.fortPlace',
      decisionKinds: ['phase'],
      resolve(ctx, a) {
        const n = fortCounters(ctx).length;
        ctx.emit('asl.fort.placed', { side: a.fortSide, counters: a.counters.map((c, i) => ({ ...c, id: `${a.fortSide}.fort${n + i + 1}`, side: a.fortSide })) });
      },
    });
    r.action<Action & { id: string; hex: string; ent?: 'foxhole'; wire?: 'on' | 'beneath'; offboard?: boolean }>({
      type: 'test.teleport',
      decisionKinds: ['phase'],
      resolve(ctx, a) {
        if (a.offboard) {
          ctx.emit('piece.moved', { id: a.id, loc: { kind: 'offboard', edge: 'E', hex: a.hex } });
          return;
        }
        const pos = { ...(a.ent ? { ent: a.ent } : {}), ...(a.wire ? { wire: a.wire } : {}) };
        ctx.emit('piece.moved', { id: a.id, loc: { kind: 'hex', hex: a.hex, ...(Object.keys(pos).length ? { pos } : {}) } });
      },
    });
  },
};

const GE_RU = { firstSide: 'ge', sides: [{ side: 'ge', name: 'German', nationality: 'ge', elr: 3 }, { side: 'ru', name: 'Russian', nationality: 'ru', elr: 3 }], forces: [] };
type Eng = Engine;
/** The full ASL Wind Change DR at the start of the RPh (B25.65): a 7 changes nothing. The Starter Kit rolls none. */
const WIND = [3, 4];
function bed(pieces: PieceSpec[], opts: { dice?: number[]; first?: string; modules?: RuleModule[]; sides?: { side: string; name: string; nationality: string; elr: number }[]; hexMarkers?: Record<string, Record<string, unknown>> } = {}) {
  const scenario = { ...GE_RU, firstSide: opts.first ?? 'ge', ...(opts.sides ? { sides: opts.sides } : {}) };
  return makeEngine({ board: 'u', scenario, modules: [...(opts.modules ?? ASL), testModule], counters: REAL, pieces, startPhase: 'RPh', ...(opts.hexMarkers ? { hexMarkers: opts.hexMarkers } : {}), ...(opts.dice ? { dice: [...(opts.modules === SK ? [] : WIND), ...opts.dice] } : {}) });
}
const check = (engine: Eng, s: GameState, a: Record<string, unknown>) => {
  const d = engine.currentDecision(s)!;
  return engine.validate(s, { side: d.owner, decisionId: d.id, ...a } as Action);
};
const offered = (engine: Eng, s: GameState, type: string) => engine.legalActions(s, engine.currentDecision(s)!.owner).filter((a) => a.type === type);
const at = (id: string, def: string, side: string, hex = 'uN5', tags?: Record<string, never>): PieceSpec => ({ id, def, side, hex, ...(tags ? { tags } : {}) });
const events = (r: { events: { type: string; payload: unknown }[] }, type: string) => r.events.filter((e) => e.type === type).map((e) => e.payload as Record<string, unknown>);
const endPhase = (engine: Eng, s: GameState) => act(engine, s, { type: 'endPhase' }).state;

describe('Who may Deploy (A25.2, A25.61; Chapter G)', () => {
  it('a Russian squad may not Deploy, but two Russian HS Recombine into their squad (A25.2)', () => {
    const { engine, state } = bed([at('r', 'ru.426', 'ru'), at('l', 'ru.L91', 'ru'), at('h1', 'ru.226', 'ru', 'uN6'), at('h2', 'ru.226', 'ru', 'uN6'), at('k', 'ru.L92', 'ru', 'uN6')], { first: 'ru' });
    expect(check(engine, state, { type: 'rally.deploy', unit: 'r', leader: 'l' })).toBe('Russian squads may not Deploy (A25.2)');
    expect(offered(engine, state, 'rally.deploy')).toEqual([]);
    const s = act(engine, state, { type: 'rally.recombine', units: ['h1', 'h2'], leader: 'k' }).state;
    expect(s.pieces['h1']!.defId).toBe('ru.426');
    expect(s.pieces['h2']!.loc.kind).toBe('eliminated');
  });

  it('only the elite Italian 4-4-7 Deploys (A25.61); the Japanese and the U.S.M.C. Deploy by Chapter G rules, not in play', () => {
    const it_ = [{ side: 'it', name: 'Italian', nationality: 'it', elr: 3 }, { side: 'ge', name: 'German', nationality: 'ge', elr: 3 }];
    const { engine, state } = bed([at('a', 'it.447', 'it'), at('b', 'it.346', 'it', 'uN6'), at('la', 'it.L80', 'it'), at('lb', 'it.L80', 'it', 'uN6')], { first: 'it', sides: it_ });
    expect(check(engine, state, { type: 'rally.deploy', unit: 'a', leader: 'la' })).toBeNull();
    expect(check(engine, state, { type: 'rally.deploy', unit: 'b', leader: 'lb' })).toBe('Only elite Italian squads (4-4-7) may Deploy (A25.61)');
    const ja = [{ side: 'ja', name: 'Japanese', nationality: 'ja', elr: 3 }, { side: 'am', name: 'American', nationality: 'am', elr: 3 }];
    const j = bed([at('j', 'ja.447', 'ja'), at('jl', 'ja.L91', 'ja'), at('m', 'am.768', 'am', 'uN6'), at('ml', 'am.L91', 'am', 'uN6')], { first: 'ja', sides: ja });
    expect(check(j.engine, j.state, { type: 'rally.deploy', unit: 'j', leader: 'jl' })).toMatch(/Chapter G rule \(G1\.16\)/);
    const m = bed([at('m', 'am.768', 'am'), at('ml', 'am.L91', 'am'), at('h1', 'am.348h', 'am', 'uN6'), at('h2', 'am.348h', 'am', 'uN6'), at('hl', 'am.L91', 'am', 'uN6')], { first: 'am', sides: [...ja].reverse() });
    expect(check(m.engine, m.state, { type: 'rally.deploy', unit: 'm', leader: 'ml' })).toMatch(/Chapter G rule \(G17\.11\)/);
    expect(check(m.engine, m.state, { type: 'rally.recombine', units: ['h1', 'h2'], leader: 'hl' })).toMatch(/Chapter G rule \(G17\.11\)/);
  });
});

describe('Deploy in the RPh (A1.31)', () => {
  it('a German 4-6-7 with the 8-0 passes its NTC (DR 7 + 0 ≤ 7) and becomes two 2-4-7 in its Location; squad, HS and leader have acted', () => {
    const { engine, state } = bed([at('g', 'ge.467', 'ge'), at('l', 'ge.L80', 'ge')], { dice: [3, 4] });
    expect(offered(engine, state, 'rally.deploy')).toMatchObject([{ unit: 'g', leader: 'l', second: [] }]);
    const r = act(engine, state, { type: 'rally.deploy', unit: 'g', leader: 'l' });
    const [ev] = events(r, 'asl.deploy');
    expect(ev).toMatchObject({ unit: 'g', leader: 'l', from: 'ge.467', to: 'ge.247', drm: 0, morale: 7, passed: true });
    const second = (ev!['halves'] as string[])[1]!;
    expect(second).toMatch(/^g\.d\d+$/);
    for (const id of ['g', second]) {
      expect(r.state.pieces[id]).toMatchObject({ defId: 'ge.247', loc: { kind: 'hex', hex: 'uN5' } });
      expect(r.state.pieces[id]!.tags).toMatchObject({ rphAction: 'deploy', deployedFrom: 'ge.467' });
    }
    expect(r.state.pieces['l']!.tags['rphAction']).toBe('deploy');
    expect(events(r, 'sk1.casualty')).toEqual([]);
  });

  it('a 6+1 directs at +1, "even if 0 or +1" (A10.7): DR 7 + 1 > 7 fails, and the squad stays whole', () => {
    const { engine, state } = bed([at('g', 'ge.467', 'ge'), at('l', 'ge.L61', 'ge')], { dice: [3, 4] });
    const r = act(engine, state, { type: 'rally.deploy', unit: 'g', leader: 'l' });
    expect(events(r, 'asl.deploy')).toMatchObject([{ drm: 1, passed: false }]);
    expect(r.state.pieces['g']!.defId).toBe('ge.467');
    expect(r.state.pieces['g']!.tags['rphAction']).toBe('deploy');
    expect(r.state.pieces['l']!.tags['rphAction']).toBe('deploy');
  });

  it('a leader directs one squad per RPh; pass or fail, neither he nor the squad may rally, recover or repair that RPh (A1.31, A10.7)', () => {
    const pieces = [at('g', 'ge.467', 'ge'), at('h', 'ge.447', 'ge'), at('l', 'ge.L80', 'ge'), at('b', 'ge.447', 'ge', 'uN5', { broken: true } as never), { id: 'lmg', def: 'ge.LMG', side: 'ge', hex: 'uN5' }];
    const { engine, state } = bed(pieces, { dice: [6, 6] });
    expect(offered(engine, state, 'rally.deploy').map((a) => a['unit'])).toEqual(['g', 'h']);
    const s = act(engine, state, { type: 'rally.deploy', unit: 'g', leader: 'l' }).state;
    expect(s.pieces['g']!.defId).toBe('ge.467');
    expect(check(engine, s, { type: 'rally.deploy', unit: 'h', leader: 'l' })).toMatch(/directed a Deployment.*\(A1\.31, A10\.7\)/);
    expect(offered(engine, s, 'rally.deploy')).toEqual([]);
    expect(check(engine, s, { type: 'rally.rally', leader: 'l', unit: 'b' })).toMatch(/directed a Deployment this RPh: one action per phase \(A10\.7\)/);
    expect(offered(engine, s, 'rally.rally')).toEqual([]);
    expect(check(engine, s, { type: 'rally.recover', unit: 'g', sw: 'lmg' })).toMatch(/attempted to Deploy this RPh: one action per RPh \(A3\.1\)/);
    expect(check(engine, s, { type: 'rally.recover', unit: 'l', sw: 'lmg' })).toMatch(/A10\.7/);
  });

  it('a squad that rallied may not Deploy, even under another leader (A3.1 EX)', () => {
    const { engine, state } = bed([at('g', 'ge.467', 'ge', 'uN5', { broken: true } as never), at('l', 'ge.L91', 'ge'), at('k', 'ge.L80', 'ge')], { dice: [2, 2] });
    const s = act(engine, state, { type: 'rally.rally', leader: 'l', unit: 'g' }).state;
    expect(s.pieces['g']!.tags['broken']).toBeUndefined();
    expect(check(engine, s, { type: 'rally.deploy', unit: 'g', leader: 'k' })).toBe('It rallied this RPh, so it may not also Deploy (A3.1 EX)');
    // The leader who rallied may rally more units (one action), but not direct a Deployment.
    expect(s.pieces['l']!.tags['rphAction']).toBe('rally');
  });

  it('the 8-3-8 shares its FT and DC between its two HS, one each by default, or as the player arranges them (A1.31)', () => {
    const pieces: PieceSpec[] = [at('g', 'ge.838', 'ge'), { id: 'w1', def: 'ge.FT', side: 'ge', heldBy: 'g' }, { id: 'w2', def: 'ge.DC', side: 'ge', heldBy: 'g' }, at('l', 'ge.L92', 'ge')];
    const { engine, state } = bed(pieces, { dice: [5, 5, 5, 5] });
    const [offer] = offered(engine, state, 'rally.deploy');
    expect(offer).toMatchObject({ unit: 'g', leader: 'l', second: ['w2'] });
    const r = act(engine, state, offer!);
    const second = (events(r, 'asl.deploy')[0]!['halves'] as string[])[1]!;
    expect(r.state.pieces['g']!.defId).toBe('ge.338h');
    expect(r.state.pieces['w1']!.loc).toEqual({ kind: 'held', by: 'g' });
    expect(r.state.pieces['w2']!.loc).toEqual({ kind: 'held', by: second });
    // Everything with the first HS, if he says so; never a weapon the squad does not hold.
    const b = bed(pieces, { dice: [5, 5] });
    expect(check(b.engine, b.state, { type: 'rally.deploy', unit: 'g', leader: 'l', second: ['l'] })).toMatch(/only the squad’s own weapons/);
    const r2 = act(b.engine, b.state, { type: 'rally.deploy', unit: 'g', leader: 'l', second: [] });
    expect(r2.state.pieces['w2']!.loc).toEqual({ kind: 'held', by: 'g' });
  });

  it('the DEFENDER is not offered a Deployment, nor may he make one (ASOP 1.21A)', () => {
    const { engine, state } = bed([at('g', 'ge.467', 'ge'), at('l', 'ge.L80', 'ge'), at('r', 'ru.447', 'ru', 'uA1')], { first: 'ru' });
    const s = endPhase(engine, state);
    expect(engine.currentDecision(s)!.owner).toBe('ge');
    expect(offered(engine, s, 'rally.deploy')).toEqual([]);
    expect(check(engine, s, { type: 'rally.deploy', unit: 'g', leader: 'l' })).toBe('Only the ATTACKER Deploys, in his own RPh (A1.31; ASOP 1.21A)');
  });

  it('a squad beneath a foxhole becomes two HS beneath it, its Labor on both; in Melee it may not Deploy (not Good Order)', () => {
    const { engine, state } = bed([at('g', 'ge.467', 'ge', 'uN5', { labor: 'entrench:uN5@-1' } as never), at('l', 'ge.L80', 'ge'), at('x', 'ge.447', 'ge', 'uN7'), at('k', 'ge.L80', 'ge', 'uN7'), at('r', 'ru.447', 'ru', 'uN7')], { dice: [2, 2], hexMarkers: { uN7: { melee: true } } });
    let s = act(engine, state, { type: 'test.fortPlace', fortSide: 'ge', counters: [{ kind: 'foxhole', hex: 'uN5', hidden: false, capacity: 2 }] }).state;
    s = act(engine, s, { type: 'test.teleport', id: 'g', hex: 'uN5', ent: 'foxhole' }).state;
    s = act(engine, s, { type: 'test.teleport', id: 'l', hex: 'uN5', ent: 'foxhole' }).state;
    expect(check(engine, s, { type: 'rally.deploy', unit: 'x', leader: 'k' })).toBe('Only a Good Order squad Deploys (A1.31)');
    const r = act(engine, s, { type: 'rally.deploy', unit: 'g', leader: 'l' });
    const second = (events(r, 'asl.deploy')[0]!['halves'] as string[])[1]!;
    for (const id of ['g', second]) {
      expect(r.state.pieces[id]!.loc).toEqual({ kind: 'hex', hex: 'uN5', pos: { ent: 'foxhole' } });
      expect(r.state.pieces[id]!.tags['labor']).toBe('entrench:uN5@-1');
    }
  });

  it('a hidden squad and its leader are placed on the board to Deploy (Q&A to A1.31 & A12.3)', () => {
    const { engine, state } = bed([at('g', 'ge.467', 'ge', 'uN5', { hip: true } as never), at('l', 'ge.L80', 'ge', 'uN5', { hip: true } as never)], { dice: [6, 6] });
    expect(check(engine, state, { type: 'rally.deploy', unit: 'g', leader: 'l' })).toBeNull();
    const r = act(engine, state, { type: 'rally.deploy', unit: 'g', leader: 'l' });
    expect(events(r, 'sk2.hip.unitRevealed').map((e) => e['unit'])).toEqual(['g', 'l']);
    expect(r.state.pieces['g']!.tags['hip']).toBeUndefined();
    expect(r.state.pieces['l']!.tags['hip']).toBeUndefined();
  });

  it('an offboard squad stacked with a leader may Deploy in its RPh; both HS wait offboard to enter (A2.52)', () => {
    const { engine, state } = bed([at('g', 'ge.467', 'ge'), at('l', 'ge.L80', 'ge'), at('h', 'ge.447', 'ge')], { dice: [2, 2] });
    let s = state;
    for (const id of ['g', 'l']) s = act(engine, s, { type: 'test.teleport', id, hex: 'uHH5', offboard: true }).state;
    s = act(engine, s, { type: 'test.teleport', id: 'h', hex: 'uHH6', offboard: true }).state;
    expect(offered(engine, s, 'rally.deploy').map((a) => a['unit'])).toEqual(['g']);
    const r = act(engine, s, { type: 'rally.deploy', unit: 'g', leader: 'l' });
    const ev = events(r, 'asl.deploy')[0]!;
    expect(ev).toMatchObject({ passed: true, offboard: true });
    expect(r.state.pieces[(ev['halves'] as string[])[1]!]!.loc).toEqual({ kind: 'offboard', edge: 'E', hex: 'uHH5' });
  });
});

describe('Recombine (A1.32)', () => {
  it('two Russian 2-2-6 with a leader become a 4-2-6, the second HS no casualty; squad and leader have acted', () => {
    const pieces: PieceSpec[] = [at('a', 'ru.226', 'ru'), at('b', 'ru.226', 'ru'), { id: 'mg', def: 'ru.LMG', side: 'ru', heldBy: 'b' }, at('l', 'ru.L91', 'ru', 'uN5', { stackedOn: 'b' } as never), at('x', 'ru.447', 'ru', 'uN5', { broken: true } as never)];
    const { engine, state } = bed(pieces, { first: 'ru' });
    expect(offered(engine, state, 'rally.recombine')).toMatchObject([{ units: ['a', 'b'], leader: 'l' }]);
    const r = act(engine, state, { type: 'rally.recombine', units: ['a', 'b'], leader: 'l' });
    expect(r.state.pieces['a']!.defId).toBe('ru.426');
    expect(r.state.pieces['b']).toMatchObject({ loc: { kind: 'eliminated' }, tags: { recombined: true } });
    expect(r.state.pieces['mg']!.loc).toEqual({ kind: 'held', by: 'a' });
    expect(r.state.pieces['l']!.tags).toMatchObject({ rphAction: 'recombine', stackedOn: 'a' });
    expect(r.state.pieces['a']!.tags['rphAction']).toBe('recombine');
    expect(events(r, 'sk1.casualty')).toEqual([]);
    expect(events(r, 'asl.recombined')).toEqual([{ squad: 'a', removed: 'b', leader: 'l', from: 'ru.226', to: 'ru.426' }]);
    // His sole activity is permitting Recombinations: he may not rally the broken squad now.
    expect(check(engine, r.state, { type: 'rally.rally', leader: 'l', unit: 'x' })).toMatch(/permitted a Recombination this RPh: one action per phase \(A10\.7\)/);
  });

  it('the DEFENDER recombines in the ATTACKER’s RPh (ASOP 1.13B)', () => {
    const { engine, state } = bed([at('a', 'ru.226', 'ru'), at('b', 'ru.226', 'ru'), at('l', 'ru.L91', 'ru'), at('g', 'ge.467', 'ge', 'uA1')]);
    expect(offered(engine, state, 'rally.recombine')).toEqual([]);
    const s = endPhase(engine, state);
    expect(engine.currentDecision(s)!.owner).toBe('ru');
    expect(offered(engine, s, 'rally.recombine')).toHaveLength(1);
    expect(act(engine, s, { type: 'rally.recombine', units: ['a', 'b'], leader: 'l' }).state.pieces['a']!.defId).toBe('ru.426');
  });

  it('refused, each with its reason: other Strength Factors, other Class or type, apart across the foxhole rim, the leader in other terrain, no leader, a leader who rallied', () => {
    const pieces: PieceSpec[] = [
      at('a', 'ru.226', 'ru', 'uN4'), at('b', 'ru.237', 'ru', 'uN4'), at('la', 'ru.L91', 'ru', 'uN4'),
      at('g1', 'ge.238h', 'ge', 'uN6'), at('g2', 'ge.238h.s', 'ge', 'uN6'), at('lg', 'ge.L80', 'ge', 'uN6'),
      at('c', 'ru.226', 'ru', 'uN5'), at('d', 'ru.226', 'ru', 'uN5'), at('lc', 'ru.L91', 'ru', 'uN5'),
      at('e', 'ru.226', 'ru', 'uN7'), at('f', 'ru.226', 'ru', 'uN7'),
      at('h', 'ru.226', 'ru', 'uN8'), at('i', 'ru.226', 'ru', 'uN8'), at('lh', 'ru.L91', 'ru', 'uN8'), at('y', 'ru.447', 'ru', 'uN8', { broken: true } as never),
    ];
    const { engine, state } = bed(pieces, { first: 'ru', dice: [6, 6] });
    expect(check(engine, state, { type: 'rally.recombine', units: ['a', 'b'], leader: 'la' })).toBe('Different Strength Factors (2-2-6, 2-3-7) (A1.32)');
    expect(check(engine, state, { type: 'rally.recombine', units: ['e', 'f'], leader: 'la' })).toBe('No Good Order leader in the Location (A1.32)');
    let s = act(engine, state, { type: 'test.fortPlace', fortSide: 'ru', counters: [{ kind: 'foxhole', hex: 'uN5', hidden: false, capacity: 2 }] }).state;
    s = act(engine, s, { type: 'test.teleport', id: 'c', hex: 'uN5', ent: 'foxhole' }).state;
    expect(check(engine, s, { type: 'rally.recombine', units: ['c', 'd'], leader: 'lc' })).toBe('One is beneath the entrenchment, the other is not (A1.32, A2.8)');
    s = act(engine, s, { type: 'test.teleport', id: 'd', hex: 'uN5', ent: 'foxhole' }).state;
    expect(check(engine, s, { type: 'rally.recombine', units: ['c', 'd'], leader: 'lc' })).toBe('The leader must share their terrain: he is outside it (A1.32, A2.8)');
    s = act(engine, s, { type: 'test.teleport', id: 'lc', hex: 'uN5', ent: 'foxhole' }).state;
    expect(check(engine, s, { type: 'rally.recombine', units: ['c', 'd'], leader: 'lc' })).toBeNull();
    s = act(engine, s, { type: 'rally.rally', leader: 'lh', unit: 'y' }).state;
    expect(check(engine, s, { type: 'rally.recombine', units: ['h', 'i'], leader: 'lh' })).toMatch(/already rallied this RPh: permitting Recombination must be his sole activity in the RPh \(A1\.32, A10\.7\)/);
    // A German and an SS 2-3-8 have no common squad (A1.3: the HS is its own Class and type); two plain ones give a 5-4-8.
    const ge = bed(pieces, { first: 'ge' });
    expect(check(ge.engine, ge.state, { type: 'rally.recombine', units: ['g1', 'g2'], leader: 'lg' })).toBe('Different Class or type: only half-squads of the same Class and type Recombine (A1.3, A1.32)');
  });

  it('the leader permits two Recombinations in his Location, then may do nothing else (A1.32)', () => {
    const pieces = [at('a', 'ge.238h', 'ge'), at('b', 'ge.238h', 'ge'), at('c', 'ge.247', 'ge'), at('d', 'ge.247', 'ge'), at('l', 'ge.L80', 'ge'), { id: 'lmg', def: 'ge.LMG', side: 'ge', hex: 'uN5' }];
    const { engine, state } = bed(pieces);
    let s = act(engine, state, { type: 'rally.recombine', units: ['a', 'b'], leader: 'l' }).state;
    expect(s.pieces['a']!.defId).toBe('ge.548');
    s = act(engine, s, { type: 'rally.recombine', units: ['c', 'd'], leader: 'l' }).state;
    expect(s.pieces['c']!.defId).toBe('ge.467');
    expect(check(engine, s, { type: 'rally.recover', unit: 'l', sw: 'lmg' })).toMatch(/A10\.7/);
    expect(check(engine, s, { type: 'rally.recover', unit: 'a', sw: 'lmg' })).toMatch(/recombined this RPh/);
  });
});

describe('One action per leader per phase, and Transfer an action (A10.7, A4.431)', () => {
  it('a leader rallies any number of units as one action, and may not then recover a SW', () => {
    const pieces = [at('x', 'ge.447', 'ge', 'uN5', { broken: true } as never), at('y', 'ge.447', 'ge', 'uN5', { broken: true } as never), at('z', 'ge.467', 'ge', 'uN5', { broken: true } as never), at('l', 'ge.L92', 'ge'), { id: 'lmg', def: 'ge.LMG', side: 'ge', hex: 'uN5' }];
    const { engine, state } = bed(pieces, { dice: [3, 3, 3, 3, 3, 3] });
    const s = act(engine, state, { type: 'rally.rallyAll', leader: 'l' }).state;
    expect(['x', 'y', 'z'].map((id) => s.pieces[id]!.tags['broken'])).toEqual([undefined, undefined, undefined]);
    expect(check(engine, s, { type: 'rally.recover', unit: 'l', sw: 'lmg' })).toBe('The leader already rallied this RPh: one action per phase (A10.7)');
  });

  it('HS that transferred a SW may not Recombine; a leader who transferred may not rally (Q&A to A4.431; to A3.1 & A4.431)', () => {
    const pieces: PieceSpec[] = [at('a', 'ge.247', 'ge'), at('b', 'ge.247', 'ge'), { id: 'mg', def: 'ge.LMG', side: 'ge', heldBy: 'a' }, at('l', 'ge.L80', 'ge'), at('k', 'ge.L91', 'ge'), { id: 'm2', def: 'ge.LMG', side: 'ge', heldBy: 'k' }, at('x', 'ge.447', 'ge', 'uN5', { broken: true } as never)];
    const { engine, state } = bed(pieces);
    let s = act(engine, state, { type: 'rally.transfer', sw: 'mg', to: 'b' }).state;
    expect(s.pieces['a']!.tags['rphAction']).toBe('transfer');
    expect(s.pieces['b']!.tags['rphAction']).toBe('transfer');
    expect(check(engine, s, { type: 'rally.recombine', units: ['a', 'b'], leader: 'l' })).toMatch(/transferred a SW this RPh: Recombining must be their sole action/);
    // More Transfers are the same action.
    expect(check(engine, s, { type: 'rally.transfer', sw: 'mg', to: 'a' })).toBeNull();
    s = act(engine, s, { type: 'rally.transfer', sw: 'm2', to: 'l' }).state;
    expect(check(engine, s, { type: 'rally.rally', leader: 'k', unit: 'x' })).toBe('The leader already transferred a SW this RPh: one action per phase (A10.7)');
  });

  it('the Starter Kit still lets a leader rally and then recover (SK1 3.1: "Other than leaders rallying")', () => {
    const pieces = [at('x', 'ge.447', 'ge', 'uN5', { broken: true } as never), at('l', 'ge.L91', 'ge'), { id: 'lmg', def: 'ge.LMG', side: 'ge', hex: 'uN5' }, at('a', 'ge.247', 'ge'), at('b', 'ge.247', 'ge'), { id: 'mg', def: 'ge.MMG', side: 'ge', heldBy: 'a' }];
    const { engine, state } = bed(pieces, { modules: SK, dice: [3, 3] });
    let s = act(engine, state, { type: 'rally.rally', leader: 'l', unit: 'x' }).state;
    expect(s.pieces['l']!.tags['rphAction']).toBeUndefined();
    expect(check(engine, s, { type: 'rally.recover', unit: 'l', sw: 'lmg' })).toBeNull();
    s = act(engine, s, { type: 'rally.transfer', sw: 'mg', to: 'b' }).state;
    expect(s.pieces['a']!.tags['rphAction']).toBeUndefined();
    expect(offered(engine, s, 'rally.deploy')).toEqual([]);
  });
});

describe('A5.5: HS for a hidden squad only where the nationality may Deploy', () => {
  it('two Russian HS count as two squads against a hidden-units quota; two German HS as one', () => {
    const { engine, state } = bed([at('a', 'ru.226', 'ru'), at('b', 'ru.226', 'ru'), at('c', 'ge.247', 'ge'), at('d', 'ge.247', 'ge')]);
    const env = engine.env(state);
    expect(env.query('hidden.quotaSquadEquivalents', { units: ['a', 'b'] }, 1)).toBe(2);
    expect(env.query('hidden.quotaSquadEquivalents', { units: ['c', 'd'] }, 1)).toBe(1);
    const sk = bed([at('a', 'ru.226', 'ru'), at('b', 'ru.226', 'ru')], { modules: SK });
    expect(sk.engine.env(sk.state).query('hidden.quotaSquadEquivalents', { units: ['a', 'b'] }, 1)).toBe(1);
  });
});
