import { describe, expect, it } from 'vitest';
import type { Action, Engine, GameState, RuleModule } from '@asl/engine';
import {
  FORTIFICATIONS_MODULE,
  aslCoreModules,
  counterTerrainIllegal,
  defaultFortPlacement,
  fortArea,
  fortCounters,
  fortPlaceIllegal,
  fortPools,
  fortSetupIllegal,
  fortificationView,
  fortificationsModule,
  hipIllegal,
  locationsOf,
  piecesModule,
  pillboxCaHexsides,
  pillboxGray,
  redactState,
  roadblockExtension,
  seenByEnemy,
  turnModule,
  type FortPlacement,
  type FortRecord,
  type HexTerrainSpec,
  type SetupAction,
} from '../../src';
import { sk1CoreModules } from '../../src/sk1';
import { sk2CoreModules } from '../../src/sk2';
import { sk3CoreModules } from '../../src/sk3';
import { act, makeEngine, type PieceSpec } from '../fixtures';

/*
 * Fortification counters at setup in full ASL (ASLRB A12.33, B26.1, B27.1, B27.12, B27.51, B27.56, B28.1, B28.45,
 * B28.47, B28.5, B28.53, B29.1, B30.1, B30.111): where each counter may go, the pools a special rule gives, hidden or
 * open, the units set up beneath or inside them, the reveal by enemy LOS, and what the other side sees. The ground is
 * a stretch of board u laid out for the purpose: K4 a stone building, L4 woods, M4 a paved road hex and M5–M6 a dirt
 * road, N4 brush, O6 stone rubble; everything else Open Ground.
 */

const SK: RuleModule[] = [piecesModule, turnModule, ...sk1CoreModules, ...sk2CoreModules, ...sk3CoreModules];
const ASL: RuleModule[] = [...SK, ...aslCoreModules];
const GROUND: Record<string, HexTerrainSpec> = {
  uK4: { terrain: 'building-stone', buildingId: 'u-B16', building: { upper: 1, stairwell: 'inherent' }, obstacleHeight: 1.5 },
  uL4: { terrain: 'woods' },
  uM4: { terrain: 'open', features: ['road:paved'] },
  uM5: { terrain: 'open', features: ['road:dirt'] },
  uM6: { terrain: 'open', features: ['road:dirt'] },
  uN4: { terrain: 'brush' },
  uO6: { terrain: 'rubble-stone' },
  uL5: { terrain: 'woods' },
};
const AREA = ['uK4', 'uL4', 'uM4', 'uM5', 'uM6', 'uN4', 'uO6', 'uL5', 'uK5', 'uN5', 'uO5', 'uK6', 'uL6', 'uN6'];
const PARAMS = { side: 'ru', foxholes: 3, trenches: 1, ditch: 1, wire: 2, roadblocks: 1, pillboxes: [{ capacity: 1, ca: 3, nca: 5 }], mines: { factors: 12, known: 6, dummies: 1, at: true } };

/** Places the counters as the action would, from a phase decision (the real action answers the setup decision). */
const testPlace: RuleModule = {
  id: 'test.fortPlace',
  install(r) {
    r.action<Action & { counters: FortPlacement[] }>({
      type: 'test.fortPlace',
      decisionKinds: ['phase'],
      validate: (env, a) => fortPlaceIllegal(env, 'ru', a.counters),
      resolve(ctx, a) {
        ctx.emit('asl.fort.placed', { side: 'ru', counters: a.counters.map((c, i) => ({ ...c, id: `ru.fort${i + 1}`, side: 'ru' })) });
      },
    });
    r.action<Action & { id: string; hex: string }>({
      type: 'test.teleport',
      decisionKinds: ['phase'],
      resolve(ctx, a) {
        ctx.emit('piece.moved', { id: a.id, loc: { kind: 'hex', hex: a.hex } });
      },
    });
  },
};

function game(pieces: PieceSpec[], params: Record<string, unknown> = PARAMS, opts: { dice?: number[] } = {}) {
  const scenario = {
    firstSide: 'ge',
    sides: [
      { side: 'ge', name: 'German', nationality: 'ge', elr: 3 },
      { side: 'ru', name: 'Russian', nationality: 'ru', elr: 3 },
    ],
    forces: [{ side: 'ru', units: [], setup: { kind: 'area' as const, description: 'the village edge', hexes: AREA } }],
    ssr: [{ module: FORTIFICATIONS_MODULE, params }],
  };
    // The Dummy Minefield Secret dr (B28.47) is the first roll of every game here: a 1 adds nothing.
  return makeEngine({ board: 'u', terrain: GROUND, roadHexsides: [['uM4', 'uM5'], ['uM5', 'uM6']], scenario, modules: ASL, extra: [fortificationsModule, testPlace], pieces, dice: opts.dice ?? [1] });
}
const place = (engine: Engine, state: GameState, counters: FortPlacement[]) => act(engine, state, { type: 'test.fortPlace', counters }).state;
const far: PieceSpec[] = [{ id: 'g', def: 'ge.467', side: 'ge', hex: 'uY1' }, { id: 'r', def: 'ru.447', side: 'ru', hex: 'uA1' }];
const fox = (hex: string, capacity: 1 | 2 | 3 = 1, hidden = true): FortPlacement => ({ kind: 'foxhole', hex, hidden, capacity });

describe('where each counter may go', () => {
  it('Wire anywhere but a building or rubble hex; one per Location (B26.1, B23.5)', () => {
    const { engine, state } = game(far);
    const env = engine.env(state);
    expect(counterTerrainIllegal(env, { kind: 'wire', hex: 'uK4', hidden: true })).toMatch(/building hex: only a minefield/);
    expect(counterTerrainIllegal(env, { kind: 'wire', hex: 'uO6', hidden: true })).toMatch(/Wire cannot be set up/);
    for (const hex of ['uM4', 'uL4', 'uN4', 'uK5']) expect(counterTerrainIllegal(env, { kind: 'wire', hex, hidden: true }), hex).toBeNull();
    expect(fortPlaceIllegal(env, 'ru', [{ kind: 'wire', hex: 'uL4', hidden: true }, { kind: 'wire', hex: 'uL4', hidden: false }])).toMatch(/Only one Wire counter per Location/);
  });
  it('a foxhole or trench not in a paved road, building or rubble hex; one per hex, never together; the sizes (B27.1, B27.12, B27.51, B3.5)', () => {
    const { engine, state } = game(far);
    const env = engine.env(state);
    expect(counterTerrainIllegal(env, fox('uM4'))).toMatch(/paved road hex: no foxhole/);
    expect(counterTerrainIllegal(env, fox('uK4'))).toMatch(/only a minefield/);
    expect(counterTerrainIllegal(env, fox('uO6'))).toMatch(/cannot be placed/);
    expect(counterTerrainIllegal(env, { kind: 'trench', hex: 'uM4', hidden: true })).toMatch(/paved road hex: no trench/);
    expect(counterTerrainIllegal(env, fox('uM5'))).toBeNull();
    expect(counterTerrainIllegal(env, fox('uL4'))).toBeNull();
    expect(counterTerrainIllegal(env, { kind: 'foxhole', hex: 'uL4', hidden: true })).toMatch(/1S, 2S or 3S/);
    expect(fortPlaceIllegal(env, 'ru', [fox('uL4'), fox('uL4')])).toMatch(/One foxhole counter per hex/);
    expect(fortPlaceIllegal(env, 'ru', [fox('uL4'), { kind: 'trench', hex: 'uL4', hidden: true }])).toMatch(/trench may not share a Location with a foxhole/);
    expect(fortPlaceIllegal(env, 'ru', [{ kind: 'ditch', hex: 'uL4', hidden: true }, { kind: 'trench', hex: 'uL4', hidden: true }])).toMatch(/One trench counter per hex/);
    // Three squads of capacity: a 3S, a 2S and a 1S, or three 1S, never four squads' worth.
    expect(fortPlaceIllegal(env, 'ru', [fox('uL4', 3)])).toBeNull();
    expect(fortPlaceIllegal(env, 'ru', [fox('uL4', 2), fox('uL5', 1)])).toBeNull();
    expect(fortPlaceIllegal(env, 'ru', [fox('uL4', 1), fox('uL5', 1), fox('uN4', 1)])).toBeNull();
    expect(fortPlaceIllegal(env, 'ru', [fox('uL4', 2), fox('uL5', 2)])).toMatch(/Only 3 squads of foxhole capacity/);
  });
  it('a minefield anywhere but a paved road or rubble hex, a building hex included; 6, 8 or 12 factors; A-T mines by exchange (B28.1, B28.44, B28.5, B28.53)', () => {
    const { engine, state } = game(far);
    const env = engine.env(state);
    const mines = (hex: string, m: FortPlacement['mines'], hidden = true): FortPlacement => ({ kind: 'mines', hex, hidden, mines: m });
    expect(counterTerrainIllegal(env, mines('uK4', { ap: 6 }))).toBeNull();
    expect(counterTerrainIllegal(env, mines('uM4', { ap: 6 }))).toMatch(/paved road hex: no minefield/);
    expect(counterTerrainIllegal(env, mines('uO6', { ap: 6 }))).toMatch(/cannot be placed/);
    expect(counterTerrainIllegal(env, mines('uL4', { ap: 10 as 6 }))).toMatch(/6, 8 or 12 factors/);
    expect(counterTerrainIllegal(env, mines('uL4', { at: 6 as 5 }))).toMatch(/one to five factors/);
    expect(counterTerrainIllegal(env, mines('uL4', {}))).toMatch(/needs its factors/);
    expect(counterTerrainIllegal(env, mines('uL4', { ap: 6, known: true, at: 1 }, false))).toMatch(/Known minefield factors cannot be exchanged/);
    // A-T mines on a paved road: allowed, but in full view (B28.53).
    expect(counterTerrainIllegal(env, mines('uM4', { at: 2 }))).toMatch(/placed in full view/);
    expect(counterTerrainIllegal(env, mines('uM4', { at: 2 }, false))).toBeNull();
    expect(hipIllegal(env, mines('uM4', { at: 2 }, false))).toBeNull();
    // The pools: 12 hidden factors as one 12, two 6s, or 6 + two A-T (3 each); never 14.
    expect(fortPlaceIllegal(env, 'ru', [mines('uL4', { ap: 12 })])).toBeNull();
    expect(fortPlaceIllegal(env, 'ru', [mines('uL4', { ap: 6 }), mines('uL5', { ap: 6 })])).toBeNull();
    expect(fortPlaceIllegal(env, 'ru', [mines('uL4', { ap: 6, at: 2 })])).toBeNull();
    expect(fortPlaceIllegal(env, 'ru', [mines('uL4', { ap: 8 }), mines('uL5', { ap: 6 })])).toMatch(/Only 12 minefield factors/);
    expect(fortPlaceIllegal(env, 'ru', [mines('uL4', { ap: 6 }), mines('uL4', { ap: 6 })])).toMatch(/One minefield per hex/);
    // Known factors are their own pool, A-P only; Dummies are counted, with no factors.
    expect(fortPlaceIllegal(env, 'ru', [mines('uL4', { ap: 6, known: true }, false), mines('uL5', { known: true, dummy: true }, false)])).toBeNull();
    expect(fortPlaceIllegal(env, 'ru', [mines('uL4', { ap: 8, known: true }, false)])).toMatch(/Only 6 Known minefield factors/);
    expect(fortPlaceIllegal(env, 'ru', [mines('uL4', { known: true, dummy: true }, false), mines('uL5', { known: true, dummy: true }, false)])).toMatch(/Only 1 Dummy Minefield counter/);
    expect(counterTerrainIllegal(env, mines('uL4', { known: true, dummy: true, ap: 6 }, false))).toMatch(/Dummy minefield has no factors/);
    // No A-T exchange without the rule's leave.
    const noAt = game(far, { ...PARAMS, mines: { factors: 12 } });
    expect(fortPlaceIllegal(noAt.engine.env(noAt.state), 'ru', [mines('uL4', { at: 1 })])).toMatch(/No A-T mines/);
  });
  it('hidden or open: a minefield is recorded, a Known or Dummy one is on the board, the rest may be either (A12.33, B28.1, B28.45, B28.47)', () => {
    const { engine, state } = game(far);
    const env = engine.env(state);
    expect(hipIllegal(env, { kind: 'mines', hex: 'uL4', hidden: false, mines: { ap: 6 } })).toMatch(/minefield is recorded/);
    expect(hipIllegal(env, { kind: 'mines', hex: 'uL4', hidden: true, mines: { ap: 6, known: true } })).toMatch(/Known or Dummy minefield is placed on the board/);
    expect(hipIllegal(env, { kind: 'mines', hex: 'uL4', hidden: true, mines: { known: true, dummy: true } })).toMatch(/placed on the board/);
    for (const c of [fox('uM5', 1, false), fox('uM5', 1, true), { kind: 'wire' as const, hex: 'uM5', hidden: false }, { kind: 'pillbox' as const, hex: 'uM5', hidden: true, ca: 0, pillbox: { capacity: 1 as const, ca: 3 as const, nca: 5 as const } }]) expect(hipIllegal(env, c)).toBeNull();
  });
  it('a roadblock only in a road hex, on a hexside the road crosses (B29.1), and its extension into woods or a building (B29.2)', () => {
    const { engine, state } = game(far);
    const env = engine.env(state);
    expect(counterTerrainIllegal(env, { kind: 'roadblock', hex: 'uL4', hidden: true, hexside: 0 })).toMatch(/not a road hex/);
    expect(counterTerrainIllegal(env, { kind: 'roadblock', hex: 'uM5', hidden: true })).toMatch(/needs the road hexside/);
    // M5's road runs north to M4 and south to M6: hexside 4 (north) and 1 (south) carry it, the others do not.
    expect(counterTerrainIllegal(env, { kind: 'roadblock', hex: 'uM5', hidden: true, hexside: 4 })).toBeNull();
    expect(counterTerrainIllegal(env, { kind: 'roadblock', hex: 'uM5', hidden: true, hexside: 1 })).toBeNull();
    expect(counterTerrainIllegal(env, { kind: 'roadblock', hex: 'uM5', hidden: true, hexside: 0 })).toMatch(/No road crosses that hexside/);
    // The M4–M5 hexside's vertices touch the woods of L4 and the brush of N4: the roadblock extends into the woods only.
    expect(roadblockExtension(env, { hex: 'uM5', hexside: 4 })).toEqual(['uL4']);
    expect(fortPlaceIllegal(env, 'ru', [{ kind: 'roadblock', hex: 'uM5', hidden: true, hexside: 4 }, { kind: 'roadblock', hex: 'uM6', hidden: true, hexside: 4 }])).toMatch(/Only 1 roadblock/);
    // One roadblock per hexside, set up from either of its hexes: M5's south hexside is M6's north one.
    const two = game(far, { ...PARAMS, roadblocks: 2 }).engine.env(state);
    expect(fortPlaceIllegal(two, 'ru', [{ kind: 'roadblock', hex: 'uM5', hidden: true, hexside: 1 }, { kind: 'roadblock', hex: 'uM6', hidden: true, hexside: 4 }])).toMatch(/One roadblock per hexside \(uM5-uM6/);
    expect(fortPlaceIllegal(two, 'ru', [{ kind: 'roadblock', hex: 'uM5', hidden: true, hexside: 1 }, { kind: 'roadblock', hex: 'uM5', hidden: true, hexside: 4 }])).toBeNull();
  });
  it('a pillbox only in Open Ground, brush, orchard, grain or woods, with a Covered Arc, its factors as printed; one per hex, with or without an entrenchment (B30.1, B30.11, B30.8)', () => {
    const { engine, state } = game(far);
    const env = engine.env(state);
    const pb = (hex: string, ca?: number): FortPlacement => ({ kind: 'pillbox', hex, hidden: true, ...(ca !== undefined ? { ca } : {}), pillbox: { capacity: 1, ca: 3, nca: 5 } });
    expect(counterTerrainIllegal(env, pb('uK4', 0))).toMatch(/only a minefield/);
    expect(counterTerrainIllegal(env, pb('uO6', 0))).toMatch(/only in Open Ground, brush, orchard, grain or woods/);
    expect(counterTerrainIllegal(env, pb('uL4'))).toMatch(/needs a Covered Arc/);
    for (const hex of ['uL4', 'uN4', 'uM4', 'uK5']) expect(counterTerrainIllegal(env, pb(hex, 2)), hex).toBeNull();
    expect(pillboxCaHexsides(0)).toEqual([5, 0]);
    expect(pillboxCaHexsides(3)).toEqual([2, 3]);
    // A trench (or A-T Ditch) in the pillbox's hex makes it a bunker (B30.8); a foxhole may share it too (B27.1 lists no pillbox).
    expect(fortPlaceIllegal(env, 'ru', [pb('uL4', 0), fox('uL4')])).toBeNull();
    expect(fortPlaceIllegal(env, 'ru', [pb('uL4', 0), { kind: 'trench', hex: 'uL4', hidden: true }])).toBeNull();
    expect(fortPlaceIllegal(env, 'ru', [pb('uL4', 0), { kind: 'ditch', hex: 'uL4', hidden: true }])).toBeNull();
    // The counters pair the Defense Modifications 3+5, 4+6, 5+7 (B30.11).
    expect(counterTerrainIllegal(env, { ...pb('uL4', 0), pillbox: { capacity: 1, ca: 3, nca: 7 } })).toMatch(/No pillbox counter is 1\+3\+7/);
    expect(counterTerrainIllegal(env, { ...pb('uL4', 0), pillbox: { capacity: 2, ca: 4, nca: 6 } })).toBeNull();
    expect(pillboxGray({ capacity: 3, ca: 5, nca: 7 })).toBe(true);
    expect(pillboxGray({ capacity: 1, ca: 3, nca: 5 })).toBe(false);
    expect(fortPlaceIllegal(env, 'ru', [{ ...pb('uL4', 0), pillbox: { capacity: 2, ca: 3, nca: 5 } }])).toMatch(/No pillbox 2\+3\+5/);
    // Mines and Wire may share its hex.
    expect(fortPlaceIllegal(env, 'ru', [pb('uL4', 0), { kind: 'wire', hex: 'uL4', hidden: true }, { kind: 'mines', hex: 'uL4', hidden: true, mines: { ap: 6 } }])).toBeNull();
  });
  it('only inside the area the rule allows, and only once', () => {
    const { engine, state } = game(far);
    const env = engine.env(state);
    expect(fortArea(env, 'ru')).toEqual([...AREA].sort());
    expect(fortPlaceIllegal(env, 'ru', [fox('uA1')])).toMatch(/outside the area/);
    expect(fortPlaceIllegal(env, 'ge', [fox('uL4')])).toMatch(/no fortification counters/);
    const s = place(engine, state, [fox('uL4')]);
    expect(fortPlaceIllegal(engine.env(s), 'ru', [fox('uL5')])).toMatch(/already placed/);
    expect(fortCounters(engine.env(s))).toEqual([{ id: 'ru.fort1', side: 'ru', kind: 'foxhole', hex: 'uL4', hidden: true, capacity: 1 }]);
  });
  it("the engine's own placement uses every pool legally", () => {
    const { engine, state } = game(far);
    const env = engine.env(state);
    const counters = defaultFortPlacement(env, 'ru');
    expect(fortPlaceIllegal(env, 'ru', counters)).toBeNull();
    const kinds = counters.map((c) => c.kind);
    for (const k of ['foxhole', 'trench', 'ditch', 'wire', 'roadblock', 'pillbox', 'mines']) expect(kinds, k).toContain(k);
    const left = fortPools(env, 'ru', counters);
    expect([left.foxholes, left.trenches, left.ditch, left.wire, left.roadblocks, left.pillboxes.length, left.factors, left.known, left.dummies]).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(counters.filter((c) => c.kind === 'mines' && !c.mines?.known).every((c) => c.hidden)).toBe(true);
    expect(counters.filter((c) => c.kind === 'mines' && c.mines?.known).every((c) => !c.hidden)).toBe(true);
  });
});

describe('units set up with the counters', () => {
  const units: PieceSpec[] = [
    { id: 'g', def: 'ge.467', side: 'ge', hex: 'uY1' },
    { id: 'a', def: 'ru.447', side: 'ru', hex: 'uL4' },
    { id: 'b', def: 'ru.447', side: 'ru', hex: 'uL4' },
    { id: 'l', def: 'ru.L91', side: 'ru', hex: 'uL4' },
    { id: 'c', def: 'ge.228c', side: 'ru', hex: 'uL5' },
    { id: 'gun', def: 'ge.AT75L', side: 'ru', heldBy: 'c' },
  ];
  const setup = (placements: Record<string, string>, extra: Partial<SetupAction> = {}): SetupAction => ({ type: 'setup.place', side: 'ru', decisionId: 'd', placements, ...extra });
  it('beneath a foxhole: its squad capacity plus four SMC; a Gun only beneath a trench (B27.1, B27.12, B27.51)', () => {
    const { engine, state } = game(units);
    const s = place(engine, state, [fox('uL4', 1), { kind: 'trench', hex: 'uL5', hidden: true }]);
    const env = engine.env(s);
    expect(fortSetupIllegal(env, 'ru', setup({ a: 'uL4', l: 'uL4' }, { beneath: ['a', 'l'] }))).toBeNull();
    expect(fortSetupIllegal(env, 'ru', setup({ a: 'uL4', b: 'uL4' }, { beneath: ['a', 'b'] }))).toMatch(/foxhole 1S in uL4 holds 1 squad \(ASLRB B27.12\)/);
    expect(fortSetupIllegal(env, 'ru', setup({ a: 'uL4', b: 'uL4' }, { beneath: ['a'] }))).toBeNull();
    expect(fortSetupIllegal(env, 'ru', setup({ a: 'uL5' }, { beneath: ['a'] }))).toBeNull();
    expect(fortSetupIllegal(env, 'ru', setup({ a: 'uN4' }, { beneath: ['a'] }))).toMatch(/No foxhole, trench or Wire of yours in uN4/);
    // The AT Gun's crew may start beneath the trench, not beneath the foxhole (only a mortar may).
    expect(fortSetupIllegal(env, 'ru', setup({ c: 'uL5' }, { beneath: ['c'] }))).toBeNull();
    expect(fortSetupIllegal(env, 'ru', setup({ c: 'uL4' }, { beneath: ['c'] }))).toMatch(/only Infantry, SW and a mortar may \(ASLRB B27.1\)/);
    // Nor the Gun counter itself, set up beneath the foxhole on its own.
    expect(fortSetupIllegal(env, 'ru', setup({ gun: 'uL4' }, { beneath: ['gun'] }))).toMatch(/gun cannot be placed beneath a foxhole: only Infantry, SW and a mortar may/);
    expect(fortSetupIllegal(env, 'ru', setup({ gun: 'uL5' }, { beneath: ['gun'] }))).toBeNull();
  });
  it('inside a pillbox: its capacity, one Gun, no vehicle, only the owner (B30.111)', () => {
    const { engine, state } = game(units);
    const s = place(engine, state, [{ kind: 'pillbox', hex: 'uN4', hidden: true, ca: 0, pillbox: { capacity: 1, ca: 3, nca: 5 } }]);
    const env = engine.env(s);
    expect(locationsOf(env, 'uN4')).toEqual(['uN4', 'uN4:pb']);
    expect(env.query('loc.adjacent', { loc: 'uN4:pb' }, [])).toEqual(['uN4']);
    expect(env.query('loc.adjacent', { loc: 'uN4' }, [])).toContain('uN4:pb');
    expect(fortSetupIllegal(env, 'ru', setup({ a: 'uN4:pb', l: 'uN4:pb', b: 'uN4' }))).toBeNull();
    expect(fortSetupIllegal(env, 'ru', setup({ a: 'uN4:pb', b: 'uN4:pb' }))).toMatch(/pillbox in uN4 holds 1 squad \(ASLRB B30.111\)/);
    expect(fortSetupIllegal(env, 'ru', setup({ c: 'uN4:pb' }))).toBeNull();
    expect(fortSetupIllegal(env, 'ru', setup({ a: 'uN5:pb' }))).toMatch(/No pillbox of yours in uN5/);
    expect(fortSetupIllegal(env, 'ge', setup({ g: 'uN4:pb' }))).toMatch(/No pillbox of yours/);
  });
});

describe('hidden counters and their reveal (A12.33)', () => {
  // The Germans start off the map and are set down where each test wants them.
  const pieces: PieceSpec[] = [
    { id: 'g', def: 'ge.467', side: 'ge' },
    { id: 'gb', def: 'ge.467', side: 'ge', tags: { broken: true } },
    { id: 'r', def: 'ru.447', side: 'ru', hex: 'uA1' },
  ];
  const counters: FortPlacement[] = [
    fox('uL4', 2),
    { kind: 'wire', hex: 'uN5', hidden: true },
    { kind: 'mines', hex: 'uN6', hidden: true, mines: { ap: 8 } },
    { kind: 'mines', hex: 'uK6', hidden: false, mines: { ap: 6, known: true } },
    { kind: 'mines', hex: 'uL6', hidden: false, mines: { known: true, dummy: true } },
    { kind: 'pillbox', hex: 'uN4', hidden: true, ca: 1, pillbox: { capacity: 1, ca: 3, nca: 5 } },
    { kind: 'trench', hex: 'uM6', hidden: false },
  ];
  const move = (engine: Engine, s: GameState, id: string, hex: string) => act(engine, s, { type: 'test.teleport', id, hex }).state;
  it('the other side sees open and revealed counters, a Known or Dummy minefield as a blank counter, nothing hidden; the owner everything', () => {
    const { engine, state } = game(pieces);
    const s = place(engine, state, counters);
    const env = engine.env(s);
    expect(fortificationView(env, 'ru').map((c) => c.id)).toEqual(['ru.fort1', 'ru.fort2', 'ru.fort3', 'ru.fort4', 'ru.fort5', 'ru.fort6', 'ru.fort7']);
    const theirs = fortificationView(env, 'ge');
    expect(theirs.map((c) => `${c.kind}@${c.hex}`)).toEqual(['mines@uK6', 'mines@uL6', 'trench@uM6']);
    // Both Known counters look alike: no strength, no Dummy flag.
    expect(theirs[0]!.mines).toEqual({ known: true });
    expect(theirs[1]!.mines).toEqual({ known: true });
    expect(fortificationView(env, null).map((c) => c.id)).toEqual(['ru.fort4', 'ru.fort5', 'ru.fort7']);
    const seen = redactState(engine, s, 'ge');
    expect(((seen.ext['asl.fortifications'] as { counters: FortRecord[] }).counters).map((c) => c.id)).toEqual(['ru.fort4', 'ru.fort5', 'ru.fort7']);
    expect(JSON.stringify(seen)).not.toContain('uN6');
    expect(JSON.stringify(seen)).not.toContain('"ca":1');
    // The hidden pillbox makes no Location for the other side.
    expect(locationsOf(engine.env(seen), 'uN4')).toEqual(['uN4']);
  });
  it('a Good Order enemy ground unit with a LOS within 16 hexes reveals a hidden counter in Concealment Terrain; a minefield never (A12.33, B28.1)', () => {
    const { engine, state } = game(pieces);
    let s = place(engine, state, counters);
    expect(seenByEnemy(engine.env(s), fortCounters(engine.env(s))[0]!)).toBe(false);
    // Seventeen hexes off along the row: still hidden; sixteen: seen.
    s = move(engine, s, 'g', 'uCC4');
    expect(fortCounters(engine.env(s)).find((c) => c.hex === 'uL4')!.revealed).toBeUndefined();
    s = move(engine, s, 'g', 'uBB4');
    expect(fortCounters(engine.env(s)).find((c) => c.hex === 'uL4')!.revealed).toBe(true);
    // The Wire in Open Ground went at any range; the recorded minefield stays recorded; the pillbox in brush too, seen.
    expect(fortCounters(engine.env(s)).find((c) => c.hex === 'uN5')!.revealed).toBe(true);
    expect(fortCounters(engine.env(s)).find((c) => c.hex === 'uN6')!.revealed).toBeUndefined();
    expect(fortCounters(engine.env(s)).find((c) => c.hex === 'uN4')!.revealed).toBe(true);
    expect(fortificationView(engine.env(s), 'ge').map((c) => c.hex)).toEqual(['uL4', 'uN5', 'uK6', 'uL6', 'uN4', 'uM6']);
    // Once revealed, the German's snapshot has the foxhole with its size and the pillbox with its arc (A12.31: never hidden again).
    const seen = redactState(engine, s, 'ge');
    expect(((seen.ext['asl.fortifications'] as { counters: FortRecord[] }).counters).find((c) => c.hex === 'uN4')).toMatchObject({ kind: 'pillbox', ca: 1, revealed: true });
    expect(locationsOf(engine.env(seen), 'uN4')).toEqual(['uN4', 'uN4:pb']);
  });
  it('a broken enemy reveals nothing, even in the counter\'s own hex; a unit in Open Ground is seen at any range (A12.33)', () => {
    const { engine, state } = game(pieces);
    let s = place(engine, state, counters);
    s = move(engine, s, 'gb', 'uM3');
    expect(fortCounters(engine.env(s)).some((c) => c.revealed)).toBe(false);
    // Not even in the foxhole's own hex: only a Good Order enemy ground unit reveals it.
    s = move(engine, s, 'gb', 'uL4');
    expect(fortCounters(engine.env(s)).find((c) => c.hex === 'uL4')!.revealed).toBeUndefined();
    s = move(engine, s, 'g', 'uGG1');
    // The Wire at N5 (Open Ground) is 20 hexes from GG1 with a clear LOS across the open board: revealed; the foxhole in the woods of L4, 21 hexes off, is not.
    const after = fortCounters(engine.env(s));
    expect(after.find((c) => c.hex === 'uN5')!.revealed).toBe(true);
    expect(after.find((c) => c.hex === 'uL4')!.revealed).toBeUndefined();
  });
  it('with no Dummy allotted, one free Dummy for every 24 Known minefield factors set up (B28.47)', () => {
    const params = { side: 'ru', mines: { known: 60 } };
    const { engine, state } = game(far, params);
    const env = engine.env(state);
    const known = (hex: string): FortPlacement => ({ kind: 'mines', hex, hidden: false, mines: { ap: 12, known: true } });
    const dummy = (hex: string): FortPlacement => ({ kind: 'mines', hex, hidden: false, mines: { known: true, dummy: true } });
    expect(fortPools(env, 'ru', []).dummies).toBe(0);
    // 24 Known factors: one Dummy; 48: two; 36 still one.
    expect(fortPools(env, 'ru', [known('uL4'), known('uL5')]).dummies).toBe(1);
    expect(fortPlaceIllegal(env, 'ru', [known('uL4'), known('uL5'), dummy('uK5')])).toBeNull();
    expect(fortPlaceIllegal(env, 'ru', [known('uL4'), known('uL5'), known('uN5'), dummy('uK5'), dummy('uO5')])).toMatch(/Only 1 Dummy Minefield counter: one for every 24 Known minefield factors set up/);
    expect(fortPlaceIllegal(env, 'ru', [known('uL4'), known('uL5'), known('uN5'), known('uN6'), dummy('uK5'), dummy('uO5')])).toBeNull();
    expect(fortPlaceIllegal(env, 'ru', [known('uL4'), dummy('uK5')])).toMatch(/Only 0 Dummy/);
    // The engine's own placement takes them too.
    expect(defaultFortPlacement(env, 'ru').filter((c) => c.mines?.dummy)).toHaveLength(2);
  });
  it('A-T mines in full view on a paved road: the counter is seen, its factors only once a Good Order enemy ground unit has a LOS (B28.53, A12.33)', () => {
    const { engine, state } = game(pieces);
    let s = place(engine, state, [{ kind: 'mines', hex: 'uM4', hidden: false, mines: { at: 2 } }]);
    expect(fortificationView(engine.env(s), 'ge')).toMatchObject([{ hex: 'uM4', kind: 'mines', mines: {} }]);
    expect(fortificationView(engine.env(s), 'ge')[0]!.mines?.at).toBeUndefined();
    // A broken German in LOS shows nothing; a Good Order one, any range off across Open Ground, sees the factors.
    s = move(engine, s, 'gb', 'uM3');
    expect(fortificationView(engine.env(s), 'ge')[0]!.mines?.at).toBeUndefined();
    const r = act(engine, s, { type: 'test.teleport', id: 'g', hex: 'uGG4' });
    expect(r.events.find((e) => e.type === 'asl.fort.revealed')?.payload).toMatchObject({ reason: 'strength' });
    expect(fortificationView(engine.env(r.state), 'ge')).toMatchObject([{ hex: 'uM4', mines: { at: 2, strengthRevealed: true } }]);
    expect(((redactState(engine, r.state, 'ge').ext['asl.fortifications'] as { counters: FortRecord[] }).counters)[0]!.mines).toMatchObject({ at: 2 });
  });
  it('the Dummy Secret dr adds half its value in Dummy counters, known to the owner alone (B28.47)', () => {
    const { engine, state } = game(far, PARAMS, { dice: [5] });
    const env = engine.env(state);
    expect(fortPools(env, 'ru', []).dummies).toBe(3);
    expect((redactState(engine, state, 'ge').ext['asl.fortifications'] as { extraDummies?: unknown }).extraDummies).toBeUndefined();
    expect((redactState(engine, state, 'ru').ext['asl.fortifications'] as { extraDummies?: unknown }).extraDummies).toEqual({ ru: 2 });
  });
});
