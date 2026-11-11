import { describe, expect, it } from 'vitest';
import type { Action, Ctx, Engine, GameState, RuleModule } from '@asl/engine';
import { COLLAPSED_HUT, FP, moveState, ptoModule, sk2CoreModules, sk3CoreModules, type FireDeclaration, type FireMode, type ResolveFireFn } from '../../src';
import { RU_VS_GE, act, makeEngine, type PieceSpec } from '../fixtures';

/** Test-only action: resolve a fire declaration in a given mode. */
const testFire: RuleModule = {
  id: 'test.fire',
  install(r) {
    r.action<Action & { decl: FireDeclaration; mode: FireMode }>({
      type: 'test.fire',
      decisionKinds: ['phase'],
      validate: (env, a) => env.query('fire.illegal', { decl: a.decl, mode: a.mode, side: a.side }, null),
      resolve(ctx: Ctx, a) {
        ctx.proc<ResolveFireFn>(FP.resolve)(ctx, a.decl, a.mode);
      },
    });
  },
};
const extra = [...sk2CoreModules, ...sk3CoreModules, ptoModule, testFire];
const play = (engine: Engine, state: GameState, ...actions: (Omit<Action, 'decisionId' | 'side'> & { side?: string })[]) => {
  let s = state;
  for (const a of actions) s = act(engine, s, a).state;
  return s;
};
const settle = (engine: Engine, state: GameState) => {
  let s = state;
  while (engine.currentDecision(s)?.kind === 'firstFire') s = act(engine, s, { type: 'defPass' }).state;
  return s;
};
const steps = (engine: Engine, s: GameState, side: string) => engine.legalActions(s, side).filter((a) => a.type === 'move.step').map((a) => a['to'] as string);
const jungle = (hexes: string[]) => Object.fromEntries(hexes.map((h) => [h, { terrain: 'jungle' }]));
const sq = (id: string, hex: string, tags: Record<string, string | number | boolean> = {}): PieceSpec => ({ id, def: 'ru.447', side: 'ru', hex, tags });

describe('PTO Terrain (SK4 8.2): movement', () => {
  it('a path lets Infantry enter a jungle hex for 1 MF; off the path jungle costs 2', () => {
    const { engine, state } = makeEngine({ scenario: RU_VS_GE, extra, startPhase: 'MPh', terrain: { ...jungle(['yK5', 'yL5']), yK4: { terrain: 'jungle', features: ['path'] } }, pathHexsides: [['yK4', 'yK5']], pieces: [sq('a', 'yK4'), sq('b', 'yL6')] });
    let s = play(engine, state, { type: 'move.start', units: ['a'] });
    s = settle(engine, play(engine, s, { type: 'move.step', to: 'yK5' }));
    expect(moveState(engine.env(s))!.spent['a']).toBe(1);
    const t = play(engine, settle(engine, play(engine, s, { type: 'move.end' })), { type: 'move.start', units: ['b'] });
    const u = settle(engine, play(engine, t, { type: 'move.step', to: 'yL5' }));
    expect(moveState(engine.env(u))!.spent['b']).toBe(2);
  });

  it('bamboo costs all of a unit\'s MF (leader bonus included), is offered only as the first hex, counts as all MF +1 for Defensive First Fire, and leaves the unit CX and pinned', () => {
    const terrain = { yK5: { terrain: 'bamboo' } };
    const pieces = [sq('a', 'yK4'), { id: 'l', def: 'ru.L91', side: 'ru', hex: 'yK4' }, sq('b', 'yL4'), { id: 'g', def: 'ge.467', side: 'ge', hex: 'yK8' }];
    const { engine, state } = makeEngine({ scenario: RU_VS_GE, extra, startPhase: 'MPh', terrain, pieces });
    // b spends 1 MF first: bamboo is no longer affordable (all 4 MF needed).
    let s = play(engine, state, { type: 'move.start', units: ['b'] });
    s = settle(engine, play(engine, s, { type: 'move.step', to: 'yK4' }));
    expect(steps(engine, s, 'ru')).not.toContain('yK5');
    s = settle(engine, play(engine, s, { type: 'move.end' }));
    // a with the leader: 6 MF allowance, bamboo costs all 6; the defender sees 7 MF spent there.
    s = play(engine, s, { type: 'move.start', units: ['a', 'l'] });
    expect(steps(engine, s, 'ru')).toContain('yK5');
    s = play(engine, s, { type: 'move.step', to: 'yK5' });
    const ms = moveState(engine.env(s))!;
    expect(ms.spent['a']).toBe(6);
    expect(ms.mfHere).toBe(7);
    expect(engine.currentDecision(s)!.kind).toBe('firstFire');
    s = settle(engine, s);
    // No MF left: the stack is finished, and marked CX and pinned (8.2.1) for the rest of the turn.
    s = play(engine, s, ...(moveState(engine.env(s)) ? [{ type: 'move.end' }] : []));
    expect(s.pieces['a']!.tags).toMatchObject({ cx: true, pinned: true, moved: true });
    expect(s.pieces['l']!.tags).toMatchObject({ cx: true, pinned: true });
  });

  it('a CX unit may not advance into bamboo; one that does becomes CX', () => {
    const { engine, state } = makeEngine({ scenario: RU_VS_GE, extra, startPhase: 'APh', terrain: { yK5: { terrain: 'bamboo' } }, pieces: [sq('a', 'yK4', { cx: true }), sq('b', 'yK4')] });
    const d = engine.currentDecision(state)!;
    // Bamboo costs all of a unit's MF, so the general CX rule already refuses; the PTO contribution backs it up.
    expect(engine.validate(state, { type: 'advance', units: ['a'], to: 'yK5', side: 'ru', decisionId: d.id } as never)).toMatch(/CX/);
    const s = play(engine, state, { type: 'advance', units: ['b'], to: 'yK5' });
    expect(s.pieces['b']!.tags['cx']).toBe(true);
  });

  it('Dense jungle holds two squad equivalents: a third squad may not step in, and may not set up there', () => {
    const { engine, state } = makeEngine({ scenario: RU_VS_GE, extra, startPhase: 'MPh', terrain: jungle(['yK5']), pieces: [sq('a', 'yK5'), sq('b', 'yK5'), sq('c', 'yK4'), sq('d', 'yL4')] });
    const s = play(engine, state, { type: 'move.start', units: ['c'] });
    expect(steps(engine, s, 'ru')).not.toContain('yK5');
    const d = engine.currentDecision(s)!;
    expect(engine.validate(s, { type: 'move.step', to: 'yK5', side: 'ru', decisionId: d.id } as never)).toMatch(/2 squad-equivalents/);
    // Three in woods are fine.
    const w = makeEngine({ scenario: RU_VS_GE, extra, startPhase: 'MPh', terrain: { yK5: { terrain: 'woods' } }, pieces: [sq('a', 'yK5'), sq('b', 'yK5'), sq('c', 'yK4')] });
    expect(steps(w.engine, play(w.engine, w.state, { type: 'move.start', units: ['c'] }), 'ru')).toContain('yK5');
  });
});

describe('PTO Terrain (SK4 8.2): recovery, fire groups, ambush, mortars', () => {
  it('Recovery in kunai takes +2: a dr of 4 fails there and succeeds in the open', () => {
    const base = (hex: string, terrain: Record<string, { terrain: string }>) =>
      makeEngine({ scenario: RU_VS_GE, extra, startPhase: 'RPh', terrain, dice: [4], pieces: [sq('a', hex), { id: 'mg', def: 'ru.LMG', side: 'ru', hex }, { id: 'g', def: 'ge.467', side: 'ge', hex: 'yQ9' }] });
    const k = base('yK5', { yK5: { terrain: 'kunai' } });
    const ks = play(k.engine, k.state, { type: 'rally.recover', unit: 'a', sw: 'mg' });
    expect(ks.pieces['mg']!.loc).toEqual({ kind: 'hex', hex: 'yK5' });
    const o = base('yK5', {});
    const os = play(o.engine, o.state, { type: 'rally.recover', unit: 'a', sw: 'mg' });
    expect(os.pieces['mg']!.loc).toEqual({ kind: 'held', by: 'a' });
  });

  it('no multi-hex Fire Group between two Dense jungle hexes; jungle with open ground is allowed', () => {
    const { engine, state } = makeEngine({ scenario: RU_VS_GE, extra, startPhase: 'PFPh', terrain: jungle(['yK4', 'yK5']), pieces: [sq('a', 'yK4'), sq('b', 'yK5'), sq('c', 'yL4'), { id: 'g', def: 'ge.467', side: 'ge', hex: 'yK7' }] });
    const illegal = (units: string[]) => engine.query(state, 'fire.illegal', { decl: { units, sw: [], target: 'yK7' }, mode: 'prep', side: 'ru' }, null).value;
    expect(illegal(['a', 'b'])).toMatch(/Dense jungle, kunai or bamboo/);
    expect(illegal(['b', 'c'])).toBeNull();
    expect(illegal(['a'])).toBeNull();
  });

  it('the side that advanced into a jungle hex takes +1 on its ambush dr', () => {
    const { engine, state } = makeEngine({ scenario: RU_VS_GE, extra, startPhase: 'CCPh', terrain: jungle(['yK5']), pieces: [sq('a', 'yK5', { advancedInto: 'yK5' }), { id: 'g', def: 'ge.467', side: 'ge', hex: 'yK5' }] });
    expect(engine.query(state, 'cc.ambushDrm', { hex: 'yK5', side: 'ru', units: ['a'] }, 0).value).toBe(1);
    expect(engine.query(state, 'cc.ambushDrm', { hex: 'yK5', side: 'ge', units: ['g'] }, 0).value).toBe(0);
  });

  it('no mortar fires from a Dense jungle hex', () => {
    const mortar = (hex: string, terrain: Record<string, { terrain: string }>) =>
      makeEngine({ scenario: { ...RU_VS_GE, firstSide: 'ge' }, extra, startPhase: 'PFPh', terrain, pieces: [{ id: 'a', def: 'ge.467', side: 'ge', hex }, { id: 'm', def: 'ge.MTR', side: 'ge', heldBy: 'a' }, { id: 'r', def: 'ru.447', side: 'ru', hex: 'yK10' }] });
    const offers = (g: ReturnType<typeof mortar>) => g.engine.legalActions(g.state, 'ge').filter((a) => a.type === 'fire.ordnance').length;
    expect(offers(mortar('yK5', {}))).toBeGreaterThan(0);
    expect(offers(mortar('yK5', jungle(['yK5'])))).toBe(0);
  });
});

describe('PTO Terrain (SK4 8.2.1): huts', () => {
  it('a KIA result vs a unit in a hut collapses it: the terrain reads Collapsed Hut (0 TEM) and every unit there takes a PTC vs 8 with no leadership that can pin even a broken unit', () => {
    const { engine, state } = makeEngine({
      scenario: { ...RU_VS_GE, firstSide: 'ge' },
      extra,
      startPhase: 'PFPh',
      terrain: { yL5: { terrain: 'hut', buildingId: 'y-H1' } },
      // Fire DR 1,1 (a KIA on the 16 column), then sixes for everything that follows: every PTC fails (12 > 8).
      dice: [1, 1, ...Array<number>(24).fill(6)],
      pieces: [{ id: 'a', def: 'ge.467', side: 'ge', hex: 'yK5' }, { id: 'a2', def: 'ge.467', side: 'ge', hex: 'yK5' }, { id: 'l', def: 'ru.L91', side: 'ru', hex: 'yL5' }, sq('r1', 'yL5'), sq('r2', 'yL5'), sq('r3', 'yL5', { broken: true })],
    });
    expect(engine.env(state).query('hex.tem', { hex: 'yL5' }, 0)).toBe(1);
    const t = act(engine, state, { type: 'test.fire', decl: { units: ['a', 'a2'], sw: [], target: 'yL5' }, mode: 'prep' });
    const s = t.state;
    expect(t.events.filter((e) => e.type === 'sk1.fire.result').map((e) => (e.payload as { result: { kind: string } }).result.kind)).toContain('KIA');
    expect(s.hexMarkers['yL5']?.[COLLAPSED_HUT]).toBe(true);
    const env = engine.env(s);
    expect(env.query('hex.terrain', { hex: 'yL5' }, 'hut')).toBe('hut-collapsed');
    expect(env.query('hex.tem', { hex: 'yL5' }, 0)).toBe(0);
    // One PTC per unit in the hut at the moment it fell (a 12 fails whoever rolls it, leader or not), each a pin.
    const collapsed = t.events.find((e) => e.type === 'sk4.hut.collapsed')!.payload as { why: string; ptc: { unit: string; dr: [number, number]; pinned: boolean }[] };
    expect(collapsed.why).toBe('kia');
    expect(collapsed.ptc.length).toBe(4);
    expect(collapsed.ptc.every((x) => x.pinned)).toBe(true);
    // A broken unit pinned this way cannot rout: it is pinned now (unless it died with the KIA).
    if (s.pieces['r3']!.loc.kind === 'hex') expect(s.pieces['r3']!.tags['pinned']).toBe(true);
    // It never collapses twice.
    expect(t.events.filter((e) => e.type === 'sk4.hut.collapsed').length).toBe(1);
  });

  it('a pinned broken unit cannot rout', () => {
    const { engine, state } = makeEngine({ scenario: RU_VS_GE, extra, startPhase: 'RtPh', terrain: { yL5: { terrain: 'hut', buildingId: 'y-H1' } }, pieces: [sq('r1', 'yL5', { broken: true, pinned: true, dm: true }), { id: 'g', def: 'ge.467', side: 'ge', hex: 'yK5' }] });
    expect(engine.legalActions(state, 'ru').filter((a) => a.type === 'rout.step' || a.type === 'rout')).toEqual([]);
  });

  it('a Buttoned Up AFV enters a hut for 2 MP with no Bog Check and collapses it before Defensive First Fire; a CE one may not enter', () => {
    const tank = (tags: Record<string, string | number | boolean> = {}): PieceSpec => ({ id: 't34', def: 'ru.T34M43', side: 'ru', hex: 'yM5', tags: { vca: 0, ca: 0, ...tags } });
    const terrain = { yM4: { terrain: 'hut', buildingId: 'y-H2' } };
    const { engine, state } = makeEngine({ scenario: RU_VS_GE, extra, startPhase: 'MPh', terrain, pieces: [tank(), { id: 'g', def: 'ge.467', side: 'ge', hex: 'yM4' }, { id: 'g2', def: 'ge.467', side: 'ge', hex: 'yQ9' }] });
    let s = settle(engine, play(engine, state, { type: 'vmove.start', vehicle: 't34' }));
    const ns = (engine.env(s) as unknown as { statics: { map: { neighbors(h: string): string[] } } }).statics.map.neighbors('yM5');
    expect(ns[0]).toBe('yM4');
    s = play(engine, s, { type: 'move.step', to: 'yM4' });
    expect(s.hexMarkers['yM4']?.[COLLAPSED_HUT]).toBe(true);
    expect(moveState(engine.env(s))!.spent['t34']).toBe(3); // 1 to start + 2
    expect(s.pieces['t34']!.tags['bog']).toBeUndefined();
    const ce = makeEngine({ scenario: RU_VS_GE, extra, startPhase: 'MPh', terrain, pieces: [tank({ ce: true }), { id: 'g2', def: 'ge.467', side: 'ge', hex: 'yQ9' }] });
    const cs = settle(ce.engine, play(ce.engine, ce.state, { type: 'vmove.start', vehicle: 't34' }));
    expect(steps(ce.engine, cs, 'ru')).not.toContain('yM4');
  });
});
