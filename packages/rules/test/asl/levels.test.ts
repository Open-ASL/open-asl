import { describe, expect, it } from 'vitest';
import type { RuleModule } from '@asl/engine';
import { aslCoreModules, moveState, piecesModule, turnModule, type HexTerrainSpec } from '../../src';
import { sk1CoreModules } from '../../src/sk1';
import { sk2CoreModules } from '../../src/sk2';
import { sk3CoreModules } from '../../src/sk3';
import { RU_VS_GE, act, makeEngine, testMap, type PieceSpec } from '../fixtures';
import { testFire } from './helpers';

/*
 * Multi-level buildings: moving, advancing and routing between the levels of a Two Story House (ASLRB B23.22:
 * level 1 and an inherent stairwell in every hex; B23.4 one MF to change level; B23.25 ADJACENT building Locations).
 * The house is board u's K4–K5 stone building, as the real board data gives it in full ASL.
 */

const LEVELS = { upper: 1 as const, stairwell: 'inherent' as const };
const HOUSE: Record<string, HexTerrainSpec> = {
  uK4: { terrain: 'building-stone', buildingId: 'u-B16', building: LEVELS, obstacleHeight: 1.5 },
  uK5: { terrain: 'building-stone', buildingId: 'u-B16', building: LEVELS, obstacleHeight: 1.5 },
  uL3: { terrain: 'building-stone', buildingId: 'u-B18', building: LEVELS, obstacleHeight: 1.5 },
  uM3: { terrain: 'building-stone', buildingId: 'u-B18', building: LEVELS, obstacleHeight: 1.5 },
};
const SK: RuleModule[] = [piecesModule, turnModule, ...sk1CoreModules, ...sk2CoreModules, ...sk3CoreModules];
const ASL: RuleModule[] = [...SK, ...aslCoreModules];

export const game = (pieces: PieceSpec[], opts: { asl?: boolean; dice?: number[]; startPhase?: string } = {}) =>
  makeEngine({
    board: 'u',
    terrain: HOUSE,
    scenario: RU_VS_GE,
    modules: opts.asl === false ? SK : ASL,
    extra: [testFire],
    pieces,
    ...(opts.dice ? { dice: opts.dice } : {}),
    ...(opts.startPhase ? { startPhase: opts.startPhase } : {}),
  });

const steps = (engine: ReturnType<typeof game>['engine'], state: ReturnType<typeof game>['state']) =>
  engine
    .legalActions(state, 'ru')
    .filter((a) => a.type === 'move.step')
    .map((a) => a['to'] as string)
    .sort();

describe('Changing level in the MPh (ASLRB B23.4, B23.421, A8.12)', () => {
  const far: PieceSpec = { id: 'ge', def: 'ge.467', side: 'ge', hex: 'uY1' };

  it('up the inherent stairwell costs one MF and puts the stack at level 1', () => {
    const { engine, state } = game([{ id: 'r', def: 'ru.447', side: 'ru', hex: 'uK4' }, far], { startPhase: 'MPh' });
    let s = act(engine, state, { type: 'move.start', units: ['r'] }).state;
    expect(steps(engine, s)).toContain('uK4:1');
    s = act(engine, s, { type: 'move.step', to: 'uK4:1' }).state;
    expect(s.pieces['r']!.loc).toEqual({ kind: 'hex', hex: 'uK4', level: 1 });
    const ms = moveState(engine.env(s))!;
    expect(ms.spent['r']).toBe(1);
    expect(ms.level).toBe(1);
    expect(ms.mfHere).toBe(1);
  });

  it('from level 1 the stack may only take the stairs or move along its floor of the building (B23.25)', () => {
    const { engine, state } = game([{ id: 'r', def: 'ru.447', side: 'ru', hex: 'uK4', level: 1 }, far], { startPhase: 'MPh' });
    const s = act(engine, state, { type: 'move.start', units: ['r'] }).state;
    expect(steps(engine, s)).toEqual(['uK4', 'uK5:1']);
    expect(() => act(engine, s, { type: 'move.step', to: 'uL4' })).toThrow(/upper level/);
    expect(() => act(engine, s, { type: 'move.step', to: 'uK5' })).toThrow(/upper level/);
  });

  it('level 1 to level 1 of the next hex of the building costs the building\'s two MF (B23.421)', () => {
    const { engine, state } = game([{ id: 'r', def: 'ru.447', side: 'ru', hex: 'uK4', level: 1 }, far], { startPhase: 'MPh' });
    let s = act(engine, state, { type: 'move.start', units: ['r'] }).state;
    s = act(engine, s, { type: 'move.step', to: 'uK5:1' }).state;
    expect(s.pieces['r']!.loc).toEqual({ kind: 'hex', hex: 'uK5', level: 1 });
    expect(moveState(engine.env(s))!.spent['r']).toBe(2);
  });

  it('an enemy on the ground below does not bar level 1 (A4.14 is per Location); one at level 1 does', () => {
    const { engine, state } = game(
      [
        { id: 'r', def: 'ru.447', side: 'ru', hex: 'uK4', level: 1 },
        { id: 'g', def: 'ge.467', side: 'ge', hex: 'uK5' },
      ],
      { startPhase: 'MPh' },
    );
    const s = act(engine, state, { type: 'move.start', units: ['r'] }).state;
    expect(steps(engine, s)).toContain('uK5:1');
    const { engine: e2, state: s2 } = game(
      [
        { id: 'r', def: 'ru.447', side: 'ru', hex: 'uK4' },
        { id: 'g', def: 'ge.467', side: 'ge', hex: 'uK4', level: 1 },
      ],
      { startPhase: 'MPh' },
    );
    const t = act(e2, s2, { type: 'move.start', units: ['r'] }).state;
    expect(() => act(e2, t, { type: 'move.step', to: 'uK4:1' })).toThrow(/enemy-occupied Location/);
  });

  it('a single-hex building and open ground have no level to climb to', () => {
    const { engine, state } = game([{ id: 'r', def: 'ru.447', side: 'ru', hex: 'uL4' }, far], { startPhase: 'MPh' });
    const s = act(engine, state, { type: 'move.start', units: ['r'] }).state;
    expect(steps(engine, s).every((t) => !t.includes(':'))).toBe(true);
  });

  it('Starter Kit: the same house has one Location per hex, and the steps are the neighbouring hexes as before', () => {
    const { engine, state } = game([{ id: 'r', def: 'ru.447', side: 'ru', hex: 'uK4' }, far], { asl: false, startPhase: 'MPh' });
    const s = act(engine, state, { type: 'move.start', units: ['r'] }).state;
    expect(steps(engine, s)).toEqual(testMap(HOUSE, 'u').neighbors('uK4').sort());
  });
});

describe('Advancing up or down the stairs (ASLRB A4.7, B23.422)', () => {
  it('a unit may advance one level up in its own hex, but not up into another hex', () => {
    const { engine, state } = game(
      [
        { id: 'r', def: 'ru.447', side: 'ru', hex: 'uK4' },
        { id: 'g', def: 'ge.467', side: 'ge', hex: 'uK4', level: 1 },
      ],
      { startPhase: 'APh' },
    );
    const tos = engine
      .legalActions(state, 'ru')
      .filter((a) => a.type === 'advance')
      .map((a) => a['to']);
    expect(tos).toContain('uK4:1');
    expect(tos).not.toContain('uK5:1');
    const s = act(engine, state, { type: 'advance', units: ['r'], to: 'uK4:1' }).state;
    expect(s.pieces['r']!.loc).toEqual({ kind: 'hex', hex: 'uK4', level: 1 });
  });
});

const GE_FIRST = { ...RU_VS_GE, firstSide: 'ge' };
const ev = (events: { type: string; payload: unknown }[], type: string) => events.filter((e) => e.type === type).map((e) => e.payload as Record<string, unknown>);

describe('Fire between levels (ASLRB A7.21, A7.5, B23.25)', () => {
  it('the ground and level 1 of one hex fire at each other with PBF (ADJACENT, A7.21)', () => {
    const { engine, state } = game([
      { id: 'r', def: 'ru.447', side: 'ru', hex: 'uK4' },
      { id: 'g', def: 'ge.467', side: 'ge', hex: 'uK4', level: 1 },
    ]);
    const env = engine.env(state);
    const notes = env.explain('fire.partFp', { attack: { mode: 'prep', side: 'ru', target: 'uK4:1', parts: [{ piece: 'r', firer: 'r', kind: 'inherent', hex: 'uK4', range: 4, dist: 0 }] }, part: { piece: 'r', firer: 'r', kind: 'inherent', hex: 'uK4', range: 4, dist: 0 } } as never, 4);
    expect(notes.value).toBe(8);
  });

  it('a Fire Group needs ADJACENT Locations: level 1 of K4 and the ground of J4 next door are not (A7.5, B23.25)', () => {
    const pieces: PieceSpec[] = [
      { id: 'up', def: 'ru.447', side: 'ru', hex: 'uK4', level: 1 },
      { id: 'out', def: 'ru.447', side: 'ru', hex: 'uJ4' },
      { id: 'g', def: 'ge.467', side: 'ge', hex: 'uK2' },
    ];
    const decl = { units: ['up', 'out'], sw: [], target: 'uK2' };
    const asl = game(pieces);
    expect(asl.engine.env(asl.state).query('fire.illegal', { decl, mode: 'prep', side: 'ru' }, null)).toMatch(/contiguous/);
    const sk = game(pieces.map((p) => ({ ...p, level: undefined })), { asl: false });
    expect(sk.engine.env(sk.state).query('fire.illegal', { decl, mode: 'prep', side: 'ru' }, null)).toBeNull();
  });

  it('no LOS between non-ADJACENT Locations of one building next to each other (B23.25)', () => {
    const { engine, state } = game([]);
    const env = engine.env(state);
    const los = (from: string, to: string) => env.query('los.trace', { from, to }, { clear: true, hindrance: 0, parts: [] });
    expect(los('uK4', 'uK5:1').clear).toBe(false);
    expect(los('uK4', 'uK5:1').blockedBy).toMatch(/B23.25/);
    expect(los('uK4:1', 'uK5:1').clear).toBe(true);
    expect(los('uK4', 'uK4:1').clear).toBe(true);
    expect(los('uK4', 'uK5').clear).toBe(true);
  });
});

describe('Indirect Fire against every level (ASLRB B23.32, C.1)', () => {
  it('a mortar hit on a Two Story House hex attacks both levels with one DR, +1 at the ground for the level above', () => {
    const { engine, state } = makeEngine({
      board: 'u',
      terrain: HOUSE,
      scenario: GE_FIRST,
      modules: ASL,
      dice: [3, 3, 4, 3],
      pieces: [
        { id: 'u', def: 'ge.467', side: 'ge', hex: 'uO4' },
        { id: 'm', def: 'ge.MTR', side: 'ge', heldBy: 'u' },
        { id: 'down', def: 'ru.447', side: 'ru', hex: 'uK4' },
        { id: 'up', def: 'ru.447', side: 'ru', hex: 'uK4', level: 1 },
      ],
    });
    const t = act(engine, state, { type: 'fire.ordnance', shot: { weapon: 'm', target: 'uK4:1', targetType: 'ATT' } });
    const attacks = ev(t.events, 'sk1.fire.attack');
    expect(attacks.map((a) => (a['attack'] as { target: string }).target)).toEqual(['uK4:1', 'uK4']);
    expect(attacks[0]!['dr']).toEqual(attacks[1]!['dr']);
    expect((attacks[1]!['drm'] as number) - (attacks[0]!['drm'] as number)).toBe(1);
    expect(JSON.stringify(attacks[1]!['explain'])).toMatch(/Indirect Fire/);
  });

  it('Starter Kit: the same hit attacks the target Location only', () => {
    const { engine, state } = makeEngine({
      board: 'u',
      terrain: HOUSE,
      scenario: GE_FIRST,
      modules: SK,
      dice: [3, 3, 4, 3],
      pieces: [
        { id: 'u', def: 'ge.467', side: 'ge', hex: 'uO4' },
        { id: 'm', def: 'ge.MTR', side: 'ge', heldBy: 'u' },
        { id: 'down', def: 'ru.447', side: 'ru', hex: 'uK4' },
      ],
    });
    const t = act(engine, state, { type: 'fire.ordnance', shot: { weapon: 'm', target: 'uK4', targetType: 'ATT' } });
    expect(ev(t.events, 'sk1.fire.attack').length).toBe(1);
  });
});

describe('Rout on the stairs: INTERIM rule until rout by Location (ASLRB B23.4, A10.51 EX; destination per SK1 3.6 by hex)', () => {
  const routTo = (engine: ReturnType<typeof game>['engine'], state: ReturnType<typeof game>['state']) =>
    engine
      .legalActions(state, 'ru')
      .filter((a) => a.type === 'rout.step' && !a['lowCrawl'])
      .map((a) => a['to'] as string);

  it('a unit routing from level 1 comes down the stairs (1 MF) or keeps to its floor; it never steps out of the window', () => {
    const { engine, state } = game(
      [
        { id: 'r', def: 'ru.447', side: 'ru', hex: 'uK4', level: 1, tags: { broken: true, dm: true } },
        { id: 'g', def: 'ge.467', side: 'ge', hex: 'uJ4' },
      ],
      { startPhase: 'RtPh' },
    );
    const tos = routTo(engine, state);
    expect(tos).toContain('uK4');
    expect(tos.filter((t) => !t.startsWith('uK'))).toEqual([]);
    const s = act(engine, state, { type: 'rout.step', unit: 'r', to: 'uK4' }).state;
    expect(s.pieces['r']!.loc).toEqual({ kind: 'hex', hex: 'uK4' });
  });

  it('having reached its destination hex, a routing unit may go upstairs there as its last step', () => {
    const { engine, state } = game(
      [
        { id: 'r', def: 'ru.447', side: 'ru', hex: 'uL4', tags: { broken: true, dm: true } },
        { id: 'g', def: 'ge.467', side: 'ge', hex: 'uM5' },
      ],
      { startPhase: 'RtPh' },
    );
    expect(routTo(engine, state)).not.toContain('uK4:1');
    let s = act(engine, state, { type: 'rout.step', unit: 'r', to: 'uK4' }).state;
    expect(routTo(engine, s)).toContain('uK4:1');
    s = act(engine, s, { type: 'rout.step', unit: 'r', to: 'uK4:1' }).state;
    expect(s.pieces['r']!.loc).toEqual({ kind: 'hex', hex: 'uK4', level: 1 });
    expect(engine.legalActions(s, 'ru').some((a) => a.type === 'rout.step')).toBe(false);
  });
});
