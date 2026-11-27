import { describe, expect, it } from 'vitest';
import type { GameState, RuleModule } from '@asl/engine';
import { aslCoreModules, defaultPlacement, piecesModule, placementIllegal, statics, turnModule } from '../../src';
import { sk1CoreModules } from '../../src/sk1';
import { sk2CoreModules } from '../../src/sk2';
import { sk3CoreModules } from '../../src/sk3';
import { RU_VS_GE, act, makeEngine, type PieceSpec } from '../fixtures';
import { testFire } from './helpers';

/*
 * Verification of the Chapter A ledger rows (packages/rules/docs/asl-chapter-a.md) in A1 (Personnel), A4 (Infantry Movement), A5 (Stacking) and
 * A6 (LOS) that no earlier test exercised directly. Behaviour that differs from the eASLRB is pinned
 * as it is today and the test name says what full ASL changes.
 */

describe('A1.4 BROKEN SIDE, A10.4 BROKEN UNITS', () => {
  it('a broken unit has no FP: it cannot fire', () => {
    const { engine, state } = makeEngine({
      extra: [testFire],
      pieces: [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5', tags: { broken: true } },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yN7' },
      ],
    });
    expect(() => act(engine, state, { type: 'test.fire', mode: 'prep', decl: { units: ['a1'], sw: [], target: 'yN7' } })).toThrow(/Good Order/);
  });
});

describe('A4.13 TERRAIN EFFECTS', () => {
  it('Infantry pay 1 MF into Open Ground and 2 MF into woods or a building', () => {
    const { engine, state } = makeEngine({
      startPhase: 'MPh',
      terrain: { yN6: { terrain: 'woods' }, yM6: { terrain: 'building-stone' } },
      pieces: [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP9' },
      ],
    });
    const env = engine.env(state);
    const cost = (to: string) => env.query('move.cost', { unit: 'a1', from: 'yN5', to, viaRoad: false }, 0);
    expect(cost('yO5')).toBe(1);
    expect(cost('yN6')).toBe(2);
    expect(cost('yM6')).toBe(2);
  });
});

describe('A4.431 TRANSFER', () => {
  const pieces = (tags: NonNullable<PieceSpec['tags']> = {}) => [
    { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5' },
    { id: 'a2', def: 'am.747', side: 'am', hex: 'yN5', tags },
    { id: 'mg', def: 'am.MMG', side: 'am', heldBy: 'a1' },
    { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP9' },
  ];
  it('passes a SW between Good Order unpinned units of one Location in the RPh, not in the MPh', () => {
    const { engine, state } = makeEngine({ startPhase: 'RPh', pieces: pieces() });
    const t = act(engine, state, { type: 'rally.transfer', sw: 'mg', to: 'a2' });
    expect(t.state.pieces['mg']!.loc).toEqual({ kind: 'held', by: 'a2' });
    const mph = makeEngine({ startPhase: 'MPh', pieces: pieces() });
    expect(() => act(mph.engine, mph.state, { type: 'rally.transfer', sw: 'mg', to: 'a2' })).toThrow(/RPh or APh/);
    const pinned = makeEngine({ startPhase: 'RPh', pieces: pieces({ pinned: true }) });
    expect(() => act(pinned.engine, pinned.state, { type: 'rally.transfer', sw: 'mg', to: 'a2' })).toThrow(/Good Order/);
  });
});

describe('A4.61 ASSAULT MOVEMENT', () => {
  it('is one hex, without spending all MF', () => {
    const { engine, state } = makeEngine({
      startPhase: 'MPh',
      terrain: { yM6: { terrain: 'building-stone' } },
      pieces: [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP9' },
      ],
    });
    const s = act(engine, state, { type: 'move.start', units: ['a1'], assault: true }).state;
    const s2 = act(engine, s, { type: 'move.step', to: 'yN6' }).state;
    const s3 = engine.currentDecision(s2)?.kind === 'firstFire' ? act(engine, s2, { type: 'defPass' }).state : s2;
    expect(() => act(engine, s3, { type: 'move.step', to: 'yN7' })).toThrow(/one hex/);
  });
});

describe('A4.62 HAZARDOUS MOVEMENT', () => {
  it('pushing a Gun is Hazardous Movement only during the MPh (A4.62; Q&A [K33]); the Starter Kit keeps it for the Player Turn (SK4 6.5)', () => {
    const labels = (asl: boolean, phase: string) => {
      const { engine, state } = makeEngine({
        modules: [piecesModule, turnModule, ...sk1CoreModules, ...sk2CoreModules, ...sk3CoreModules, ...(asl ? aslCoreModules : [])],
        scenario: RU_VS_GE,
        startPhase: phase,
        pieces: [{ id: 'c', def: 'ru.247', side: 'ru', hex: 'yN5', tags: { manhandled: true, hazardous: true } }, { id: 'g', def: 'ge.467', side: 'ge', hex: 'yN8' }],
      });
      const attack = { target: 'yN5', parts: [{ firer: 'g' }], mode: phase === 'MPh' ? 'first' : 'final', side: 'ge', hindrance: 0 };
      return engine.env(state).explain('fire.unitDrm', { attack: attack as never, unit: 'c' }, 0).trace.filter((t) => !t.suppressedBy).map((t) => t.label ?? '').join('|');
    };
    expect(labels(true, 'MPh')).toMatch(/Hazardous Movement/);
    expect(labels(true, 'DFPh')).not.toMatch(/Hazardous Movement/);
    expect(labels(false, 'DFPh')).toMatch(/Hazardous Movement/);
  });
});

describe('A4.72 vs DIFFICULT TERRAIN: the Starter Kit reading', () => {
  // Test-only terrain: yN6 costs 4 MF to enter (a woods hex entered uphill, say).
  const fourMf: RuleModule = {
    id: 'test.fourMf',
    install(r) {
      r.contribute({ id: 'test.fourMf', query: 'move.cost', layer: 950, when: ({ to }) => to === 'yN6', apply: () => 4 });
    },
  };
  // The full ASL "≥ four MF" clause is `asl/advanceDifficult.ts` (overstacking.test.ts › A4.72: a 9-1 (six MF) advancing into four-MF woods becomes CX ...).
  it('Starter Kit: an advance costing all of a unit\'s MF makes it CX; one costing 4 of 6 MF does not (SK1 3.7)', () => {
    const alone = makeEngine({
      startPhase: 'APh',
      extra: [fourMf],
      pieces: [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP9' },
      ],
    });
    expect(act(alone.engine, alone.state, { type: 'advance', units: ['a1'], to: 'yN6' }).state.pieces['a1']!.tags['cx']).toBe(true);
    const led = makeEngine({
      startPhase: 'APh',
      extra: [fourMf],
      pieces: [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5' },
        { id: 'aL', def: 'am.L91', side: 'am', hex: 'yN5' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP9' },
      ],
    });
    // With the leader the squad has 6 MF: not CX in the Starter Kit.
    expect(act(led.engine, led.state, { type: 'advance', units: ['a1', 'aL'], to: 'yN6' }).state.pieces['a1']!.tags['cx']).toBeUndefined();
  });
});

describe('A5.4 COMBINED ARMS', () => {
  it('a vehicle in a hex does not alter the Personnel stacking limit', () => {
    const { engine, state } = makeEngine({
      scenario: RU_VS_GE,
      extra: [...sk2CoreModules, ...sk3CoreModules],
      startPhase: 'APh',
      pieces: [
        { id: 'a', def: 'ru.447', side: 'ru', hex: 'yN5' },
        { id: 'b', def: 'ru.447', side: 'ru', hex: 'yN5' },
        { id: 't1', def: 'ru.T34M43', side: 'ru', hex: 'yN5', tags: { vca: 0, ca: 0 } },
        { id: 'c', def: 'ru.447', side: 'ru', hex: 'yN4' },
        { id: 'd', def: 'ru.447', side: 'ru', hex: 'yN4' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP9' },
      ],
    });
    const d = engine.currentDecision(state)!;
    const advance = (units: string[]) => engine.validate(state, { type: 'advance', units, to: 'yN5', side: 'ru', decisionId: d.id } as never);
    expect(advance(['c'])).toBeNull();
    expect(advance(['c', 'd'])).toMatch(/[Ss]tacking/);
  });
});

describe('A6.5 RECIPROCITY, A6.6 UNITS', () => {
  it('a LOS traced one way is the same LOS traced back', () => {
    const { engine, state } = makeEngine({
      terrain: { yN6: { terrain: 'woods' }, yO7: { terrain: 'orchard' }, yP7: { terrain: 'building-stone' } },
      pieces: [],
    });
    const env = engine.env(state);
    const pairs: [string, string][] = [['yN5', 'yN8'], ['yN5', 'yQ8'], ['yM4', 'yP9'], ['yL6', 'yR7']];
    for (const [a, b] of pairs) {
      const ab = env.query('los.trace', { from: a, to: b }, null as never) as { clear: boolean; hindrance: number };
      const ba = env.query('los.trace', { from: b, to: a }, null as never) as { clear: boolean; hindrance: number };
      expect([ab.clear, ab.hindrance]).toEqual([ba.clear, ba.hindrance]);
    }
  });

  it('Personnel units in an intervening hex neither block nor hinder fire through it', () => {
    const { engine, state } = makeEngine({
      extra: [testFire],
      pieces: [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5' },
        { id: 'a2', def: 'am.747', side: 'am', hex: 'yN6' },
        { id: 'g2', def: 'ge.467', side: 'ge', hex: 'yN7' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yN8' },
      ],
      dice: [6, 6],
    });
    const t = act(engine, state, { type: 'test.fire', mode: 'prep', decl: { units: ['a1'], sw: [], target: 'yN8' } });
    const attack = t.events.find((e) => e.type === 'sk1.fire.attack')!.payload as { drm: number; fp: number };
    expect(attack.fp).toBe(7);
    expect(attack.drm).toBe(0);
  });
});

describe('A2.5 ENTRY, A2.51 OFFBOARD SETUP, A2.6 EXIT, A2.9 SETUP LIMITATIONS under the full ASL ruleset', () => {
  const ASL: RuleModule[] = [piecesModule, turnModule, ...sk1CoreModules, ...sk2CoreModules, ...sk3CoreModules, ...aslCoreModules];
  type MapApi = { offboard(e: string): { id: string }[]; offboardNeighbors(h: string): { onboard: string[]; offboard: string[] } };
  const mapOf = (engine: ReturnType<typeof makeEngine>['engine'], state: GameState) => statics(engine.env(state)).map as unknown as MapApi;
  const entering = (id: string): PieceSpec => ({ id, def: 'ru.447', side: 'ru', tags: { force: 0, entryTurn: 1, entryEdge: 'N' } });
  const scenario = { ...RU_VS_GE, forces: [{ side: 'ru', units: [{ def: 'ru.447', count: 4 }], setup: { kind: 'enter' as const, turn: 1, edge: 'N' } }], exits: [{ side: 'ru', edge: 'N' }] };

  it('units set up offboard under the stacking limits (A2.51, A2.9), then enter onto the board from there (A2.5)', () => {
    const rph = makeEngine({ pieces: ['a', 'b', 'c', 'd'].map(entering), scenario, modules: ASL, startPhase: 'RPh' });
    const env = rph.engine.env(rph.state);
    const off = mapOf(rph.engine, rph.state).offboard('N')[5]!.id;
    const todo = ['a', 'b', 'c', 'd'].map((id) => rph.state.pieces[id]!);
    expect(placementIllegal(env, 'ru', todo, Object.fromEntries(todo.map((p) => [p.id, off])))).toMatch(/Stacking limit exceeded/);
    const auto = defaultPlacement(env, 'ru', todo)!;
    expect(placementIllegal(env, 'ru', todo, auto)).toBeNull();
    // In the MPh a squad in that offboard hex steps onto the board.
    const mph = makeEngine({ pieces: [entering('a'), { id: 'g', def: 'ge.467', side: 'ge', hex: 'yY10' }], scenario, modules: ASL, startPhase: 'MPh' });
    const s0: GameState = { ...mph.state, pieces: { ...mph.state.pieces, a: { ...mph.state.pieces['a']!, loc: { kind: 'offboard', edge: 'N', hex: off } } } };
    const onto = mapOf(mph.engine, s0).offboardNeighbors(off).onboard[0]!;
    let s = act(mph.engine, s0, { type: 'move.start', units: ['a'] }).state;
    s = act(mph.engine, s, { type: 'move.step', to: onto }).state;
    expect(s.pieces['a']!.loc).toEqual({ kind: 'hex', hex: onto });
  });

  it('a unit on the map edge exits across it in its MPh where the scenario allows (A2.6)', () => {
    const probe = makeEngine({ pieces: [], scenario, modules: ASL });
    const off = mapOf(probe.engine, probe.state).offboard('N')[5]!.id;
    const edge = mapOf(probe.engine, probe.state).offboardNeighbors(off).onboard[0]!;
    const { engine, state } = makeEngine({ pieces: [{ id: 'a', def: 'ru.447', side: 'ru', hex: edge }, { id: 'g', def: 'ge.467', side: 'ge', hex: 'yY10' }], scenario, modules: ASL, startPhase: 'MPh' });
    const s = act(engine, state, { type: 'move.start', units: ['a'] }).state;
    const exit = engine.legalActions(s, 'ru').find((a) => a.type === 'move.step' && !statics(engine.env(s)).map.hex(a['to'] as string));
    expect(exit).toBeDefined();
    expect(act(engine, s, exit as never).state.pieces['a']!.loc.kind).toBe('offboard');
  });

  it('three squads may set up in one hex, not four (A2.9, A5.1)', () => {
    const area = { ...RU_VS_GE, forces: [{ side: 'ru', units: [{ def: 'ru.447', count: 4 }], setup: { kind: 'area' as const, description: 'N5-N6', hexes: ['yN5', 'yN6'] } }] };
    const pieces = ['a', 'b', 'c', 'd'].map((id): PieceSpec => ({ id, def: 'ru.447', side: 'ru', tags: { force: 0 } }));
    const made = makeEngine({ pieces, scenario: area, modules: ASL, startPhase: 'RPh' });
    const engine = made.engine;
    // Waiting to be set up in the area (the setup box).
    const state: GameState = { ...made.state, pieces: Object.fromEntries(Object.entries(made.state.pieces).map(([id, p]) => [id, { ...p, loc: { kind: 'offboard' as const, edge: 'setup' } }])) };
    const env = engine.env(state);
    const todo = ['a', 'b', 'c', 'd'].map((id) => state.pieces[id]!);
    expect(placementIllegal(env, 'ru', todo, { a: 'yN5', b: 'yN5', c: 'yN5', d: 'yN5' })).toMatch(/Stacking limit exceeded/);
    expect(placementIllegal(env, 'ru', todo, { a: 'yN5', b: 'yN5', c: 'yN5', d: 'yN6' })).toBeNull();
  });
});
