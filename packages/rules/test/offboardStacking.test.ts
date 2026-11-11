import { describe, expect, it } from 'vitest';
import type { GameState } from '@asl/engine';
import { defaultPlacement, moveState, placementIllegal } from '../src';
import { sk2CoreModules } from '../src/sk2';
import { sk3CoreModules } from '../src/sk3';
import { RU_VS_GE, act, makeEngine, type PieceSpec } from './fixtures';

/*
 * Infantry stacking limits bind offboard hexes as well (ASLRB A5.1: "never during initial or offboard setup"; A2.51
 * offboard units stand and move on real hexes; SK4 3.3 "at any time during the move"). Vehicles may share an offboard
 * hex: SK4 3.3.2 limits them only "at the end of the MPh", which no vehicle spends offboard (read here so).
 * An earlier reading let Infantry overstack offboard too; it is not allowed.
 */

type MapApi = { offboard(e: string): { id: string }[]; offboardNeighbors(h: string): { onboard: string[]; offboard: string[] } };
const mapOf = (engine: ReturnType<typeof makeEngine>['engine'], state: GameState) => (engine.env(state) as unknown as { statics: { map: MapApi } }).statics.map;

const squad = (id: string): PieceSpec => ({ id, def: 'ru.447', side: 'ru', tags: { force: 0, entryTurn: 1, entryEdge: 'N' } });
const tank = (id: string): PieceSpec => ({ id, def: 'ru.T34M43', side: 'ru', tags: { force: 0, vca: 0, ca: 0, motion: true, entryTurn: 1, entryEdge: 'N' } });
/** The scenario's force 0: the Russians entering along the north edge on turn 1. */
const scenario = { ...RU_VS_GE, forces: [{ side: 'ru', units: [{ def: 'ru.447', count: 4 }, { def: 'ru.T34M43', count: 2 }], setup: { kind: 'enter' as const, turn: 1, edge: 'N' } }] };

describe('stacking offboard', () => {
  it('Infantry set up offboard keep the stacking limits; vehicles may share an offboard hex', () => {
    const { engine, state } = makeEngine({ pieces: [squad('a'), squad('b'), squad('c'), squad('d'), tank('t1'), tank('t2')], scenario, extra: [...sk2CoreModules, ...sk3CoreModules], startPhase: 'RPh' });
    const env = engine.env(state);
    const [off, next] = [mapOf(engine, state).offboard('N')[5]!.id, mapOf(engine, state).offboard('N')[6]!.id];
    const todo = ['a', 'b', 'c', 'd', 't1', 't2'].map((id) => state.pieces[id]!);
    expect(placementIllegal(env, 'ru', todo, Object.fromEntries(todo.map((p) => [p.id, off])))).toMatch(/Stacking limit exceeded/);
    expect(placementIllegal(env, 'ru', todo, { a: off, b: off, c: off, d: next, t1: off, t2: off })).toBeNull();
    // Auto-place spreads the squads along the edge.
    const auto = defaultPlacement(env, 'ru', todo)!;
    expect(auto).not.toBeNull();
    expect(placementIllegal(env, 'ru', todo, auto)).toBeNull();
    expect(new Set(['a', 'b', 'c', 'd'].map((id) => auto[id])).size).toBeGreaterThan(1);
  });

  it('three squads may move together along the edge, but not into an offboard hex already holding a fourth', () => {
    const { engine, state } = makeEngine({ pieces: [squad('a'), squad('b'), squad('c'), squad('d')], scenario, startPhase: 'MPh' });
    const map = mapOf(engine, state);
    const off = map.offboard('N')[5]!.id;
    const sideways = map.offboardNeighbors(off).offboard[0]!;
    const pieces = Object.fromEntries(Object.entries(state.pieces).map(([id, p]) => [id, { ...p, loc: { kind: 'offboard' as const, edge: 'N', hex: id === 'd' ? sideways : off } }]));
    let s: GameState = { ...state, pieces };
    s = act(engine, s, { type: 'move.start', units: ['a', 'b', 'c'] }).state;
    expect(() => act(engine, s, { type: 'move.step', to: sideways })).toThrow(/Stacking limit/);
    const other = map.offboardNeighbors(off).offboard.find((h) => h !== sideways)!;
    s = act(engine, s, { type: 'move.step', to: other }).state;
    expect(moveState(engine.env(s))!.off).toBe(other);
  });
});
