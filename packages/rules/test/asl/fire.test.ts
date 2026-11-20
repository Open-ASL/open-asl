import { describe, expect, it } from 'vitest';
import type { Action, Engine, GameState, RuleModule } from '@asl/engine';
import {
  BLAZE_ESCAPE_DECISION,
  FIRE_PROC,
  FORTIFIED_MODULE,
  aslCoreModules,
  blazeAt,
  burnable,
  controlState,
  directlyAttached,
  fireNumbers,
  fireState,
  flamesAt,
  fortifiedModule,
  fortifiedRevealed,
  redactState,
  hexsideForDr,
  kindleIllegal,
  moveState,
  piecesModule,
  sideToward,
  spreadDrm,
  statics,
  placeBlaze,
  placeFlame,
  turnModule,
  windOf,
  windAt,
  downwind,
  smoke58Counters,
  interdicted,
  hexOfLoc,
  blazeSmokeLevels,
  type HexTerrainSpec,
  type TryFlameFn,
  spreadTargets,
  kindlingDrm,
} from '../../src';
import { FP, type AttackResolvedFn, type AttackResolvedInfo } from '../../src/sk1/fire';
import { sk1CoreModules } from '../../src/sk1';
import { sk2CoreModules } from '../../src/sk2';
import { sk3CoreModules } from '../../src/sk3';
import { act, makeEngine, type PieceSpec } from '../fixtures';
import { testFire } from './helpers';

/*
 * Fire in full ASL (ASLRB B25): Kindling (B25.11), a Flame becoming a Blaze (B25.15, B25.151), spreading with and
 * without wind (B25.6–B25.651), the Blaze's smoke (B25.2), no entry (B25.4), leaving a Blaze in the RtPh (B25.4),
 * Flame clearance (B25.7, B24.72) and Control forfeited by a Kindled Fire (A26.16). Board u's K4–K5 stone Two Story
 * House with woods at K3 and L3 beside it; the Germans attack first.
 */

const LEVELS = { upper: 1 as const, stairwell: 'inherent' as const };
const TERRAIN: Record<string, HexTerrainSpec> = {
  uK4: { terrain: 'building-stone', buildingId: 'u-B16', building: LEVELS, obstacleHeight: 1.5 },
  uK5: { terrain: 'building-stone', buildingId: 'u-B16', building: LEVELS, obstacleHeight: 1.5 },
  uK3: { terrain: 'woods' },
  uL3: { terrain: 'woods' },
  uJ3: { terrain: 'woods' },
  uM4: { terrain: 'brush' },
  uL5: { terrain: 'building-wood' },
};
const SK: RuleModule[] = [piecesModule, turnModule, ...sk1CoreModules, ...sk2CoreModules, ...sk3CoreModules];
const ASL: RuleModule[] = [...SK, ...aslCoreModules];

/** Test-only: place a Blaze or a Flame as a special rule would (`asl.fire.*` events), with a kindler when given. */
const testFires: RuleModule = {
  id: 'test.fires',
  install(r) {
    r.action<Action & { type: 'test.blaze'; loc: string; by?: string; turn?: number; attacker?: string }>({
      type: 'test.blaze',
      decisionKinds: ['phase', BLAZE_ESCAPE_DECISION],
      resolve(ctx, a) {
        placeBlaze(ctx, a.loc, { kindledBy: a.by ?? null, source: 'ssr', since: { turn: a.turn ?? 0, attacker: a.attacker ?? 'ru' } });
      },
    });
    r.action<Action & { type: 'test.flame'; loc: string; by?: string; turn?: number; attacker?: string }>({
      type: 'test.flame',
      decisionKinds: ['phase'],
      resolve(ctx, a) {
        placeFlame(ctx, a.loc, { kindledBy: a.by ?? null, source: 'ssr', since: { turn: a.turn ?? 0, attacker: a.attacker ?? 'ru' } });
      },
    });
  },
};

const scenario = (extra: Record<string, unknown> = {}) => ({
  firstSide: 'ge',
  sides: [
    { side: 'ge', name: 'German', nationality: 'ge', elr: 3 },
    { side: 'ru', name: 'Russian', nationality: 'ru', elr: 3 },
  ],
  month: 8,
  turns: 6,
  ec: 'moderate' as const,
  weather: { wind: { from: 'W' as const, force: 'calm' as const } },
  ...extra,
});

function game(pieces: PieceSpec[], opts: { dice?: number[]; startPhase?: string; scenario?: Record<string, unknown>; terrain?: Record<string, HexTerrainSpec>; extra?: RuleModule[] } = {}) {
  return makeEngine({
    board: 'u',
    terrain: opts.terrain ?? TERRAIN,
    scenario: scenario(opts.scenario),
    modules: ASL,
    extra: [testFire, testFires, ...(opts.extra ?? [])],
    pieces,
    ...(opts.dice ? { dice: opts.dice } : {}),
    ...(opts.startPhase ? { startPhase: opts.startPhase } : {}),
  });
}

/** Pass every decision (end phases, decline fire, stay put) until `phase` of that Player Turn has begun. */
function until(engine: Engine, state: GameState, phase: string, opts: { turn?: number; attacker?: string } = {}): GameState {
  let s = state;
  for (let guard = 0; guard < 400; guard++) {
    if (s.result) throw new Error(`game over before ${phase}: ${JSON.stringify(s.result)} at turn ${s.turn} ${s.attacker} ${s.phase} guard ${guard}`);
    if (s.phase === phase && (opts.turn === undefined || s.turn === opts.turn) && (opts.attacker === undefined || s.attacker === opts.attacker)) return s;
    const d = engine.currentDecision(s)!;
    const legal = engine.legalActions(s, d.owner);
    const pick = ['defPass', 'defRofDecline', 'blaze.stay', 'rout.stay', 'cc.arranged', 'endPhase'].map((t) => legal.find((a) => a.type === t)).find(Boolean) ?? legal.find((a) => a.type === 'cc.declare' && (a['attacks'] as unknown[]).length === 0);
    if (!pick) throw new Error(`cannot pass ${d.kind} (${d.owner}) in ${s.phase}: ${[...new Set(legal.map((a) => a.type))].join(', ')}`);
    s = engine.submit(s, pick).state;
  }
  throw new Error(`never reached ${phase}`);
}

const events = (res: { events: { type: string; payload: unknown }[] }, type: string) => res.events.filter((e) => e.type === type).map((e) => e.payload as Record<string, unknown>);

const RU_HOUSE: PieceSpec[] = [
  { id: 'l', def: 'ru.L91', side: 'ru', hex: 'uK4' },
  { id: 's1', def: 'ru.447', side: 'ru', hex: 'uK4' },
  { id: 'h1', def: 'ru.247', side: 'ru', hex: 'uK4' },
  { id: 'g1', def: 'ge.467', side: 'ge', hex: 'uR4' },
];

describe('Burnable Terrain and its numbers (B25.1, the Terrain Chart)', () => {
  it('gives every board-u terrain its Kindle # and Spread #, and none to Open Ground', () => {
    const { engine, state } = game(RU_HOUSE);
    const env = engine.env(state);
    expect(fireNumbers(env, 'uK4')).toEqual({ kindle: 8, spread: 9 });
    expect(fireNumbers(env, 'uK4:1')).toEqual({ kindle: 8, spread: 9 });
    expect(fireNumbers(env, 'uK3')).toEqual({ kindle: 9, spread: 7 });
    expect(fireNumbers(env, 'uM4')).toEqual({ kindle: 9, spread: 6 });
    expect(fireNumbers(env, 'uL5')).toEqual({ kindle: 7, spread: 8 });
    expect(burnable(env, 'uR4')).toBe(false);
    expect(fireNumbers(env, 'uR4')).toBeNull();
  });
});

describe('Kindling (B25.11)', () => {
  it('offers a squad with a leader the attempt and refuses one without, a pinned unit, Open Ground and a lone squad', () => {
    const { engine, state } = game([...RU_HOUSE, { id: 's2', def: 'ru.447', side: 'ru', hex: 'uK5' }, { id: 's3', def: 'ru.447', side: 'ru', hex: 'uK3', tags: { pinned: true } }], { scenario: { firstSide: 'ru' } });
    const env = engine.env(state);
    const legal = engine.legalActions(state, 'ru').filter((a) => a.type === 'fire.kindle');
    expect(legal.map((a) => a['loc'])).toEqual(['uK4', 'uK4']);
    expect(kindleIllegal(env, { loc: 'uK5', attempts: [{ unit: 's2' }], side: 'ru' })).toMatch(/leader directs/);
    expect(kindleIllegal(env, { loc: 'uK3', attempts: [{ unit: 's3', director: 'l' }], side: 'ru' })).toMatch(/unpinned/);
    expect(kindleIllegal(env, { loc: 'uR4', attempts: [{ unit: 'g1' }], side: 'ru' })).toMatch(/not Burnable/);
    expect(kindleIllegal(env, { loc: 'uK4', attempts: [{ unit: 'l' }, { unit: 's1', director: 'l' }], side: 'ru' })).toMatch(/both make a Kindling attempt and direct/);
  });

  it('rolls the leader NTC, then each DR with the leadership reversed and the HS -1, marks everyone Prep Fire and places a Flame', () => {
    // NTC 3+3 = 6 ≤ 9 passes; squad 4+3 = 7 +1 (9-1 reversed) = 8 ≥ 8: a Flame; HS 3+3 = 6 +1 -1 = 6 < 8: none.
    const { engine, state } = game(RU_HOUSE, { scenario: { firstSide: 'ru' }, dice: [3, 3, 4, 3, 3, 3] });
    const t = act(engine, state, { type: 'fire.kindle', loc: 'uK4', attempts: [{ unit: 's1', director: 'l' }, { unit: 'h1', director: 'l' }] });
    expect(events(t, 'asl.fire.ntc')[0]).toMatchObject({ unit: 'l', dr: [3, 3], target: 9, passed: true });
    const rolls = events(t, 'asl.fire.kindle');
    expect(rolls[0]).toMatchObject({ unit: 's1', director: 'l', drm: 1, needed: 8, flame: true, explain: ['+1 leadership reversed'] });
    expect(rolls[1]).toMatchObject({ unit: 'h1', drm: 0, flame: false, explain: ['-1 half-squad', '+1 leadership reversed'] });
    expect(flamesAt(engine.env(t.state), 'uK4')).toHaveLength(1);
    expect(flamesAt(engine.env(t.state), 'uK4')[0]).toMatchObject({ kindledBy: 'ru', since: { turn: 1, attacker: 'ru' } });
    for (const id of ['l', 's1', 'h1']) expect(t.state.pieces[id]!.tags['fire']).toBe('prep');
    // A second attempt in the Location this phase is refused (predesignation), and the kindlers may not fire.
    expect(engine.validate(t.state, { type: 'fire.kindle', loc: 'uK4', attempts: [{ unit: 's1', director: 'l' }], side: 'ru', decisionId: engine.currentDecision(t.state)!.id } as Action)).toMatch(/predesignated|already fired/);
    expect(engine.validate(t.state, { type: 'test.fire', decl: { units: ['s1'], sw: [], target: 'uR4' }, mode: 'prep', side: 'ru', decisionId: engine.currentDecision(t.state)!.id } as Action)).not.toBeNull();
  });

  it('a failed NTC makes no DR but the units are Prep Fire all the same; a lone leader takes -2 and the EC DRM applies outside a building', () => {
    const { engine, state } = game([{ id: 'l', def: 'ru.L91', side: 'ru', hex: 'uK3' }, { id: 's1', def: 'ru.447', side: 'ru', hex: 'uK3' }, { id: 'g1', def: 'ge.467', side: 'ge', hex: 'uR4' }], {
      scenario: { firstSide: 'ru', ec: 'dry' },
      dice: [6, 6, 5, 6, 6, 6],
    });
    let t = act(engine, state, { type: 'fire.kindle', loc: 'uK3', attempts: [{ unit: 's1', director: 'l' }] });
    expect(events(t, 'asl.fire.ntc')[0]).toMatchObject({ passed: false });
    expect(events(t, 'asl.fire.kindle')).toHaveLength(0);
    expect(t.state.pieces['s1']!.tags['fire']).toBe('prep');
    expect(t.state.pieces['l']!.tags['fire']).toBe('prep');
    // Another game: the leader alone in the woods, EC Dry: NTC 5+6 = 11 > 9 fails... so give him a pass: 5+1.
    const g2 = game([{ id: 'l', def: 'ru.L91', side: 'ru', hex: 'uK3' }, { id: 'g1', def: 'ge.467', side: 'ge', hex: 'uR4' }], { scenario: { firstSide: 'ru', ec: 'dry' }, dice: [5, 1, 6, 4] });
    t = act(g2.engine, g2.state, { type: 'fire.kindle', loc: 'uK3', attempts: [{ unit: 'l' }] });
    expect(events(t, 'asl.fire.kindle')[0]).toMatchObject({ unit: 'l', drm: -1, needed: 9, flame: true, explain: ['-2 SMC', 'EC +1'] });
  });

  it('the kindlers can move and fire again next Player Turn', () => {
    const { engine, state } = game(RU_HOUSE, { scenario: { firstSide: 'ru' }, dice: [3, 3, 4, 3, ...Array(40).fill(1)] });
    let s = act(engine, state, { type: 'fire.kindle', loc: 'uK4', attempts: [{ unit: 's1', director: 'l' }] }).state;
    s = until(engine, s, 'MPh', { turn: 2, attacker: 'ru' });
    expect(s.pieces['s1']!.tags['fire']).toBeUndefined();
    expect(engine.legalActions(s, 'ru').some((a) => a.type === 'move.start' && (a['units'] as string[]).includes('s1'))).toBe(true);
  });
});

describe('A Flame becomes a Blaze (B25.15, B25.151)', () => {
  it('does not roll in the Player Turn it appeared, rolls at the next AFPh end, and a Final DR of 2 puts it out', () => {
    // Placed in the Russian PFPh of turn 1; the Russian AFPh passes; the German AFPh end rolls 5+4 = 9 ≥ 9: a Blaze.
    const { engine, state } = game(RU_HOUSE, { scenario: { firstSide: 'ru' }, dice: [3, 3, 4, 3, /* wind change DR at the German RPh */ 3, 4, /* Blaze DR */ 5, 4] });
    let s = act(engine, state, { type: 'fire.kindle', loc: 'uK4', attempts: [{ unit: 's1', director: 'l' }] }).state;
    s = until(engine, s, 'APh', { turn: 1, attacker: 'ru' });
    expect(blazeAt(engine.env(s), 'uK4')).toBeUndefined();
    expect(flamesAt(engine.env(s), 'uK4')).toHaveLength(1);
    s = until(engine, s, 'APh', { turn: 1, attacker: 'ge' });
    expect(blazeAt(engine.env(s), 'uK4')).toMatchObject({ kindledBy: 'ru', since: { turn: 1, attacker: 'ge' } });
    expect(flamesAt(engine.env(s), 'uK4')).toHaveLength(0);
  });

  it('a Final DR of 2 extinguishes the Flame; the EC DRM does not apply in a building', () => {
    const { engine, state } = game(RU_HOUSE, { scenario: { firstSide: 'ru', ec: 'veryDry' }, dice: [3, 3, 4, 3, 3, 4, 1, 1] });
    let s = act(engine, state, { type: 'fire.kindle', loc: 'uK4', attempts: [{ unit: 's1', director: 'l' }] }).state;
    const before = flamesAt(engine.env(s), 'uK4').length;
    expect(before).toBe(1);
    s = until(engine, s, 'APh', { turn: 1, attacker: 'ge' });
    expect(flamesAt(engine.env(s), 'uK4')).toHaveLength(0);
    expect(blazeAt(engine.env(s), 'uK4')).toBeUndefined();
  });
});

describe('Spreading Fire (B25.6–B25.62)', () => {
  it('spreads from a Blaze older than the Player Turn to adjacent Burnable Locations with the terrain DRM, not into Open Ground', () => {
    // A ground Blaze in K4 (stone house, turn 0): K5 (same building, attached) ≥ 9; K4 level 1 ≥ 9 +1 higher; the K3 woods ≥ 7 -2 not attached.
    const { engine, state } = game(RU_HOUSE, { scenario: { firstSide: 'ru' }, startPhase: 'AFPh', dice: [6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6] });
    let t = act(engine, state, { type: 'test.blaze', loc: 'uK4' });
    const env = engine.env(t.state);
    expect(spreadDrm(env, 'uK4', 'uK5')).toMatchObject({ drm: 0 });
    expect(spreadDrm(env, 'uK4', 'uK4:1')).toMatchObject({ drm: 1, explain: ['+1 to a higher elevation'] });
    expect(spreadDrm(env, 'uK4', 'uK3')).toMatchObject({ drm: -2, explain: ['-2 not directly attached'] });
    t = act(engine, t.state, { type: 'endPhase' });
    const spread = events(t, 'asl.fire.spread');
    expect(spread.map((e) => e['to']).sort()).toEqual(['uK3', 'uK4:1', 'uK5', 'uL3', 'uJ3'].sort());
    for (const e of spread) expect(e['flame']).toBe(true);
    expect(flamesAt(engine.env(t.state), 'uK5')).toHaveLength(1);
    expect(flamesAt(engine.env(t.state), 'uK5')[0]!.kindledBy).toBeNull();
  });

  it('a Blaze above ground spreads to the Location at its height in every adjacent hex: another building, or woods on a hill (B25.6)', () => {
    // K4 level 1 (height 1): K5 level 1 (same house), L4 level 1 (another house), K3 woods on a level 1 hill; not the
    // ground of J4 (lower: no diagonal spread), nor K4's own ground beyond the vertical spread.
    const terrain: Record<string, HexTerrainSpec> = {
      ...TERRAIN,
      uL4: { terrain: 'building-wood', buildingId: 'u-T1', building: LEVELS, obstacleHeight: 1.5 },
      uK3: { terrain: 'woods', elevation: 1 },
      uJ4: { terrain: 'woods' },
    };
    const { engine, state } = game(RU_HOUSE, { terrain });
    const env = engine.env(state);
    expect(spreadTargets(env, 'uK4:1').sort()).toEqual(['uK3', 'uK4', 'uK5:1', 'uL4:1'].sort());
    expect(spreadDrm(env, 'uK4:1', 'uL4:1').explain).toContain('-2 not directly attached');
  });

  it('a Blaze made this Player Turn does not spread until the next; two Blazes beside one Location give it one DR with the better chance', () => {
    const { engine, state } = game(RU_HOUSE, { startPhase: 'AFPh', dice: Array(40).fill(1) });
    // A fresh Blaze in K4 this Player Turn, an old one in K5: K5 spreads, K4 does not.
    let t = act(engine, state, { type: 'test.blaze', loc: 'uK4', turn: 1, attacker: 'ge' });
    t = act(engine, t.state, { type: 'test.blaze', loc: 'uK5' });
    t = act(engine, t.state, { type: 'endPhase' });
    const spread = events(t, 'asl.fire.spread');
    expect(spread.every((e) => e['from'] === 'uK5')).toBe(true);
    expect(new Set(spread.map((e) => e['to'])).size).toBe(spread.length);
  });

  it('woods beside woods are attached when their depictions touch, and an orchard beside an orchard always', () => {
    const terrain: Record<string, HexTerrainSpec> = { ...TERRAIN, uK3: { terrain: 'woods', bypassBlocked: [0, 1, 2, 3, 4, 5] }, uL3: { terrain: 'woods', bypassBlocked: [0, 1, 2, 3, 4, 5] }, uJ3: { terrain: 'woods' }, uM4: { terrain: 'orchard' }, uL4: { terrain: 'orchard' } };
    const { engine, state } = game(RU_HOUSE, { terrain });
    const env = engine.env(state);
    expect(directlyAttached(env, 'uK3', 'uL3')).toBe(true);
    expect(directlyAttached(env, 'uK3', 'uJ3')).toBe(false);
    expect(directlyAttached(env, 'uK4', 'uK3')).toBe(false);
    expect(directlyAttached(env, 'uM4', 'uL4')).toBe(true);
    expect(directlyAttached(env, 'uK4', 'uK5')).toBe(true);
  });
});

describe('Wind and spreading (B25.63, B25.64, B25.651)', () => {
  const windy = (force: 'breeze' | 'heavy', dir: number) => game(RU_HOUSE, { startPhase: 'AFPh', scenario: { weather: { wind: { from: 'W', force, dir } } }, dice: Array(60).fill(6) });

  it('a Mild Breeze adds +2 downwind, +1 beside it, 0 beside upwind and -1 upwind', () => {
    const { engine, state } = windy('breeze', 0);
    const env = engine.env(state);
    const map = statics(env).map;
    const neighbours = map.neighbors('uK3');
    const t = act(engine, state, { type: 'test.blaze', loc: 'uK3' });
    for (const n of neighbours) {
      const k = sideToward(map, 'uK3', n)!;
      const want = k === 0 ? 2 : k === 1 || k === 5 ? 1 : k === 2 || k === 4 ? 0 : -1;
      const d = spreadDrm(engine.env(t.state), 'uK3', n);
      const wind = d.explain.find((x) => x.includes('Wind'));
      expect(wind ? Number(wind.split(' ')[0]) : 0, `${n} across hexside ${k}`).toBe(want);
    }
  });

  it('Heavy Winds put a Flame in the three downwind hexes outright and never in the upwind three; inside a building the DR is made', () => {
    const { engine, state } = windy('heavy', 0);
    const map = statics(engine.env(state)).map;
    let t = act(engine, state, { type: 'test.blaze', loc: 'uK4' });
    t = act(engine, t.state, { type: 'endPhase' });
    const spread = events(t, 'asl.fire.spread');
    const auto = spread.filter((e) => e['auto'] === 'heavy').map((e) => e['to'] as string);
    const rolled = spread.filter((e) => e['dr']).map((e) => e['to'] as string);
    for (const to of auto) expect([0, 1, 5]).toContain(sideToward(map, 'uK4', to));
    expect(rolled.sort()).toEqual(['uK4:1', 'uK5'].filter((l) => true).sort());
    // No Flame appeared upwind.
    for (const n of map.neighbors('uK4')) if ([2, 3, 4].includes(sideToward(map, 'uK4', n)!)) expect(flamesAt(engine.env(t.state), n)).toHaveLength(0);
  });

  it('Gusts spread every Blaze one hex downwind and one Blaze two hexes, at ground level', () => {
    // Wind Change DR 12 at the German RPh: Gusts. The Blaze in K3 (woods) blows across hexside 0.
    // The German AFPh end: three Spreading Fire DRs from K3 (1+1 each, nothing); the Russian RPh: Wind Change DR 6+6.
    const { engine, state } = game(RU_HOUSE, { startPhase: 'AFPh', scenario: { weather: { wind: { from: 'W', force: 'breeze', dir: 0 } } }, dice: [1, 1, 1, 1, 1, 1, 6, 6, ...Array(80).fill(1)] });
    const map = statics(engine.env(state)).map;
    let s = act(engine, state, { type: 'test.blaze', loc: 'uK3' }).state;
    s = until(engine, s, 'PFPh', { turn: 1, attacker: 'ru' });
    expect(windOf(engine.env(s)).gusts).toBe(true);
    const one = map.neighbors('uK3').find((n) => sideToward(map, 'uK3', n) === 0)!;
    const two = map.neighbors(one).find((n) => sideToward(map, one, n) === 0)!;
    const t = act(engine, until(engine, s, 'AFPh', { turn: 1, attacker: 'ru' }), { type: 'endPhase' });
    const spread = events(t, 'asl.fire.spread').filter((e) => e['auto'] === 'gust');
    const far = spread.find((e) => e['far']);
    // K3's downwind hex is L3 woods (burnable) or open ground: the Flames land only on Burnable Terrain.
    for (const e of spread) expect(burnable(engine.env(t.state), e['to'] as string)).toBe(true);
    if (burnable(engine.env(t.state), one)) expect(spread.some((e) => e['to'] === one && !e['far'])).toBe(true);
    if (burnable(engine.env(t.state), two)) expect(far?.['to']).toBe(two);
    // The Gusts are over with the Player Turn.
    const next = until(engine, t.state, 'PFPh', { turn: 2, attacker: 'ge' });
    expect(windOf(engine.env(next)).gusts).toBeUndefined();
  });

  it('No Wind in an Interior Building hex: its Blaze keeps its smoke in Heavy Winds, and makes no Gust spread (B25.63)', () => {
    const probe = game([]);
    const ring = statics(probe.engine.env(probe.state)).map.neighbors('uK4');
    expect(ring).toHaveLength(6);
    const block = { terrain: 'building-stone', buildingId: 'u-X' } as HexTerrainSpec;
    const terrain: Record<string, HexTerrainSpec> = { uK4: block, ...Object.fromEntries(ring.map((h) => [h, block])) };
    const heavy = { weather: { wind: { from: 'W', force: 'heavy', dir: 0 } } };
    const { engine, state } = game([{ id: 'g1', def: 'ge.467', side: 'ge', hex: 'uY10' }], { terrain, scenario: heavy });
    let s = act(engine, state, { type: 'test.blaze', loc: 'uK4' }).state;
    s = act(engine, s, { type: 'test.blaze', loc: ring[0]! }).state;
    const env = engine.env(s);
    expect(windOf(env).force).toBe('heavy');
    expect(windAt(env, 'uK4').force).toBe('none');
    expect(blazeSmokeLevels(env, 'uK4')).toBe(4);
    expect(blazeSmokeLevels(env, ring[0]!)).toBe(0);
    const los = env.query('los.trace', { from: ring[1]!, to: 'uK4' }, { clear: true, hindrance: 0, parts: [] });
    expect(los.parts.map((p) => p.label)).toContain('+3 Blaze (smoke)');
    // Gusts under No Wind roll a direction; the Blaze in the interior hex spreads nowhere by them.
    const g = game([{ id: 'g1', def: 'ge.467', side: 'ge', hex: 'uY10' }], { terrain, scenario: { weather: { wind: { from: 'W', force: 'breeze', dir: 0 } } } });
    s = act(g.engine, g.state, { type: 'test.blaze', loc: 'uK4' }).state;
    s = { ...s, ext: { ...s.ext, 'asl.wind': { ...windOf(g.engine.env(s)), gusts: true } } };
    const t = act(g.engine, until(g.engine, s, 'AFPh', { turn: 1, attacker: 'ge' }), { type: 'endPhase' });
    expect(events(t, 'asl.fire.spread').filter((e) => e['auto'] === 'gust')).toHaveLength(0);
  });

  it('the Random Direction dr names the hexsides clockwise from the top', () => {
    expect([1, 2, 3, 4, 5, 6].map(hexsideForDr)).toEqual([4, 5, 0, 1, 2, 3]);
  });
});

describe('The Blaze and the units (B25.2, B25.4, A4.3, A4.44)', () => {
  it('a Blaze hex is +3 Smoke to a LOS through it (+1 more out of it), not in Heavy Winds, and no obstacle', () => {
    const { engine, state } = game([...RU_HOUSE, { id: 'g2', def: 'ge.467', side: 'ge', hex: 'uO3' }]);
    let t = act(engine, state, { type: 'test.blaze', loc: 'uM4' });
    let env = engine.env(t.state);
    const map = statics(env).map;
    const through = [...map.hexes()].find((h) => map.distance(h.id, 'uM4') === 1 && map.distance(h.id, 'uO3') === 1 && h.id !== 'uM4')?.id;
    const los = env.query('los.trace', { from: 'uO3', to: 'uM4' }, { clear: true, hindrance: 0, parts: [] });
    expect(los.clear).toBe(true);
    expect(los.parts.map((p) => p.label)).toContain('+3 Blaze (smoke)');
    const out = env.query('los.trace', { from: 'uM4', to: 'uO3' }, { clear: true, hindrance: 0, parts: [] });
    expect(out.parts.map((p) => p.label)).toContain('+4 firing out of a Blaze');
    void through;
    // Heavy Winds: none.
    const g2 = game([...RU_HOUSE, { id: 'g2', def: 'ge.467', side: 'ge', hex: 'uO3' }], { scenario: { weather: { wind: { from: 'W', force: 'heavy', dir: 0 } } } });
    t = act(g2.engine, g2.state, { type: 'test.blaze', loc: 'uM4' });
    env = g2.engine.env(t.state);
    expect(env.query('los.trace', { from: 'uO3', to: 'uM4' }, { clear: true, hindrance: 0, parts: [] }).hindrance).toBe(0);
  });

  it('entering a level within a ground Blaze\'s smoke costs one MF more; not in Heavy Winds, where there is no smoke (A24.7, B25.2)', () => {
    const cost = (wind: Record<string, unknown>) => {
      const { engine, state } = game([{ id: 'g1', def: 'ge.467', side: 'ge', hex: 'uK5', level: 1 }, { id: 'r1', def: 'ru.447', side: 'ru', hex: 'uY10' }], { startPhase: 'MPh', scenario: { weather: { wind } } });
      let s = act(engine, state, { type: 'test.blaze', loc: 'uK4' }).state;
      s = act(engine, s, { type: 'move.start', units: ['g1'] }).state;
      const env = engine.env(s);
      return env.query('move.stepCost', { ms: moveState(env)!, to: 'uK4:1' }, 0);
    };
    expect(cost({ from: 'W', force: 'calm' })).toBe(3);
    expect(cost({ from: 'W', force: 'breeze', dir: 0 })).toBe(3);
    expect(cost({ from: 'W', force: 'heavy', dir: 0 })).toBe(2);
  });

  it('a rout up the stairs into a level within a Blaze\'s smoke pays one MF more too (A24.7, B25.2)', () => {
    const mf = (wind: Record<string, unknown>, blaze: boolean) => {
      const { engine, state } = game([{ id: 'r1', def: 'ru.447', side: 'ru', hex: 'uK5' }, { id: 'g1', def: 'ge.467', side: 'ge', hex: 'uY10' }], { startPhase: 'RtPh', scenario: { weather: { wind } } });
      const s = blaze ? act(engine, state, { type: 'test.blaze', loc: 'uK4' }).state : state;
      return engine.env(s).query('rout.stairsMf', { unit: 'r1', to: 'uK4:1' }, 1);
    };
    expect(mf({ from: 'W', force: 'calm' }, false)).toBe(1);
    expect(mf({ from: 'W', force: 'calm' }, true)).toBe(2);
    expect(mf({ from: 'W', force: 'heavy', dir: 0 }, true)).toBe(1);
  });

  it('in a Mild Breeze a Blaze drifts three Dispersed SMOKE counters directly downwind at the AFPh start; a wind change removes them (A24.61, B25.2)', () => {
    const breeze = { weather: { wind: { from: 'W', force: 'breeze', dir: 0 } } };
    const { engine, state } = game([{ id: 'g1', def: 'ge.467', side: 'ge', hex: 'uY10' }, { id: 'r1', def: 'ru.447', side: 'ru', hex: 'uA1' }], { startPhase: 'DFPh', scenario: breeze, dice: Array(80).fill(1) });
    let s = act(engine, state, { type: 'test.blaze', loc: 'uK4' }).state;
    s = act(engine, s, { type: 'endPhase' }).state;
    expect(s.phase).toBe('AFPh');
    const env = engine.env(s);
    const line: string[] = [];
    let at: string | undefined = 'uK4';
    for (let n = 0; n < 3; n++) line.push((at = downwind(env, at!, 0)!));
    for (const h of line) expect(smoke58Counters(s.hexMarkers[h])).toEqual([{ kind: 'smoke', dispersed: true, side: 'drift~uK4~0' }]);
    // As Dispersed SMOKE: +2 to a LOS into it, one MF more to enter it.
    const mid = line[1]!;
    const near = statics(env).map.neighbors(mid).find((h) => !line.includes(h) && h !== 'uK4')!;
    expect(env.query('los.trace', { from: near, to: mid }, { clear: true, hindrance: 0, parts: [] }).hindrance).toBeGreaterThanOrEqual(2);
    // The next RPh's Wind Change DR of 2 turns the wind: the drift goes (it comes back downwind at the next AFPh).
    s = until(engine, s, 'PFPh', { turn: 1, attacker: 'ru' });
    expect(windOf(engine.env(s)).dir).not.toBe(0);
    for (const h of line) expect(smoke58Counters(s.hexMarkers[h])).toEqual([]);
  });

  it('refuses a move, an advance, a rout and a Bypass into a Blaze, with the rule', () => {
    const { engine, state } = game([{ id: 'g1', def: 'ge.467', side: 'ge', hex: 'uJ4' }, { id: 'r1', def: 'ru.447', side: 'ru', hex: 'uL4', tags: { broken: true, dm: true } }], { startPhase: 'MPh' });
    let s = act(engine, state, { type: 'test.blaze', loc: 'uK4' }).state;
    s = act(engine, s, { type: 'move.start', units: ['g1'] }).state;
    const d = engine.currentDecision(s)!;
    expect(engine.validate(s, { type: 'move.step', to: 'uK4', side: 'ge', decisionId: d.id } as Action)).toMatch(/ablaze.*B25\.4/);
    expect(moveState(engine.env(s))).toBeTruthy();
    const bypass = engine.legalActions(s, 'ge').filter((a) => a.type === 'move.step' && (a['bypass'] as string[] | undefined)?.length && String(a['to']).startsWith('uK4'));
    expect(bypass).toHaveLength(0);
    s = act(engine, s, { type: 'move.end' }).state;
    s = until(engine, s, 'APh', { turn: 1, attacker: 'ge' });
    expect(engine.validate(s, { type: 'advance', units: ['g1'], to: 'uK4', side: 'ge', decisionId: engine.currentDecision(s)!.id } as Action)).toMatch(/ablaze/);
  });

  it('Infantry in a Blaze break voluntarily to rout out at the RtPh, or die at its end; pinned units are not asked', () => {
    const pieces: PieceSpec[] = [
      { id: 's1', def: 'ru.447', side: 'ru', hex: 'uK4' },
      { id: 'p1', def: 'ru.447', side: 'ru', hex: 'uK5', tags: { pinned: true } },
      { id: 'g1', def: 'ge.467', side: 'ge', hex: 'uP4' },
    ];
    const { engine, state } = game(pieces, { startPhase: 'AFPh', dice: Array(60).fill(6) });
    let s = act(engine, state, { type: 'test.blaze', loc: 'uK4' }).state;
    s = act(engine, s, { type: 'test.blaze', loc: 'uK5' }).state;
    s = act(engine, s, { type: 'endPhase' }).state;
    expect(s.phase).toBe('RtPh');
    // The attacker (German) has nobody in a Blaze; the Russian is asked for s1 only (p1 is pinned).
    const d = engine.currentDecision(s)!;
    expect(d.kind).toBe(BLAZE_ESCAPE_DECISION);
    expect(d.owner).toBe('ru');
    expect(d.data?.['units']).toEqual(['s1']);
    const t = act(engine, s, { type: 'blaze.break', unit: 's1' });
    expect(t.state.pieces['s1']!.tags).toMatchObject({ broken: true, dm: true });
    // It may rout out of the house; the burning K5 is no rout hex.
    const steps = engine.legalActions(t.state, 'ru').filter((a) => a.type === 'rout.step');
    expect(steps.length).toBeGreaterThan(0);
    expect(steps.map((a) => a['to'])).not.toContain('uK5');
    s = engine.submit(t.state, steps.find((a) => a['to'] !== 'uK4:1')!).state;
    s = until(engine, s, 'APh', { turn: 1, attacker: 'ge' });
    expect(s.pieces['s1']!.loc.kind).toBe('hex');
    expect(s.pieces['p1']!.loc.kind).toBe('eliminated');
  });

  it('a unit that cannot break voluntarily (a Japanese squad: no broken side) moves out instead, open to Interdiction (B25.4, A10.41, A10.53)', () => {
    const pieces: PieceSpec[] = [
      { id: 's1', def: 'ja.447', side: 'ru', hex: 'uK4' },
      { id: 'g1', def: 'ge.467', side: 'ge', hex: 'uP4' },
    ];
    const { engine, state } = game(pieces, { startPhase: 'AFPh', dice: Array(60).fill(6) });
    let s = act(engine, state, { type: 'test.blaze', loc: 'uK4' }).state;
    s = act(engine, s, { type: 'endPhase' }).state;
    const d = engine.currentDecision(s)!;
    expect(d.kind).toBe(BLAZE_ESCAPE_DECISION);
    const legal = engine.legalActions(s, 'ru');
    expect(legal.some((a) => a.type === 'blaze.break')).toBe(false);
    const outs = legal.filter((a) => a.type === 'blaze.moveOut');
    expect(outs.length).toBeGreaterThan(0);
    const env = engine.env(s);
    const open = outs.find((a) => interdicted(env, 'ru', hexOfLoc(a['to'] as string), 'uK4').length > 0)!;
    expect(open).toBeTruthy();
    const t = act(engine, s, open);
    expect(events(t, 'asl.fire.escape')[0]).toMatchObject({ unit: 's1', choice: 'move', interdicted: ['g1'] });
    // Original 12 > Morale 7: the NMC fails, Casualty Reduction (A10.53), not the broken unit's elimination.
    expect(t.state.pieces['s1']!.loc.kind).toBe('hex');
    expect(t.state.pieces['s1']!.defId).not.toBe('ja.447');
  });

  it('a unit that stays is eliminated at the end of the RtPh, and unpossessed SW in a Blaze are removed', () => {
    const { engine, state } = game([{ id: 's1', def: 'ru.447', side: 'ru', hex: 'uK4' }, { id: 'mg', def: 'ru.MMG', side: 'ru', hex: 'uK4' }, { id: 'g1', def: 'ge.467', side: 'ge', hex: 'uP4' }], { startPhase: 'AFPh', dice: Array(40).fill(6) });
    let s = act(engine, state, { type: 'test.blaze', loc: 'uK4' }).state;
    expect(s.pieces['mg']!.loc.kind).toBe('eliminated');
    s = act(engine, s, { type: 'endPhase' }).state;
    const t = act(engine, s, { type: 'blaze.stay', unit: 's1' });
    s = until(engine, t.state, 'APh', { turn: 1, attacker: 'ge' });
    expect(s.pieces['s1']!.loc.kind).toBe('eliminated');
  });
});

describe('A SW left in a Blaze later (A4.44)', () => {
  it('a SW whose possessor dies in the Blaze is left unpossessed there and removed too', () => {
    const { engine, state } = game([{ id: 's1', def: 'ru.447', side: 'ru', hex: 'uK4' }, { id: 'mg', def: 'ru.MMG', side: 'ru', heldBy: 's1' }, { id: 'g1', def: 'ge.467', side: 'ge', hex: 'uP4' }], { startPhase: 'AFPh', dice: Array(40).fill(6) });
    let s = act(engine, state, { type: 'test.blaze', loc: 'uK4' }).state;
    expect(s.pieces['mg']!.loc).toEqual({ kind: 'held', by: 's1' });
    s = act(engine, s, { type: 'endPhase' }).state;
    s = act(engine, s, { type: 'blaze.stay', unit: 's1' }).state;
    s = until(engine, s, 'APh', { turn: 1, attacker: 'ge' });
    expect(s.pieces['s1']!.loc.kind).toBe('eliminated');
    expect(s.pieces['mg']!.loc.kind).toBe('eliminated');
  });
});

describe('Flame clearance (B25.7, B24.7, B24.72, B24.721, B24.8)', () => {
  const pieces: PieceSpec[] = [
    { id: 'l', def: 'ru.L91', side: 'ru', hex: 'uK4' },
    { id: 's1', def: 'ru.447', side: 'ru', hex: 'uK4' },
    { id: 'h1', def: 'ru.247', side: 'ru', hex: 'uK4' },
    { id: 'g1', def: 'ge.467', side: 'ge', hex: 'uP4' },
  ];

  it('is offered in the Russian MPh to units that have not moved or fired, with the DRM, and a DR of 4 Hampers the Flame', () => {
    // DRM: 9-1 -1, one squad -1, one further HS -1 = -3; DR 4+3 = 7 -3 = 4: Hampered.
    const { engine, state } = game(pieces, { scenario: { firstSide: 'ru' }, startPhase: 'MPh', dice: [4, 3] });
    let s = act(engine, state, { type: 'test.flame', loc: 'uK4' }).state;
    const flame = flamesAt(engine.env(s), 'uK4')[0]!;
    const legal = engine.legalActions(s, 'ru').filter((a) => a.type === 'fire.extinguish');
    expect(legal).toHaveLength(1);
    expect(legal[0]).toMatchObject({ loc: 'uK4', units: ['s1', 'h1'], director: 'l' });
    const t = act(engine, s, { type: 'fire.extinguish', loc: 'uK4', flame: flame.id, units: ['s1', 'h1'], director: 'l' });
    expect(events(t, 'asl.fire.extinguish')[0]).toMatchObject({ drm: -3, outcome: 'hampered', explain: ['-1 leadership', '-2 1 squad and 1 HS/crew'] });
    expect(flamesAt(engine.env(t.state), 'uK4')[0]!.hampered).toBe(true);
    // TI, but no Hazardous Movement left: it ended with the DR (B24.7; Q&A [K33] to B24.7 & E1.21).
    for (const id of ['l', 's1', 'h1']) {
      expect(t.state.pieces[id]!.tags).toMatchObject({ ti: true });
      expect(t.state.pieces[id]!.tags['hazardous']).toBeUndefined();
    }
    expect(engine.env(t.state).explain('fire.unitDrm', { attack: { target: 'uK4', parts: [], mode: 'prep', side: 'ge', hindrance: 0 } as never, unit: 's1' }, 0).trace.map((c) => c.label ?? '').join('|')).not.toMatch(/Hazardous Movement/);
    // TI: no move this turn, no AFPh fire, no advance; the Hamper stops the Blaze DR this turn; next turn they are free again.
    expect(engine.legalActions(t.state, 'ru').some((a) => a.type === 'move.start' && (a['units'] as string[]).includes('s1'))).toBe(false);
    s = until(engine, t.state, 'AFPh', { turn: 1, attacker: 'ru' });
    expect(engine.validate(s, { type: 'test.fire', decl: { units: ['s1'], sw: [], target: 'uP4' }, mode: 'advancing', side: 'ru', decisionId: engine.currentDecision(s)!.id } as Action)).toMatch(/TI/);
    s = until(engine, s, 'APh', { turn: 1, attacker: 'ru' });
    expect(flamesAt(engine.env(s), 'uK4')).toHaveLength(1);
    expect(engine.validate(s, { type: 'advance', units: ['s1'], to: 'uK5', side: 'ru', decisionId: engine.currentDecision(s)!.id } as Action)).toMatch(/TI/);
    s = until(engine, s, 'MPh', { turn: 2, attacker: 'ru' });
    expect(s.pieces['s1']!.tags['ti']).toBeUndefined();
    expect(flamesAt(engine.env(s), 'uK4')[0]!.hampered).toBeUndefined();
    expect(engine.legalActions(s, 'ru').some((a) => a.type === 'move.start' && (a['units'] as string[]).includes('s1'))).toBe(true);
  });

  it('Flame clearance spends no MF: the DEFENDER has no First Fire at it in the MPh, and the clearers keep the phase (B24.72; Q&A [K33] to B24.7 & E1.21)', () => {
    const { engine, state } = game(pieces, { scenario: { firstSide: 'ru' }, startPhase: 'MPh', dice: [4, 3, 3, 3, 6, 6, 6, 6, 6, 6] });
    let s = act(engine, state, { type: 'test.flame', loc: 'uK4' }).state;
    const flame = flamesAt(engine.env(s), 'uK4')[0]!;
    s = act(engine, s, { type: 'fire.extinguish', loc: 'uK4', flame: flame.id, units: ['s1', 'h1'], director: 'l' }).state;
    expect(engine.currentDecision(s)).toMatchObject({ kind: 'phase', owner: 'ru' });
    expect(moveState(engine.env(s))).toBeFalsy();
    expect(s.pieces['s1']!.tags['moved']).toBeUndefined();
  });

  it('a Final DR of 2 extinguishes; a failure earns a Labor counter that helps the next attempt in place and goes when the unit leaves', () => {
    // Clearance 6+6 fails (Labor -1); the Flame's Blaze DRs (3+4, 3+3) do nothing; the Wind Change DR 3+4; then 2+2 -2 = 2.
    const { engine, state } = game(pieces, { scenario: { firstSide: 'ru' }, startPhase: 'MPh', dice: [6, 6, 3, 4, 3, 4, 3, 3, 3, 4, 2, 2, 1, 1] });
    let s = act(engine, state, { type: 'test.flame', loc: 'uK4' }).state;
    const flame = flamesAt(engine.env(s), 'uK4')[0]!;
    let t = act(engine, s, { type: 'fire.extinguish', loc: 'uK4', flame: flame.id, units: ['s1'] });
    expect(events(t, 'asl.fire.extinguish')[0]).toMatchObject({ outcome: 'failed', labor: -1 });
    expect(t.state.pieces['s1']!.tags['labor']).toBe('flame:uK4@-1');
    s = until(engine, t.state, 'MPh', { turn: 2, attacker: 'ru' });
    expect(s.pieces['s1']!.tags['labor']).toBe('flame:uK4@-1');
    // Second attempt with Labor -1 and the squad's -1: 2+2 = 4 -2 = 2: extinguished.
    t = act(engine, s, { type: 'fire.extinguish', loc: 'uK4', flame: flame.id, units: ['s1'] });
    expect(events(t, 'asl.fire.extinguish')[0]).toMatchObject({ drm: -2, outcome: 'extinguished', explain: ['-1 Labor', '-1 one squad'] });
    expect(flamesAt(engine.env(t.state), 'uK4')).toHaveLength(0);
    s = until(engine, t.state, 'MPh', { turn: 3, attacker: 'ru' });
    expect(s.pieces['s1']!.tags['labor']).toBeUndefined();
  });

  it('two Flames in a Location: each is fought with its own DR, and the same units may try each once (B24.72); off at the CCPh end', () => {
    // First Flame 4+3 -3 = 4 Hampered; second Flame 1+1 -3: extinguished.
    const { engine, state } = game(pieces, { scenario: { firstSide: 'ru' }, startPhase: 'MPh', dice: [4, 3, 1, 1] });
    let s = act(engine, state, { type: 'test.flame', loc: 'uK4' }).state;
    s = act(engine, s, { type: 'test.flame', loc: 'uK4' }).state;
    const [f1, f2] = flamesAt(engine.env(s), 'uK4');
    expect(f2).toBeDefined();
    expect(engine.legalActions(s, 'ru').filter((a) => a.type === 'fire.extinguish').map((a) => a['flame'])).toEqual([f1!.id, f2!.id]);
    s = act(engine, s, { type: 'fire.extinguish', loc: 'uK4', flame: f1!.id, units: ['s1', 'h1'], director: 'l' }).state;
    while (engine.currentDecision(s)?.owner === 'ge') s = act(engine, s, { type: 'defPass' }).state;
    // TI from the first does not bar the second; the first may not be tried again.
    expect(engine.legalActions(s, 'ru').filter((a) => a.type === 'fire.extinguish')).toEqual([expect.objectContaining({ flame: f2!.id, units: ['s1', 'h1'], director: 'l' })]);
    const d = engine.currentDecision(s)!;
    expect(engine.validate(s, { type: 'fire.extinguish', loc: 'uK4', flame: f1!.id, units: ['s1'], side: 'ru', decisionId: d.id } as Action)).toMatch(/already fought that Flame/);
    const t = act(engine, s, { type: 'fire.extinguish', loc: 'uK4', flame: f2!.id, units: ['s1', 'h1'], director: 'l' });
    expect(events(t, 'asl.fire.extinguish')[0]).toMatchObject({ outcome: 'extinguished' });
    expect(t.state.pieces['s1']!.tags['flameClear']).toBe(`uK4|${f1!.id},${f2!.id}`);
    s = until(engine, t.state, 'MPh', { turn: 2, attacker: 'ru' });
    expect(s.pieces['s1']!.tags['flameClear']).toBeUndefined();
    expect(s.pieces['s1']!.tags['ti']).toBeUndefined();
  });

  it('a Blaze cannot be fought; the DEFENDER may fight a Flame in the DFPh with units that did not fire', () => {
    const { engine, state } = game(pieces, { startPhase: 'DFPh', dice: [1, 1] });
    let s = act(engine, state, { type: 'test.flame', loc: 'uK4' }).state;
    const legal = engine.legalActions(s, 'ru').filter((a) => a.type === 'fire.extinguish');
    expect(legal).toHaveLength(1);
    s = act(engine, s, { type: 'test.blaze', loc: 'uK4' }).state;
    expect(engine.legalActions(s, 'ru').filter((a) => a.type === 'fire.extinguish')).toHaveLength(0);
  });
});

describe('Control forfeited by Fire (A26.16, A26.161)', () => {
  it('a Kindled Flame hands the hex and building to the opponent until it is out; an accidental Flame changes nothing', () => {
    const { engine, state } = game([...RU_HOUSE, { id: 's2', def: 'ru.447', side: 'ru', hex: 'uK5' }], { scenario: { firstSide: 'ru' }, dice: [3, 3, 4, 3] });
    let env = engine.env(state);
    expect(controlState(env).buildings['u-B16']).toBe('ru');
    let t = act(engine, state, { type: 'fire.kindle', loc: 'uK4', attempts: [{ unit: 's1', director: 'l' }] });
    env = engine.env(t.state);
    expect(controlState(env).hexes['uK4']).toBe('ge');
    expect(controlState(env).buildings['u-B16']).toBe('ge');
    // An accidental Flame elsewhere: no effect on Control.
    const g2 = game([...RU_HOUSE, { id: 's2', def: 'ru.447', side: 'ru', hex: 'uK5' }]);
    t = act(g2.engine, g2.state, { type: 'test.flame', loc: 'uK4' });
    expect(controlState(g2.engine.env(t.state)).buildings['u-B16']).toBe('ru');
  });

  it('an accidental Blaze area goes to the side Controlling most of the hexes round it', () => {
    const ring: PieceSpec[] = [];
    const { engine: probe, state: ps } = game([{ id: 'g1', def: 'ge.467', side: 'ge', hex: 'uP4' }]);
    const map = statics(probe.env(ps)).map;
    map.neighbors('uK3').forEach((n, i) => ring.push({ id: `g${i}`, def: 'ge.467', side: 'ge', hex: n }));
    const { engine, state } = game(ring);
    const t = act(engine, state, { type: 'test.blaze', loc: 'uK3' });
    expect(controlState(engine.env(t.state)).hexes['uK3']).toBe('ge');
  });
});

describe('Across Player Turns', () => {
  it('a Kindled Flame becomes a Blaze, spreads, and the records, markers and TI are where the rules leave them', () => {
    const { engine, state } = game(RU_HOUSE, { scenario: { firstSide: 'ru', ec: 'veryDry' }, dice: [3, 3, 4, 3, ...Array(200).fill(6)] });
    let s = act(engine, state, { type: 'fire.kindle', loc: 'uK4', attempts: [{ unit: 's1', director: 'l' }] }).state;
    s = until(engine, s, 'RPh', { turn: 2, attacker: 'ru' });
    const env = engine.env(s);
    expect(blazeAt(env, 'uK4')).toBeTruthy();
    expect(Object.keys(fireState(env)).length).toBeGreaterThan(1);
    // The Russians fled or died; what lives has no Player Turn tag left.
    for (const p of Object.values(s.pieces)) if (p.loc.kind === 'hex') expect(p.tags['fire']).toBeUndefined();
    expect(s.pieces['l']!.loc.kind === 'hex' ? blazeAt(env, `${(s.pieces['l']!.loc as { hex: string }).hex}`) : undefined).toBeUndefined();
  });
});

describe('B23.94: the Fortified -1 on an attack\'s Flame DR stays secret until it decides (as B23.911)', () => {
  /** Test-only: the Flame DR a HE KIA makes in a Location (B25.13), as the attack would call it. */
  const testFlameDr: RuleModule = {
    id: 'test.flameDr',
    install(r) {
      r.action<Action & { type: 'test.flameDr'; loc: string }>({
        type: 'test.flameDr',
        decisionKinds: ['phase'],
        resolve(ctx, a) {
          ctx.proc<TryFlameFn>(FIRE_PROC.tryFlame)(ctx, a.loc, { source: 'he' });
        },
      });
    },
  };
  /** The Russians secretly fortify K4 (B23.911); the German makes the Flame DR there with `total` on the dice. */
  function flameDr(total: number) {
    const dice = [Math.min(6, total - 1), total - Math.min(6, total - 1)];
    const { engine, state } = game([...RU_HOUSE], {
      dice,
      extra: [fortifiedModule, testFlameDr],
      scenario: {
        forces: [{ side: 'ru', units: [], setup: { kind: 'area', description: 'the house', hexes: ['uK4', 'uK5'] } }],
        ssr: [{ module: FORTIFIED_MODULE, params: { side: 'ru', count: 1, unit: 'location', within: 'setup' } }],
      },
    });
    const s0 = act(engine, state, { type: 'fortify.designate', locations: ['uK4'] }).state;
    const t = act(engine, s0, { type: 'test.flameDr', loc: 'uK4' });
    const ge = engine.redactTransition('ge', (s) => redactState(engine, s, 'ge'), s0, t.events);
    return { engine, t, ge, kindle: fireNumbers(engine.env(s0), 'uK4')!.kindle };
  }
  it('a DR the -1 does not change: no -1 shown, and the German learns nothing', () => {
    const kindle = flameDr(12).kindle;
    for (const total of [kindle + 1, kindle - 3]) {
      const { engine, t, ge } = flameDr(total);
      expect(events(t, 'asl.fire.attackFlame')[0]).toMatchObject({ drm: 0, explain: [], flame: total >= kindle });
      expect(fortifiedRevealed(engine.env(t.state), 'uK4')).toBe(false);
      expect(JSON.stringify(ge)).not.toMatch(/Fortified|B23\.94|sk1\.fortified\.revealed/);
      expect((redactState(engine, t.state, 'ge').ext['sk1.fortified'] as { locations: string[] }).locations).toEqual([]);
    }
  });
  it('a DR the -1 turns from a Flame to none: shown, and the Location revealed', () => {
    const { kindle } = flameDr(12);
    const { engine, t, ge } = flameDr(kindle);
    expect(events(t, 'asl.fire.attackFlame')[0]).toMatchObject({ drm: -1, explain: ['-1 Fortified Building (ASLRB B23.94)'], flame: false });
    expect(fortifiedRevealed(engine.env(t.state), 'uK4')).toBe(true);
    expect((redactState(engine, t.state, 'ge').ext['sk1.fortified'] as { locations: string[] }).locations).toEqual(['uK4']);
    expect(ge.some((e) => e.type === 'asl.fire.attackFlame' && (e.payload as { drm: number }).drm === -1)).toBe(true);
  });
});

describe('B23.94: Kindling, spreading and the Blaze DR in a Fortified Building Location', () => {
  /** K4 is a fortified Location of the Russians' house, not yet shown to the Germans. */
  const fortified = (s: GameState): GameState => ({ ...s, ext: { ...s.ext, 'sk1.fortified': { side: 'ru', buildings: ['u-B16'], revealed: [], locations: ['uK4'], revealedLocs: [] } } });
  it('Kindling in it takes -1 more (B23.94, B25.11)', () => {
    const { engine, state } = game(RU_HOUSE, { extra: [fortifiedModule] });
    const plain = kindlingDrm(engine.env(state), 'uK4', 's1', 'l');
    const fort = kindlingDrm(engine.env(fortified(state)), 'uK4', 's1', 'l');
    expect(fort.drm).toBe(plain.drm - 1);
    expect(fort.explain).toContain('-1 Fortified Building Location (ASLRB B23.94)');
    expect(kindlingDrm(engine.env(fortified(state)), 'uK5', 's1', 'l').explain).not.toContain('-1 Fortified Building Location (ASLRB B23.94)');
  });

  it('a Spreading Fire DR into it takes -1, shown and revealing it only when the -1 decides (B23.94, B25.6)', () => {
    // A Blaze in K5 (same house, attached): the DR into K4 is the first of the step (its Locations in order).
    const run = (dice: number[]) => {
      const { engine, state } = game(RU_HOUSE, { scenario: { firstSide: 'ru' }, startPhase: 'AFPh', extra: [fortifiedModule], dice: [...dice, ...Array(20).fill(1)] });
      const s = act(engine, fortified(state), { type: 'test.blaze', loc: 'uK5' }).state;
      const env = engine.env(s);
      expect(spreadDrm(env, 'uK5', 'uK4')).toMatchObject({ fortified: -1 });
      const needed = fireNumbers(env, 'uK4')!.spread;
      const t = act(engine, s, { type: 'endPhase' });
      return { needed, ev: events(t, 'asl.fire.spread').find((e) => e['to'] === 'uK4')!, revealed: fortifiedRevealed(engine.env(t.state), 'uK4') };
    };
    const probe = run([6, 6]);
    expect(probe.ev).toMatchObject({ drm: 0, flame: true, explain: [] });
    expect(probe.revealed).toBe(false);
    const n = probe.needed;
    const decides = run([Math.min(6, n - 1), n - Math.min(6, n - 1)]);
    expect(decides.ev).toMatchObject({ drm: -1, flame: false });
    expect(decides.ev['explain']).toContain('-1 Fortified Building Location (ASLRB B23.94)');
    expect(decides.revealed).toBe(true);
  });

  it('a Flame in it takes -1 on its Blaze DR, shown and revealing it only when the -1 decides (B23.94, B25.151)', () => {
    const run = (dice: number[]) => {
      const { engine, state } = game(RU_HOUSE, { scenario: { firstSide: 'ru' }, startPhase: 'AFPh', extra: [fortifiedModule], dice: [...dice, ...Array(20).fill(1)] });
      const s = act(engine, fortified(state), { type: 'test.flame', loc: 'uK4' }).state;
      const needed = fireNumbers(engine.env(s), 'uK4')!.spread;
      const t = act(engine, s, { type: 'endPhase' });
      return { needed, ev: events(t, 'asl.fire.blazeCheck')[0]!, revealed: fortifiedRevealed(engine.env(t.state), 'uK4') };
    };
    const probe = run([6, 6]);
    expect(probe.ev).toMatchObject({ drm: 0, outcome: 'blaze' });
    expect(probe.revealed).toBe(false);
    const n = probe.needed;
    const decides = run([Math.min(6, n - 1), n - Math.min(6, n - 1)]);
    expect(decides.ev).toMatchObject({ drm: -1, outcome: 'none' });
    expect(decides.revealed).toBe(true);
  });
});

describe('A Flame from a FT, HE or DC attack (B25.12, B25.13)', () => {
  /** Test-only: an attack's resolution as the IFT would report it (FP.attackResolved). */
  const testResolved: RuleModule = {
    id: 'test.resolved',
    install(r) {
      r.action<Action & { type: 'test.resolved'; info: AttackResolvedInfo }>({
        type: 'test.resolved',
        decisionKinds: ['phase'],
        resolve(ctx, a) {
          ctx.proc<AttackResolvedFn>(FP.attackResolved)(ctx, a.info);
        },
      });
    },
  };
  const far: PieceSpec[] = [{ id: 'gf', def: 'ge.467', side: 'ge', hex: 'uY10' }, { id: 'rf', def: 'ru.447', side: 'ru', hex: 'uA1' }];
  const flameOf = (info: Partial<AttackResolvedInfo> & { target: string; by: AttackResolvedInfo['by'] }) => {
    const { engine, state } = game(far, { scenario: { ec: 'dry' }, extra: [testResolved], dice: [6, 6] });
    const t = act(engine, state, { type: 'test.resolved', info: { result: 'KIA', malfunctioned: false, ...info } });
    return { flame: events(t, 'asl.fire.attackFlame')[0], flames: flamesAt(engine.env(t.state), info.target) };
  };

  it('a FT attack whose Original DR is a K or KIA makes a Flame DR: no EC DRM in a building, the EC DRM in rubble (B25.12; official Q&A to B25.12)', () => {
    // The German FT in K3 (woods, adjacent) at the Russians in K4: 24 FP, Original DR 2: a KIA. Then the Flame DR.
    const { engine, state } = game([...RU_HOUSE, { id: 'gs', def: 'ge.467', side: 'ge', hex: 'uK3' }, { id: 'ft', def: 'ge.FT', side: 'ge', heldBy: 'gs' }], {
      scenario: { ec: 'dry' },
      dice: [1, 1, 6, 6, ...Array(20).fill(6)],
    });
    const t = act(engine, state, { type: 'test.fire', decl: { units: [], sw: ['ft'], target: 'uK4' }, mode: 'prep' });
    const f = events(t, 'asl.fire.attackFlame')[0]!;
    expect(f).toMatchObject({ loc: 'uK4', source: 'ft', drm: 0, flame: true });
    expect(f['explain']).not.toContain('EC +1');
    expect(flamesAt(engine.env(t.state), 'uK4')).toHaveLength(1);
    expect(flameOf({ target: 'uK4', by: 'ft', originalResult: 'K' }).flame).toMatchObject({ source: 'ft' });
    expect(flameOf({ target: 'uK4', by: 'ft', originalResult: '1MC' as never }).flame).toBeUndefined();
    // Wooden rubble: the FT's Flame DR takes the EC DRM; a HE attack's does not (the rubble reading of B25.5 stands for HE).
    const rubble = game(far, { scenario: { ec: 'dry' }, extra: [testResolved], dice: [6, 6], terrain: { ...TERRAIN, uM6: { terrain: 'rubble-wood' } } });
    const ft = act(rubble.engine, rubble.state, { type: 'test.resolved', info: { result: 'KIA', malfunctioned: false, target: 'uM6', by: 'ft', originalResult: 'KIA' } });
    expect(events(ft, 'asl.fire.attackFlame')[0]).toMatchObject({ loc: 'uM6', source: 'ft', drm: 1 });
  });

  it('a HE or DC attack whose Original DR is a KIA makes a Flame DR: in woods with the EC DRM, in a building without (B25.13)', () => {
    const woods = flameOf({ target: 'uK3', by: 'he', originalResult: 'KIA' });
    expect(woods.flame).toMatchObject({ loc: 'uK3', source: 'he', drm: 1, flame: true, explain: ['EC +1'] });
    expect(woods.flames).toHaveLength(1);
    const house = flameOf({ target: 'uK4', by: 'he', originalResult: 'KIA' });
    expect(house.flame).toMatchObject({ loc: 'uK4', source: 'he', drm: 0, explain: [] });
    expect(flameOf({ target: 'uK3', by: 'dc', originalResult: 'KIA' }).flame).toMatchObject({ source: 'dc' });
    // A K is not enough for HE; a Collateral Attack, a HEAT round's VTT or rubble never Flames; nor Open Ground.
    expect(flameOf({ target: 'uK3', by: 'he', originalResult: 'K' }).flame).toBeUndefined();
    expect(flameOf({ target: 'uK3', by: 'he', originalResult: 'KIA', collateral: true }).flame).toBeUndefined();
    expect(flameOf({ target: 'uK4', by: 'he', originalResult: 'KIA', rubbled: true }).flame).toBeUndefined();
    expect(flameOf({ target: 'uR4', by: 'he', originalResult: 'KIA' }).flame).toBeUndefined();
  });

});

describe('Spreading downhill (B25.61)', () => {
  it('-1 into a lower elevation: from woods on a level 1 hill into the woods below it', () => {
    const terrain: Record<string, HexTerrainSpec> = { ...TERRAIN, uK3: { terrain: 'woods', elevation: 1 }, uL3: { terrain: 'woods' } };
    const { engine, state } = game(RU_HOUSE, { terrain, scenario: { firstSide: 'ru' }, startPhase: 'AFPh', dice: Array(40).fill(6) });
    const s = act(engine, state, { type: 'test.blaze', loc: 'uK3' }).state;
    expect(spreadDrm(engine.env(s), 'uK3', 'uL3').explain).toContain('-1 to a lower elevation');
    const t = act(engine, s, { type: 'endPhase' });
    const into = events(t, 'asl.fire.spread').find((e) => e['to'] === 'uL3')!;
    expect(into['explain']).toContain('-1 to a lower elevation');
    expect(into['drm']).toBe(spreadDrm(engine.env(s), 'uK3', 'uL3').drm);
  });
});

describe('Fire chains (A26.162)', () => {
  it('a chain of Fire joined by Fire both sides Kindled counts as accidental: no Control is forfeited for it', () => {
    const pieces = [...RU_HOUSE, { id: 's2', def: 'ru.447', side: 'ru', hex: 'uK5' }];
    const { engine, state } = game(pieces);
    let s = act(engine, state, { type: 'test.flame', loc: 'uK4', by: 'ru' }).state;
    expect(controlState(engine.env(s)).buildings['u-B16']).toBe('ge');
    // A Flame the Germans Kindled in K5, next to it: one chain, Kindled by both.
    s = act(engine, s, { type: 'test.flame', loc: 'uK5', by: 'ge' }).state;
    expect(controlState(engine.env(s)).hexes['uK4']).toBe('ru');
    expect(controlState(engine.env(s)).buildings['u-B16']).toBe('ru');
    // A German Flame far from it is another chain: the Russian one forfeits again.
    const g2 = game(pieces);
    let x = act(g2.engine, g2.state, { type: 'test.flame', loc: 'uK4', by: 'ru' }).state;
    x = act(g2.engine, x, { type: 'test.flame', loc: 'uL5', by: 'ge' }).state;
    expect(controlState(g2.engine.env(x)).buildings['u-B16']).toBe('ge');
  });
});
