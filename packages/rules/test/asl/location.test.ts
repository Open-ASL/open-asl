import { describe, expect, it } from 'vitest';
import type { Action, RuleModule } from '@asl/engine';
import {
  adjacentLocs,
  adjacentToKnownEnemy,
  aslCoreModules,
  buildAttack,
  ccHexes,
  hasLos,
  controlState,
  inMelee,
  isGoodOrder,
  hexOfLoc,
  isGroundLoc,
  levelOfLoc,
  locExists,
  locId,
  locKey,
  locOf,
  locationAt,
  locationsOf,
  moveState,
  parseLoc,
  personnelAt,
  personnelInHex,
  stackedOn,
  piecesModule,
  turnModule,
  unpossessedWeaponsAt,
  type HexTerrainSpec,
} from '../../src';
import { sk1CoreModules } from '../../src/sk1';
import { sk2CoreModules } from '../../src/sk2';
import { sk3CoreModules } from '../../src/sk3';
import { RU_VS_GE, act, makeEngine, testMap, type PieceSpec } from '../fixtures';
import { testFire } from './helpers';

/*
 * The Location model (packages/rules/docs/location-model.md). These tests do not depend on the boards' level
 * data: they use a synthetic two-hex Two Story House on board u (uK4–uK5, B23.22:
 * level 1 and an inherent stairwell in every hex) and put pieces at level 1 directly.
 */

const HOUSE: Record<string, HexTerrainSpec> = {
  uK4: { terrain: 'building-stone', buildingId: 'b1', building: { upper: 1, stairwell: 'inherent' } },
  uK5: { terrain: 'building-stone', buildingId: 'b1', building: { upper: 1, stairwell: 'inherent' } },
};
const SK: RuleModule[] = [piecesModule, turnModule, ...sk1CoreModules, ...sk2CoreModules, ...sk3CoreModules];
const ASL: RuleModule[] = [...SK, ...aslCoreModules];

/** Test-only action: eliminate a unit outright (its SW drop where it was). */
const testKill: RuleModule = {
  id: 'test.kill',
  install(r) {
    r.action<Action & { unit: string }>({
      type: 'test.kill',
      decisionKinds: ['phase'],
      resolve: (ctx, a) => ctx.emit('piece.eliminated', { id: a.unit, reason: 'test' }),
    });
  },
};

const game = (pieces: PieceSpec[], opts: { asl?: boolean; dice?: number[]; startPhase?: string; hexMarkers?: Record<string, Record<string, unknown>> } = {}) =>
  makeEngine({
    board: 'u',
    terrain: HOUSE,
    scenario: RU_VS_GE,
    modules: opts.asl === false ? SK : ASL,
    extra: [testKill, testFire],
    ...(opts.hexMarkers ? { hexMarkers: opts.hexMarkers } : {}),
    pieces,
    ...(opts.dice ? { dice: opts.dice } : {}),
    ...(opts.startPhase ? { startPhase: opts.startPhase } : {}),
  });

describe('Location ids (ASLRB A2.8)', () => {
  it('ground level is the plain hex id; levels and sub-Locations add a suffix', () => {
    expect(locId('uK4')).toBe('uK4');
    expect(locId('uK4', 0)).toBe('uK4');
    expect(locId('uK4', 1)).toBe('uK4:1');
    expect(locId('uK4', 0, 'pb')).toBe('uK4:pb');
    expect(parseLoc('uK4:2')).toEqual({ hex: 'uK4', level: 2 });
    expect(parseLoc('uK4:roof')).toEqual({ hex: 'uK4', level: 0, sub: 'roof' });
    expect(parseLoc('uK4')).toEqual({ hex: 'uK4', level: 0 });
    expect(hexOfLoc('uK4:1')).toBe('uK4');
    expect(levelOfLoc('uK4:1')).toBe(1);
    expect(isGroundLoc('uK4')).toBe(true);
    expect(isGroundLoc('uK4:1')).toBe(false);
  });

  it('a ground-level piece Location is { kind, hex } and never carries level 0', () => {
    expect(locationAt('uK4')).toEqual({ kind: 'hex', hex: 'uK4' });
    expect(Object.keys(locationAt('uK4'))).toEqual(['kind', 'hex']);
    expect(locationAt('uK4:1')).toEqual({ kind: 'hex', hex: 'uK4', level: 1 });
    expect(locationAt('uK4:pb')).toEqual({ kind: 'hex', hex: 'uK4', sub: 'pb' });
    expect(locKey({ kind: 'hex', hex: 'uK4', level: 1 })).toBe('uK4:1');
    expect(locKey({ kind: 'hex', hex: 'uK4' })).toBe('uK4');
  });

  it('locOf follows a held SW to its holder, like hexOf', () => {
    const { state } = game([
      { id: 'r1', def: 'ru.447', side: 'ru', hex: 'uK4', level: 1 },
      { id: 'mg', def: 'ru.LMG', side: 'ru', heldBy: 'r1' },
      { id: 'r2', def: 'ru.447', side: 'ru', hex: 'uK5' },
    ]);
    expect(locOf(state, state.pieces['r1']!)).toBe('uK4:1');
    expect(locOf(state, state.pieces['mg']!)).toBe('uK4:1');
    expect(locOf(state, state.pieces['r2']!)).toBe('uK5');
  });

  it('a Location id where a hex id belongs is an error, not an open hex', () => {
    const map = testMap(HOUSE, 'u');
    expect(map.hex('uK4')?.terrain).toBe('building-stone');
    expect(() => map.hex('uK4:1')).toThrow(/Location id/);
  });
});

describe("'hex.locations' and 'loc.adjacent': one Location per hex in SK, levels in full ASL", () => {
  it('SK: a building hex with level data still has only its ground Location', () => {
    const { engine, state } = game([], { asl: false });
    const env = engine.env(state);
    expect(locationsOf(env, 'uK4')).toEqual(['uK4']);
    expect(locExists(env, 'uK4:1')).toBe(false);
    expect(adjacentLocs(env, 'uK4')).toEqual(testMap(HOUSE, 'u').neighbors('uK4'));
  });

  it('ASL: a Two Story House hex has level 1 (B23.22); an open hex has only ground level', () => {
    const { engine, state } = game([]);
    const env = engine.env(state);
    expect(locationsOf(env, 'uK4')).toEqual(['uK4', 'uK4:1']);
    expect(locationsOf(env, 'uL4')).toEqual(['uL4']);
    expect(locExists(env, 'uK4:1')).toBe(true);
    expect(locExists(env, 'uL4:1')).toBe(false);
  });

  it('ASL: level 1 is ADJACENT to the ground below (inherent stairwell) and to level 1 of the same building next door (A.8, B23.25)', () => {
    const { engine, state } = game([]);
    const env = engine.env(state);
    expect(adjacentLocs(env, 'uK4:1').sort()).toEqual(['uK4', 'uK5:1']);
    expect(adjacentLocs(env, 'uK4')).toContain('uK4:1');
    expect(adjacentLocs(env, 'uK4')).toContain('uL4');
    expect(adjacentLocs(env, 'uK4')).not.toContain('uK5:1');
  });
});

describe('Occupants are per Location (ASLRB A2.8)', () => {
  const pieces: PieceSpec[] = [
    { id: 'up', def: 'ru.447', side: 'ru', hex: 'uK4', level: 1 },
    { id: 'mg', def: 'ru.LMG', side: 'ru', heldBy: 'up' },
    { id: 'down', def: 'ru.447', side: 'ru', hex: 'uK4' },
  ];

  it('personnelAt takes one Location; personnelInHex takes the whole hex', () => {
    const { engine, state } = game(pieces);
    const env = engine.env(state);
    expect(personnelAt(env, 'uK4').map((p) => p.id)).toEqual(['down']);
    expect(personnelAt(env, 'uK4:1').map((p) => p.id)).toEqual(['up']);
    expect(personnelInHex(env, 'uK4').map((p) => p.id).sort()).toEqual(['down', 'up']);
  });

  it('a SW dropped by a unit eliminated at level 1 stays at level 1', () => {
    const { engine, state } = game(pieces, { startPhase: 'RPh' });
    const s = act(engine, state, { type: 'test.kill', unit: 'up' }).state;
    expect(s.pieces['up']!.tags['lastHex']).toBe('uK4:1');
    expect(s.pieces['mg']!.loc).toEqual({ kind: 'hex', hex: 'uK4', level: 1 });
    const env = engine.env(s);
    expect(unpossessedWeaponsAt(env, 'uK4:1').map((p) => p.id)).toEqual(['mg']);
    expect(unpossessedWeaponsAt(env, 'uK4')).toEqual([]);
  });

  it('a SW dropped at ground level is { kind, hex } as before (no level field)', () => {
    const { engine, state } = game([{ id: 'down', def: 'ru.447', side: 'ru', hex: 'uK4' }, { id: 'mg', def: 'ru.LMG', side: 'ru', heldBy: 'down' }], { startPhase: 'RPh' });
    const s = act(engine, state, { type: 'test.kill', unit: 'down' }).state;
    expect(Object.keys(s.pieces['mg']!.loc)).toEqual(['kind', 'hex']);
  });
});

describe('Stacking and stack order are per Location (ASLRB A5.1, A2.8)', () => {
  const upstairs: PieceSpec[] = [
    { id: 'u1', def: 'ru.447', side: 'ru', hex: 'uK4', level: 1 },
    { id: 'u2', def: 'ru.447', side: 'ru', hex: 'uK4', level: 1 },
    { id: 'u3', def: 'ru.447', side: 'ru', hex: 'uK4', level: 1 },
    { id: 'uL', def: 'ru.L91', side: 'ru', hex: 'uK4', level: 1 },
  ];

  it('three squads at level 1 do not stop three more entering the ground level below', () => {
    const { engine, state } = game(
      [
        ...upstairs,
        { id: 'g1', def: 'ru.447', side: 'ru', hex: 'uK4' },
        { id: 'g2', def: 'ru.447', side: 'ru', hex: 'uK4' },
        { id: 'm', def: 'ru.447', side: 'ru', hex: 'uL4' },
        { id: 'ge', def: 'ge.467', side: 'ge', hex: 'uY1' },
      ],
      { startPhase: 'MPh' },
    );
    let s = act(engine, state, { type: 'move.start', units: ['m'] }).state;
    s = act(engine, s, { type: 'move.step', to: 'uK4' }).state;
    expect(s.pieces['m']!.loc).toEqual({ kind: 'hex', hex: 'uK4' });
  });

  it('a fourth squad cannot enter a ground Location already holding three', () => {
    const { engine, state } = game(
      [
        { id: 'g1', def: 'ru.447', side: 'ru', hex: 'uK4' },
        { id: 'g2', def: 'ru.447', side: 'ru', hex: 'uK4' },
        { id: 'g3', def: 'ru.447', side: 'ru', hex: 'uK4' },
        { id: 'm', def: 'ru.447', side: 'ru', hex: 'uL4' },
        { id: 'ge', def: 'ge.467', side: 'ge', hex: 'uY1' },
      ],
      { startPhase: 'MPh' },
    );
    const s = act(engine, state, { type: 'move.start', units: ['m'] }).state;
    expect(() => act(engine, s, { type: 'move.step', to: 'uK4' })).toThrow(/Stacking limit/);
  });

  it('a leader stands on a MMC of his own Location, never on one at another level', () => {
    const { engine, state } = game([...upstairs, { id: 'g1', def: 'ru.447', side: 'ru', hex: 'uK4' }, { id: 'gL', def: 'ru.L81', side: 'ru', hex: 'uK4' }]);
    const env = engine.env(state);
    expect(stackedOn(env, state.pieces['uL']!)).toBe('u1');
    expect(stackedOn(env, state.pieces['gL']!)).toBe('g1');
  });
});

describe('Fire at a Location (ASLRB A2.8, A7.212)', () => {
  const ev = (r: { events: { type: string; payload: unknown }[] }, type: string) => r.events.filter((e) => e.type === type).map((e) => e.payload as Record<string, unknown>);

  it('an attack on level 1 hits only the units at level 1, not those on the ground below', () => {
    const pieces: PieceSpec[] = [
      { id: 'r1', def: 'ru.447', side: 'ru', hex: 'uL4' },
      { id: 'up', def: 'ge.467', side: 'ge', hex: 'uK4', level: 1 },
      { id: 'down', def: 'ge.467', side: 'ge', hex: 'uK4' },
    ];
    const { engine, state } = game(pieces, { dice: [1, 1] });
    expect(buildAttack(engine.env(state), { units: ['r1'], sw: [], target: 'uK4:1' }, 'prep', 'ru').targets).toEqual(['up']);
    expect(buildAttack(engine.env(state), { units: ['r1'], sw: [], target: 'uK4' }, 'prep', 'ru').targets).toEqual(['down']);
    const r = act(engine, state, { type: 'test.fire', decl: { units: ['r1'], sw: [], target: 'uK4:1' }, mode: 'prep' });
    expect(ev(r, 'sk1.fire.result').map((x) => x['unit'])).toEqual(['up']);
    expect(r.state.pieces['down']!.tags).toEqual({});
  });

  it('a Location that does not exist is no target', () => {
    const { engine, state } = game([{ id: 'r1', def: 'ru.447', side: 'ru', hex: 'uK5' }, { id: 'g', def: 'ge.467', side: 'ge', hex: 'uL4' }]);
    expect(engine.env(state).query('fire.illegal', { decl: { units: ['r1'], sw: [], target: 'uL4:1' }, mode: 'prep', side: 'ru' }, null)).toMatch(/Unknown target/);
  });

  it('units at level 1 may fire at the ground Location below them (ADJACENT), not into their own Location', () => {
    const { engine, state } = game([
      { id: 'r1', def: 'ru.447', side: 'ru', hex: 'uK4', level: 1 },
      { id: 'g', def: 'ge.467', side: 'ge', hex: 'uK4' },
    ]);
    const env = engine.env(state);
    expect(env.query('fire.illegal', { decl: { units: ['r1'], sw: [], target: 'uK4' }, mode: 'prep', side: 'ru' }, null)).toBeNull();
    expect(env.query('fire.illegal', { decl: { units: ['r1'], sw: [], target: 'uK4:1' }, mode: 'prep', side: 'ru' }, null)).toMatch(/own hex/);
  });

  it('A7.212: a Known enemy in its own Location confines a unit to firing at that Location; one at another level does not', () => {
    const { engine, state } = game([
      { id: 'down', def: 'ru.447', side: 'ru', hex: 'uK4' },
      { id: 'up', def: 'ru.447', side: 'ru', hex: 'uK4', level: 1 },
      { id: 'tank', def: 'ge.pzivf2', side: 'ge', hex: 'uK4' },
      { id: 'g', def: 'ge.467', side: 'ge', hex: 'uK6' },
    ]);
    const env = engine.env(state);
    const illegal = (unit: string, target: string) => env.query('fire.illegal', { decl: { units: [unit], sw: [], target }, mode: 'prep', side: 'ru' }, null);
    expect(illegal('down', 'uK6')).toMatch(/enemy unit is in its hex/);
    expect(illegal('up', 'uK6')).toBeNull();
  });

  it('Residual FP lies in a Location: a stack entering the ground level does not take the Residual FP left at level 1', () => {
    const run = (key: string) => {
      const { engine, state } = game(
        [
          { id: 'm', def: 'ru.447', side: 'ru', hex: 'uL4' },
          { id: 'g', def: 'ge.467', side: 'ge', hex: 'uY1' },
        ],
        { startPhase: 'MPh', hexMarkers: { [key]: { residualFp: 4 } }, dice: [6, 6, 6, 6, 6, 6] },
      );
      const s = act(engine, state, { type: 'move.start', units: ['m'] }).state;
      return act(engine, s, { type: 'move.step', to: 'uK4' });
    };
    const residual = (r: ReturnType<typeof run>) => ev(r, 'sk1.fire.attack').filter((a) => (a['explain'] as { id: string }[]).some((x) => x.id === 'sk1.residual'));
    expect(residual(run('uK4'))).toHaveLength(1);
    expect(residual(run('uK4:1'))).toHaveLength(0);
  });
});

describe('A moving stack is in a Location (ASLRB A8.12)', () => {
  // The stack at level 1 spends 1 MF recovering a SW there: that Location is the Defensive First Fire target.
  const pieces: PieceSpec[] = [
    { id: 'm', def: 'ru.447', side: 'ru', hex: 'uK4', level: 1 },
    { id: 'lmg', def: 'ru.LMG', side: 'ru', hex: 'uK4', level: 1 },
    { id: 'g', def: 'ge.467', side: 'ge', hex: 'uL4' },
  ];

  it('MF spent at level 1 make the stack a First Fire target there, and only there', () => {
    const { engine, state } = game(pieces, { startPhase: 'MPh', dice: [1] });
    let s = act(engine, state, { type: 'move.start', units: ['m'] }).state;
    expect(moveState(engine.env(s))).toMatchObject({ hex: 'uK4', level: 1 });
    s = act(engine, s, { type: 'move.recover', unit: 'm', sw: 'lmg' }).state;
    const d = engine.currentDecision(s)!;
    expect(d.kind).toBe('firstFire');
    expect(d.data?.['hex']).toBe('uK4:1');
    const legal = engine.legalActions(s, 'ge').filter((a) => a.type === 'defFire');
    expect(legal.map((a) => (a['decl'] as { target: string }).target)).toEqual(['uK4:1']);
    expect(() => engine.submit(s, { type: 'defFire', side: 'ge', decisionId: d.id, decl: { units: ['g'], sw: [], target: 'uK4' } })).toThrow(/moving stack/);
  });
});

describe('Melee and Close Combat are per Location (ASLRB A2.8, A11.1)', () => {
  it('enemies on different levels of a hex are not in Close Combat', () => {
    const { engine, state } = game([
      { id: 'r', def: 'ru.447', side: 'ru', hex: 'uK4', level: 1 },
      { id: 'g', def: 'ge.467', side: 'ge', hex: 'uK4' },
    ]);
    expect(ccHexes(engine.env(state))).toEqual([]);
  });

  it('enemies in the same upper-level Location are', () => {
    const { engine, state } = game([
      { id: 'r', def: 'ru.447', side: 'ru', hex: 'uK4', level: 1 },
      { id: 'g', def: 'ge.467', side: 'ge', hex: 'uK4', level: 1 },
    ]);
    expect(ccHexes(engine.env(state))).toEqual(['uK4:1']);
  });

  it('a Melee at ground level holds the units there, not those upstairs', () => {
    const { engine, state } = game(
      [
        { id: 'down', def: 'ru.447', side: 'ru', hex: 'uK4' },
        { id: 'up', def: 'ru.447', side: 'ru', hex: 'uK4', level: 1 },
        { id: 'g', def: 'ge.467', side: 'ge', hex: 'uK4' },
        { id: 'g2', def: 'ge.467', side: 'ge', hex: 'uL4' },
      ],
      { hexMarkers: { uK4: { melee: true } } },
    );
    const env = engine.env(state);
    expect(isGoodOrder(env, state.pieces['down']!)).toBe(false);
    expect(isGoodOrder(env, state.pieces['up']!)).toBe(true);
    expect(inMelee(env, 'uK4:1')).toBe(false);
    expect(env.query('fire.illegal', { decl: { units: ['down'], sw: [], target: 'uL4' }, mode: 'prep', side: 'ru' }, null)).toMatch(/Melee/);
    expect(env.query('fire.illegal', { decl: { units: ['up'], sw: [], target: 'uL4' }, mode: 'prep', side: 'ru' }, null)).toBeNull();
  });
});

describe('Advance into an ADJACENT Location (ASLRB A4.7, A.8)', () => {
  const pieces: PieceSpec[] = [
    { id: 'up', def: 'ru.447', side: 'ru', hex: 'uK4', level: 1 },
    { id: 'down', def: 'ru.447', side: 'ru', hex: 'uK4' },
    { id: 'g', def: 'ge.467', side: 'ge', hex: 'uY1' },
  ];

  it('from level 1: along the level of the same building or down the stairwell, never to the ground of the next hex', () => {
    const { engine, state } = game(pieces, { startPhase: 'APh' });
    const tos = engine
      .legalActions(state, 'ru')
      .filter((a) => a.type === 'advance' && (a['units'] as string[]).join() === 'up')
      .map((a) => a['to'] as string)
      .sort();
    expect(tos).toEqual(['uK4', 'uK5:1']);
    const s = act(engine, state, { type: 'advance', units: ['up'], to: 'uK5:1' }).state;
    expect(s.pieces['up']!.loc).toEqual({ kind: 'hex', hex: 'uK5', level: 1 });
  });

  it('from the ground: up the inherent stairwell of a Two Story House, and into the neighbouring hexes', () => {
    const { engine, state } = game(pieces, { startPhase: 'APh' });
    const tos = engine
      .legalActions(state, 'ru')
      .filter((a) => a.type === 'advance' && (a['units'] as string[]).join() === 'down')
      .map((a) => a['to'] as string);
    expect(tos).toContain('uK4:1');
    expect(tos).toContain('uL4');
    expect(tos).not.toContain('uK5:1');
  });
});

describe('Control: Location, hex and building tiers (ASLRB A26.11-26.14)', () => {
  it('a MMC at level 1 takes the building and its Location, but not the hex (A26.13: ground level only)', () => {
    const { engine, state } = game([
      { id: 'up', def: 'ru.447', side: 'ru', hex: 'uK4', level: 1 },
      { id: 'g', def: 'ge.467', side: 'ge', hex: 'uY1' },
    ]);
    // The harness places pieces before Control is first worked out; any event re-evaluates it.
    const s = act(engine, state, { type: 'test.kill', unit: 'g' }).state;
    const ctl = controlState(engine.env(s));
    expect(ctl.buildings['b1']).toBe('ru');
    expect(ctl.hexes['uK4']).toBeUndefined();
    expect(ctl.locations).toEqual({ 'uK4:1': 'ru' });
  });

  it('a MMC at ground level takes the hex and the building; no Location entry is written for the ground', () => {
    const { engine, state } = game([
      { id: 'down', def: 'ru.447', side: 'ru', hex: 'uK4' },
      { id: 'g', def: 'ge.467', side: 'ge', hex: 'uY1' },
    ]);
    const s = act(engine, state, { type: 'test.kill', unit: 'g' }).state;
    const ctl = controlState(engine.env(s));
    expect(ctl.hexes['uK4']).toBe('ru');
    expect(ctl.buildings['b1']).toBe('ru');
    expect('locations' in ctl).toBe(false);
  });

  it('a building held from level 1 stays held when an enemy MMC enters its ground level next door, which takes that hex only', () => {
    const { engine, state } = game([
      { id: 'gUp', def: 'ge.467', side: 'ge', hex: 'uK5', level: 1 },
      { id: 'down', def: 'ru.447', side: 'ru', hex: 'uK4' },
      { id: 'g', def: 'ge.467', side: 'ge', hex: 'uY1' },
    ]);
    const s = act(engine, state, { type: 'test.kill', unit: 'g' }).state;
    const ctl = controlState(engine.env(s));
    expect(ctl.buildings['b1']).toBe('ge');
    expect(ctl.hexes['uK4']).toBe('ru');
    expect(ctl.locations).toEqual({ 'uK5:1': 'ge' });
  });
});

describe('Known enemies, LOS and TEM of a Location', () => {
  const adjacentFrom = (enemy: PieceSpec) => {
    const { engine, state } = game([{ id: 'r', def: 'ru.447', side: 'ru', hex: 'uK4', level: 1 }, enemy]);
    return adjacentToKnownEnemy(engine.env(state), 'ru', 'uK4:1');
  };

  it('a Known enemy is ADJACENT to level 1 below it or along the level, not on the ground of the next hex (A.8)', () => {
    expect(adjacentFrom({ id: 'g', def: 'ge.467', side: 'ge', hex: 'uK4' })).toBe(true);
    expect(adjacentFrom({ id: 'g', def: 'ge.467', side: 'ge', hex: 'uK5', level: 1 })).toBe(true);
    expect(adjacentFrom({ id: 'g', def: 'ge.467', side: 'ge', hex: 'uL4' })).toBe(false);
  });

  it('an upper level takes its building\'s TEM, and LOS to it is traced at its height', () => {
    const { engine, state } = game([]);
    const env = engine.env(state);
    expect(env.query('hex.tem', { hex: 'uK4:1' }, 0)).toBe(env.query('hex.tem', { hex: 'uK4' }, 0));
    expect(hasLos(env, 'uL4', 'uK4:1')).toBe(hasLos(env, 'uL4', 'uK4'));
    expect(hasLos(env, 'uK4:1', 'uK4:1')).toBe(true);
  });
});

describe('Map schema for levels and heights', () => {
  it('losAt traces between heights; at ground level on flat ground it agrees with los()', () => {
    const map = testMap(HOUSE, 'u');
    expect(map.losAt({ hex: 'uK2', height: 0 }, { hex: 'uK7', height: 0 }).clear).toBe(map.los('uK2', 'uK7').clear);
    expect(map.losAt({ hex: 'uK2', height: 0 }, { hex: 'uK4', height: 1 }).clear).toBe(true);
    // An end may be a hex corner (Bypass, ASLRB A4.34): traced, not refused.
    expect(map.losAt({ hex: 'uK2', height: 0, vertex: 1 }, { hex: 'uK4', height: 1 }).clear).toBe(true);
  });

  it('building levels and obstacle heights pass from the terrain spec to the map hex, and only where given', () => {
    const map = testMap({ ...HOUSE, uL4: { terrain: 'woods', obstacleHeight: 1 } }, 'u');
    expect(map.hex('uK4')?.building).toEqual({ upper: 1, stairwell: 'inherent' });
    expect(map.hex('uL4')?.obstacleHeight).toBe(1);
    expect('building' in map.hex('uL4')!).toBe(false);
    expect('obstacleHeight' in map.hex('uK4')!).toBe(false);
    expect(map.hexside('uK4', 'uK5')).toBeUndefined();
  });
});
