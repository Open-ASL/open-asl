import { describe, expect, it } from 'vitest';
import type { Action, Engine, GameState, RuleModule } from '@asl/engine';
import { aslCoreModules, dashIllegal, dashOptions, moveState, piecesModule, shotContext, turnModule, type HexTerrainSpec } from '../../src';
import { sk1CoreModules } from '../../src/sk1';
import { sk2CoreModules } from '../../src/sk2';
import { sk3CoreModules } from '../../src/sk3';
import { GE_VS_BR, act, makeEngine, type PieceSpec } from '../fixtures';

/*
 * Dash (ASLRB A4.63, A10.531, A8.15 EX, A8.2; Case J). Board u: a road runs north–south through uP4–uP5–uP6 (Open Ground
 * road hexes). uO5 and uQ5 are woods beside it, on opposite sides of the road in uP5 (uO5 west, uQ5 east); uQ6 is Open
 * Ground east of the road. The Germans Dash from uO5 across uP5; the British 4-5-7 in uP9 looks straight up the road.
 */

const SK: RuleModule[] = [piecesModule, turnModule, ...sk1CoreModules, ...sk2CoreModules, ...sk3CoreModules];
const ASL: RuleModule[] = [...SK, ...aslCoreModules];
const road = { terrain: 'open', features: ['road:dirt'] };
const GROUND: Record<string, HexTerrainSpec> = { uP4: road, uP5: road, uP6: road, uO5: { terrain: 'woods' }, uQ5: { terrain: 'woods' } };
const ROADS: [string, string][] = [['uP4', 'uP5'], ['uP5', 'uP6']];

const testModule: RuleModule = {
  id: 'test.dash',
  install(r) {
    r.action<Action & { id: string; tags: Record<string, unknown> }>({
      type: 'test.tag',
      decisionKinds: ['phase', 'firstFire'],
      resolve(ctx, a) {
        ctx.emit('piece.tagged', { id: a.id, tags: a.tags as Record<string, never> });
      },
    });
  },
};

function game(pieces: PieceSpec[], opts: { asl?: boolean; dice?: number[]; terrain?: Record<string, HexTerrainSpec>; hexMarkers?: Record<string, Record<string, unknown>> } = {}) {
  return makeEngine({ board: 'u', terrain: { ...GROUND, ...opts.terrain }, roadHexsides: ROADS, scenario: GE_VS_BR, modules: opts.asl === false ? SK : ASL, extra: [testModule], startPhase: 'MPh', pieces, dice: opts.dice ?? [], ...(opts.hexMarkers ? { hexMarkers: opts.hexMarkers } : {}) });
}
const squad = (id = 'g', hex = 'uO5'): PieceSpec => ({ id, def: 'ge.467', side: 'ge', hex });
const watcher: PieceSpec = { id: 'b', def: 'br.457', side: 'br', hex: 'uP9' };
const check = (engine: Engine, s: GameState, a: Record<string, unknown>) => {
  const d = engine.currentDecision(s)!;
  return engine.validate(s, { side: d.owner, decisionId: d.id, ...a } as never);
};
const passAll = (engine: Engine, s0: GameState) => {
  let s = s0;
  for (let i = 0; i < 20 && engine.currentDecision(s)?.owner === 'br' && engine.currentDecision(s)?.kind !== 'phase'; i++) s = act(engine, s, { type: 'defPass' }).state;
  return s;
};
type Ev = { type: string; payload: unknown }[];
const attackOf = (events: Ev) => events.find((e) => e.type === 'sk1.fire.attack')?.payload as { fp: number; explain: { label?: string }[]; fpExplain?: { label?: string }[] };
const dashTo = (engine: Engine, state: GameState, units: string[], to = 'uQ5') => act(engine, act(engine, state, { type: 'move.start', units }).state, { type: 'move.dash', road: 'uP5', to });
const fireB = { type: 'defFire', decl: { units: ['b'], sw: [], target: 'uP5' } };

describe('A4.63 Dash: the declaration', () => {
  it('the two-hex cost counts the overstacking MF of the hex it ends in (A5.11, A4.63)', () => {
    const three = ['x1', 'x2', 'x3'].map((id): PieceSpec => ({ id, def: 'ge.467', side: 'ge', hex: 'uQ5' }));
    const { engine, state } = game([squad(), watcher, ...three]);
    const s = act(engine, state, { type: 'move.start', units: ['g'] }).state;
    expect(dashOptions(engine.env(s)).filter((o) => o.road === 'uP5' && o.to === 'uQ5')).toEqual([{ road: 'uP5', to: 'uQ5', cost: 4, openGround: false }]);
  });

  it('offered to a stack beside the road that has spent no MF: the end hexes beyond the road with the two-hex cost', () => {
    const { engine, state } = game([squad(), watcher]);
    const s = act(engine, state, { type: 'move.start', units: ['g'] }).state;
    expect(dashOptions(engine.env(s)).filter((o) => o.road === 'uP5')).toEqual([
      { road: 'uP5', to: 'uQ5', cost: 3, openGround: false },
      { road: 'uP5', to: 'uQ6', cost: 2, openGround: true },
    ]);
  });

  it('the route crosses the road: not to the same side, not along it; never after other MF, never in the Starter Kit (A4.63; Q&A on the board 4 diagram)', () => {
    const { engine, state } = game([squad(), watcher]);
    let s = act(engine, state, { type: 'move.start', units: ['g'] }).state;
    const env = engine.env(s);
    expect(dashIllegal(env, 'uP5', 'uO6')).toMatch(/same side of the road/);
    expect(dashIllegal(env, 'uP5', 'uP6')).toMatch(/may not go on along it/);
    expect(dashIllegal(env, 'uO6', 'uP6')).toMatch(/not a road hex/);
    s = passAll(engine, act(engine, s, { type: 'move.step', to: 'uO6' }).state);
    expect(check(engine, s, { type: 'move.dash', road: 'uP6', to: 'uQ6' })).toMatch(/Already spent MF/);
    const sk = game([squad(), watcher], { asl: false });
    expect(() => dashTo(sk.engine, sk.state, ['g'])).toThrow();
  });

  it('after a SMOKE grenade attempt it may still be declared (A4.63 EXC, A24.1)', () => {
    // Smoke dr 1: placed in uO5.
    const { engine, state } = game([squad(), watcher], { dice: [1] });
    let s = act(engine, state, { type: 'move.start', units: ['g'] }).state;
    s = passAll(engine, act(engine, s, { type: 'move.smoke', unit: 'g', target: 'uO5' }).state);
    expect(check(engine, s, { type: 'move.dash', road: 'uP5', to: 'uQ5' })).toBeNull();
  });

  it('the whole stack Dashes into the road hex; the next step can only be the declared Location, and its MPh ends there', () => {
    const { engine, state } = game([squad('g'), { id: 'l', def: 'ge.L91', side: 'ge', hex: 'uO5' }, watcher]);
    const r = dashTo(engine, state, ['g', 'l']);
    expect(r.events.find((e) => e.type === 'asl.move.dash')?.payload).toEqual({ units: ['g', 'l'], from: 'uO5', road: 'uP5', to: 'uQ5' });
    let s = passAll(engine, r.state);
    expect(moveState(engine.env(s))).toMatchObject({ hex: 'uP5', dash: { from: 'uO5', road: 'uP5', to: 'uQ5' } });
    expect(check(engine, s, { type: 'move.step', to: 'uQ6' })).toBe('Dashing to uQ5 (ASLRB A4.63)');
    expect(check(engine, s, { type: 'move.end' })).toMatch(/Dashing to uQ5/);
    expect(check(engine, s, { type: 'move.smoke', unit: 'g', target: 'uP5' })).toMatch(/Dashing/);
    s = passAll(engine, act(engine, s, { type: 'move.step', to: 'uQ5' }).state);
    expect(moveState(engine.env(s))).toBeFalsy();
    expect(s.pieces['g']!.loc).toMatchObject({ hex: 'uQ5' });
  });
});

describe('A4.63 Dash: the DEFENDER\'s First Fire', () => {
  it('non-ordnance First Fire at the Dashing unit in the road is Area Fire (×½); FFNAM and FFMO apply normally', () => {
    const { engine, state } = game([squad(), watcher], { dice: [6, 6] });
    const r = act(engine, dashTo(engine, state, ['g']).state, fireB);
    const a = attackOf(r.events);
    expect(a.fp).toBe(2);
    expect((a.fpExplain ?? []).map((n) => n.label)).toContain('×½ Dash (Area Fire, ASLRB A4.63)');
    expect(a.explain.map((n) => n.label)).toEqual(expect.arrayContaining(['-1 FFNAM', '-1 FFMO']));
  });

  it('a Snap Shot at the hexside into the road is quartered, without FFNAM or FFMO (A8.15 EX; Q&A to A4.63 & A8.15)', () => {
    const { engine, state } = game([squad(), watcher], { dice: [6, 6] });
    const r = act(engine, dashTo(engine, state, ['g']).state, { type: 'defFire', decl: { units: ['b'], sw: [], target: 'uP5', snap: ['uP5', 'uO5'] } });
    const a = attackOf(r.events);
    expect(a.fp).toBe(1);
    expect(a.explain.map((n) => n.label)).not.toContain('-1 FFNAM');
    expect(a.explain.map((n) => n.label)).not.toContain('-1 FFMO');
  });

  it('a firer that sees the end hex as Open Ground gets no halving (A4.63 EX 1, A10.531)', () => {
    const { engine, state } = game([squad(), watcher], { dice: [6, 6] });
    const r = act(engine, dashTo(engine, state, ['g'], 'uQ6').state, fireB);
    expect(attackOf(r.events).fp).toBe(4);
  });

  it('pre-existing Residual FP in the road hex is never halved (A8.2)', () => {
    const { engine, state } = game([squad(), watcher], { dice: [6, 6], hexMarkers: { uP5: { residualFp: 4 } } });
    const r = dashTo(engine, state, ['g']);
    expect(attackOf(r.events)).toMatchObject({ fp: 4 });
  });

  it('a Gun that must change its CA may not fire at the Dashing unit in the road; one in arc takes Case J (+2) without FFNAM/FFMO', () => {
    const gunPieces: PieceSpec[] = [squad(), { id: 'bc', def: 'br.228c', side: 'br', hex: 'uP9' }, { id: 'gun', def: 'br.AT57L', side: 'br', heldBy: 'bc', tags: { ca: 4 } }];
    const { engine, state } = game(gunPieces);
    const s = dashTo(engine, state, ['g']).state;
    const env = engine.env(s);
    const shot = (ca?: number) => ({ weapon: 'gun', target: 'uP5', targetType: 'ITT' as const, ...(ca !== undefined ? { ca } : {}) });
    expect(env.query('ordnance.illegal', { shot: shot(5), mode: 'first', side: 'br', moving: ['g'] }, null)).toBe('Must change CA to fire at a Dashing unit (ASLRB A4.63)');
    const sc = shotContext(env, shot(), 'first', 'br', { moving: ['g'], movingInfo: { assault: false, viaRoadIntoWoodsRoad: false } });
    const labels = env.explain('ordnance.thDrm', sc, 0).trace.filter((t) => !t.suppressedBy && t.label).map((t) => String(t.label));
    expect(labels).toContain('+2 Case J Dashing Infantry (ASLRB A4.63)');
    expect(labels).not.toContain('-1 FFNAM');
    expect(labels).not.toContain('-1 FFMO');
  });
});

describe('A4.63 Dash: benefits that cease', () => {
  it('a hidden unit in the end hex: the stack stays in the road, its MPh over, and First Fire at it there is not halved (A4.63, A12.15)', () => {
    const { engine, state } = game([squad(), watcher, { id: 'h', def: 'br.457', side: 'br', hex: 'uQ5', tags: { hip: true } }], { dice: [6, 6] });
    let s = passAll(engine, dashTo(engine, state, ['g']).state);
    s = act(engine, s, { type: 'move.step', to: 'uQ5' }).state;
    expect(s.pieces['g']!.loc).toMatchObject({ hex: 'uP5' });
    expect(moveState(engine.env(s))).toMatchObject({ hex: 'uP5', halted: true });
    expect(attackOf(act(engine, s, fireB).events).fp).toBe(4);
  });

  it('the leader breaks in the road: the squad, short of MF for the uphill woods without his bonus, Double Times to go on (A4.63 EX 2)', () => {
    // uQ5 is woods on a level-1 hill: 4 MF from the road. With the 9-1: 1 + 4 ≤ 6.
    const { engine, state } = game([squad('g'), { id: 'l', def: 'ge.L91', side: 'ge', hex: 'uO5' }, watcher], { dice: [6, 6], terrain: { uQ5: { terrain: 'woods', elevation: 1 } } });
    let s = dashTo(engine, state, ['g', 'l']).state;
    s = act(engine, s, { type: 'test.tag', id: 'l', tags: { broken: true } }).state;
    s = passAll(engine, act(engine, s, fireB).state);
    const ms = moveState(engine.env(s))!;
    expect(ms.units).toEqual(['g']);
    expect(ms.allowance['g']).toBe(4);
    expect(check(engine, s, { type: 'move.step', to: 'uQ5' })).toMatch(/lacks the MF \(3\)/);
    s = act(engine, s, { type: 'move.doubleTime', units: ['g'] }).state;
    s = passAll(engine, act(engine, s, { type: 'move.step', to: 'uQ5' }).state);
    expect(s.pieces['g']!.loc).toMatchObject({ hex: 'uQ5' });
  });

  it('across turns: no halving in the DFPh, and the squad moves normally in its next MPh with no Dash left', () => {
    const { engine, state } = game([squad(), watcher], { dice: [6, 6, 6, 6] });
    let s = passAll(engine, dashTo(engine, state, ['g']).state);
    s = passAll(engine, act(engine, s, { type: 'move.step', to: 'uQ5' }).state);
    for (let i = 0; i < 10 && s.phase !== 'DFPh'; i++) s = passAll(engine, act(engine, s, { type: 'endPhase' }).state);
    expect(s.phase).toBe('DFPh');
    const r = act(engine, s, { type: 'fire', decl: { units: ['b'], sw: [], target: 'uQ5' } });
    expect(attackOf(r.events).fp).toBe(4);
    s = r.state;
    for (let i = 0; i < 60 && !(s.attacker === 'ge' && s.phase === 'MPh'); i++) {
      const d = engine.currentDecision(s)!;
      const legal = engine.legalActions(s, d.owner);
      const pick = d.kind === 'phase' ? (legal.find((x) => x.type === 'endPhase') ?? legal.find((x) => x.type === 'move.end')) : legal.find((x) => x.type === 'defPass');
      s = act(engine, s, pick ?? legal[0]!).state;
    }
    s = act(engine, s, { type: 'move.start', units: ['g'] }).state;
    expect(moveState(engine.env(s))!.dash).toBeUndefined();
    s = passAll(engine, act(engine, s, { type: 'move.step', to: 'uQ4' }).state);
    expect(s.pieces['g']!.loc).toMatchObject({ hex: 'uQ4' });
  });
});
