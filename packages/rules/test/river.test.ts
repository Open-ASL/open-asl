import { describe, expect, it } from 'vitest';
import type { Engine, GameState } from '@asl/engine';
import { DISASSEMBLED_SW_MODULE, RIVER_MODULE, disassembledSwModule, ppOf, riverModule, sk2CoreModules, statics } from '../src';
import { act, makeEngine, type PieceSpec } from './fixtures';

/**
 * S66: a river crossed only at a footbridge hex (SSR 1), and a mortar that enters disassembled (SSR 2).
 * On the bare test board: the river runs K5-L5-M5 (one row), the footbridge is L5, entered only from L4 or L6.
 */
const RIVER = ['yK5', 'yL5', 'yM5'];
const BRIDGE = { hexes: RIVER, crossing: { hex: 'yL5', from: ['yL4', 'yL6'] }, stack: { se: 1, smc: 4 }, los: ['yL9'], rule: 'SSR 1' };
const SC = {
  firstSide: 'am',
  sides: [
    { side: 'am', name: 'American', nationality: 'am', elr: 5 },
    { side: 'ge', name: 'German', nationality: 'ge', elr: 3 },
  ],
};
const game = (pieces: PieceSpec[], ssr: unknown[], startPhase = 'MPh', dice?: number[]) =>
  makeEngine({ scenario: { ...SC, ssr } as never, extra: [...sk2CoreModules, riverModule, disassembledSwModule], terrain: {}, startPhase, pieces, ...(dice ? { dice } : {}) });
const steps = (engine: Engine, s: GameState) => engine.legalActions(s, 'am').filter((a) => a.type === 'move.step').map((a) => a['to'] as string).sort();

describe('S66 SSR 1: a river crossed only at the footbridge', () => {
  it('the board: L5 is entered only from L4 or L6; no other river hex is entered or left', () => {
    const { engine, state } = game([{ id: 'a', def: 'am.558r', side: 'am', hex: 'yL4' }, { id: 'g', def: 'ge.467', side: 'ge', hex: 'yA1' }], [{ module: RIVER_MODULE, params: BRIDGE }]);
    const map = statics(engine.env(state)).map;
    expect(map.neighbors('yL5')).toEqual(expect.arrayContaining(['yL4', 'yL6', 'yK5', 'yM5']));
    let s = act(engine, state, { type: 'move.start', units: ['a'] }).state;
    // From L4: onto the bridge, not into K5/M5 (river) if they are beside L4.
    expect(steps(engine, s)).toContain('yL5');
    for (const h of map.neighbors('yL4').filter((h) => RIVER.includes(h) && h !== 'yL5')) {
      expect(steps(engine, s)).not.toContain(h);
      expect(() => act(engine, s, { type: 'move.step', to: h })).toThrow(/SSR 1: units enter or leave the river only at L5/);
    }
    s = act(engine, s, { type: 'move.step', to: 'yL5' }).state;
    // On the bridge: off it only to L6 (or back to L4).
    expect(steps(engine, s).filter((h) => !['yL4', 'yL6'].includes(h))).toEqual([]);
    s = act(engine, s, { type: 'move.step', to: 'yL6' }).state;
    expect(s.pieces['a']!.loc).toEqual({ kind: 'hex', hex: 'yL6' });
  });

  it('a unit beside the bridge but not across its hexsides may not step onto it; advancing obeys the same', () => {
    const side = (h: string) => !['yL4', 'yL6', ...RIVER].includes(h);
    const { engine, state } = game([{ id: 'g', def: 'ge.467', side: 'ge', hex: 'yA1' }], [{ module: RIVER_MODULE, params: BRIDGE }], 'APh');
    const map = statics(engine.env(state)).map;
    const beside = map.neighbors('yL5').filter(side);
    expect(beside.length).toBeGreaterThan(0);
    const env = engine.env(state);
    for (const h of beside) expect(env.query('move.cost', { unit: 'g', from: h, to: 'yL5', viaRoad: false }, 1)).toBe(Infinity);
    expect(env.query('move.cost', { unit: 'g', from: 'yL4', to: 'yL5', viaRoad: false }, 1)).toBe(1);
    const { engine: e2, state: s2 } = game([{ id: 'a', def: 'am.558r', side: 'am', hex: beside[0]! }, { id: 'b', def: 'am.558r', side: 'am', hex: 'yL4' }], [{ module: RIVER_MODULE, params: BRIDGE }], 'APh');
    expect(() => act(e2, s2, { type: 'advance', units: ['a'], to: 'yL5' })).toThrow(/SSR 1/);
    expect(act(e2, s2, { type: 'advance', units: ['b'], to: 'yL5' }).state.pieces['b']!.loc).toEqual({ kind: 'hex', hex: 'yL5' });
  });

  it('the bridge holds one squad equivalent (and four leaders)', () => {
    const { engine, state } = game([{ id: 'a', def: 'am.558r', side: 'am', hex: 'yL5' }, { id: 'b', def: 'am.558r', side: 'am', hex: 'yL4' }, { id: 'g', def: 'ge.467', side: 'ge', hex: 'yA1' }], [{ module: RIVER_MODULE, params: BRIDGE }]);
    expect(engine.env(state).query('stack.limit', { hex: 'yL5', side: 'am' }, { se: 3, smc: 4 })).toEqual({ se: 1, smc: 4 });
    const s = act(engine, state, { type: 'move.start', units: ['b'] }).state;
    expect(steps(engine, s)).not.toContain('yL5');
  });

  it('LOS to and from the bridge: adjacent hexes and the listed ones only', () => {
    const { engine, state } = game([{ id: 'g', def: 'ge.467', side: 'ge', hex: 'yA1' }], [{ module: RIVER_MODULE, params: BRIDGE }]);
    const env = engine.env(state);
    const los = (a: string, b: string) => env.query('los.trace', { from: a, to: b }, { clear: true, hindrance: 0, parts: [] }).clear;
    expect(los('yL5', 'yL4')).toBe(true);
    expect(los('yL9', 'yL5')).toBe(true);
    expect(los('yL5', 'yL8')).toBe(false);
    expect(los('yL8', 'yL5')).toBe(false);
    expect(los('yL4', 'yL8')).toBe(true);
  });
});

describe('S66 SSR 2: the 60mm mortar enters disassembled', () => {
  const MTR = { module: DISASSEMBLED_SW_MODULE, params: { side: 'am', def: 'am.MTR', pp: 3, rule: 'SSR 2' } };
  const pieces: PieceSpec[] = [
    { id: 'a', def: 'am.558r', side: 'am', hex: 'yL4' },
    { id: 'm', def: 'am.MTR', side: 'am', heldBy: 'a' },
    { id: 'l', def: 'am.L91', side: 'am', hex: 'yL4' },
    { id: 'g', def: 'ge.467', side: 'ge', hex: 'yL9' },
  ];

  it('starts malfunctioned side up, weighs 3 PP, cannot be repaired, and is assembled by its MMC in the PFPh as a SW use', () => {
    const { engine, state } = game(pieces, [MTR], 'PFPh');
    const env = engine.env(state);
    expect(state.pieces['m']!.tags).toMatchObject({ malf: true, disassembled: true });
    expect(ppOf(env, state.pieces['m']!)).toBe(3);
    expect(env.query('sw.repairIllegal', { unit: 'a', sw: 'm' }, null)).toMatch(/SSR 2: it is disassembled/);
    expect(engine.legalActions(state, 'am').filter((a) => a.type === 'sw.assemble')).toEqual([expect.objectContaining({ sw: 'm' })]);
    const r = act(engine, state, { type: 'sw.assemble', sw: 'm' });
    const s = r.state;
    expect(s.pieces['m']!.tags['malf']).toBeUndefined();
    expect(s.pieces['m']!.tags['disassembled']).toBeUndefined();
    expect(ppOf(engine.env(s), s.pieces['m']!)).toBe(5);
    expect(s.pieces['a']!.tags).toMatchObject({ firedSw: true, firedSwAs: 'prep' });
    expect(r.events.some((e) => e.type === 'ssr.sw.assembled')).toBe(true);
    // Not fired the phase it was put together; the squad's own FP is still its own (one SW use).
    expect(engine.env(s).query('ordnance.illegal', { shot: { weapon: 'm', target: 'yL9', targetType: 'ATT' } as never, mode: 'prep', side: 'am' }, null)).toMatch(/assembled this phase/);
    expect(engine.env(s).query('fire.illegal', { decl: { units: ['a'], sw: [], target: 'yL9' }, mode: 'prep', side: 'am' }, null)).toBeNull();
    // A leader may not assemble it.
    expect(engine.legalActions(s, 'am').some((a) => a.type === 'sw.assemble')).toBe(false);
  });

  it('not in the MPh, nor by a leader holding it', () => {
    const { engine, state } = game(pieces, [MTR], 'MPh');
    expect(() => act(engine, state, { type: 'sw.assemble', sw: 'm' })).toThrow(/PFPh or DFPh/);
    const led = game([{ id: 'l', def: 'am.L91', side: 'am', hex: 'yL4' }, { id: 'm', def: 'am.MTR', side: 'am', heldBy: 'l' }, { id: 'g', def: 'ge.467', side: 'ge', hex: 'yL9' }], [MTR], 'PFPh');
    expect(() => act(led.engine, led.state, { type: 'sw.assemble', sw: 'm' })).toThrow(/only a MMC/);
  });
});
