import { describe, expect, it } from 'vitest';
import type { GameState, PieceId, RuleModule } from '@asl/engine';
import { aslCoreModules, buildAttack, moveState, piecesModule, turnModule, type HexTerrainSpec } from '../../src';
import { sk1CoreModules } from '../../src/sk1';
import { sk2CoreModules } from '../../src/sk2';
import { sk3CoreModules } from '../../src/sk3';
import { act, makeEngine, type PieceSpec } from '../fixtures';

/*
 * The board-u Chapter B pass, in the full ASL ruleset: board u's hexes as the real board data gives them
 * (the hex-level map; the pixel LOS cases are in content/test/orchardRoad.test.ts and terrainU.test.ts).
 * - The road J1-J10 (paved; J5-J8 are Orchard-Road hexes on the real board, here plain road for the bonus count).
 * - The D-hill: D8 is level 1 open hill, D7 and D6 below it at ground level, D9 level 1.
 * - Brush D2, orchard B7, woods C3, the Woods-Road DD4.
 */
const road = { terrain: 'open', features: ['road:paved'] };
const MAP: Record<string, HexTerrainSpec> = {
  ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`uJ${i + 1}`, road])),
  uD6: { terrain: 'open' },
  uD7: { terrain: 'open' },
  uD8: { terrain: 'open', elevation: 1 },
  uD9: { terrain: 'open', elevation: 1 },
  uD2: { terrain: 'brush' },
  uB7: { terrain: 'orchard' },
  uC3: { terrain: 'woods' },
  uDD4: { terrain: 'woods', features: ['road:dirt', 'woods-road'] },
};
const roadHexsides = Array.from({ length: 9 }, (_, i) => [`uJ${i + 1}`, `uJ${i + 2}`] as [string, string]);
const SK: RuleModule[] = [piecesModule, turnModule, ...sk1CoreModules, ...sk2CoreModules, ...sk3CoreModules];
const ASL: RuleModule[] = [...SK, ...aslCoreModules];
const GE_FIRST = {
  firstSide: 'ge',
  sides: [
    { side: 'ge', name: 'German', nationality: 'ge', elr: 3 },
    { side: 'ru', name: 'Russian', nationality: 'ru', elr: 3 },
  ],
};

const game = (pieces: PieceSpec[], opts: { asl?: boolean; hexMarkers?: Record<string, Record<string, unknown>>; startPhase?: string } = {}) =>
  makeEngine({ board: 'u', terrain: MAP, roadHexsides, scenario: GE_FIRST, modules: opts.asl === false ? SK : ASL, startPhase: opts.startPhase ?? 'MPh', pieces, ...(opts.hexMarkers ? { hexMarkers: opts.hexMarkers } : {}) });

describe('B.2 COT: SMOKE is part of the Cost of Terrain doubled uphill (full ASL)', () => {
  const pieces: PieceSpec[] = [{ id: 'g1', def: 'ge.467', side: 'ge', hex: 'uD7' }];
  const cost = (asl: boolean, smoke: boolean) => {
    const { engine, state } = game(pieces, { asl, ...(smoke ? { hexMarkers: { uD8: { smoke: true } } } : {}) });
    return engine.env(state).query('move.cost', { unit: 'g1' as PieceId, from: 'uD7', to: 'uD8', viaRoad: false }, 1);
  };

  it('Open Ground uphill into SMOKE costs 2 × (1 + 1) = 4 MF; the Starter Kit adds the Smoke after the doubling (3)', () => {
    expect(cost(true, false)).toBe(2);
    expect(cost(true, true)).toBe(4);
    expect(cost(false, true)).toBe(3);
  });

  it('on level ground SMOKE still costs one MF more', () => {
    const { engine, state } = game([{ id: 'g1', def: 'ge.467', side: 'ge', hex: 'uD6' }], { hexMarkers: { uD7: { smoke: true } } });
    expect(engine.env(state).query('move.cost', { unit: 'g1' as PieceId, from: 'uD6', to: 'uD7', viaRoad: false }, 1)).toBe(2);
  });
});

describe('A4.5 Double Time and B3.4 the road bonus (full ASL)', () => {
  it('a leader with a squad Double Timing along the J road enters nine road hexes: eight MF and the road bonus', () => {
    const { engine, state } = game([
      { id: 'g1', def: 'ge.467', side: 'ge', hex: 'uJ1' },
      { id: 'l1', def: 'ge.L80', side: 'ge', hex: 'uJ1' },
    ]);
    let s: GameState = act(engine, state, { type: 'move.start', units: ['g1', 'l1'], doubleTime: true }).state;
    expect(moveState(engine.env(s))!.allowance).toEqual({ g1: 8, l1: 8 });
    for (let i = 2; i <= 10; i++) {
      s = act(engine, s, { type: 'move.step', to: `uJ${i}` }).state;
      while (engine.currentDecision(s)?.kind === 'firstFire') s = act(engine, s, { type: 'defPass' }).state;
    }
    expect(s.pieces['g1']!.loc).toEqual({ kind: 'hex', hex: 'uJ10' });
  });
});

describe('B10.31 Height Advantage on the D-hill (full ASL)', () => {
  // A German squad climbs from D7 into D8 (level 1); Russians below fire from D6 (their LOS crosses the D7-D8 hexside it
  // came through) and from C8 (it does not).
  const pieces: PieceSpec[] = [
    { id: 'g1', def: 'ge.467', side: 'ge', hex: 'uD8' },
    { id: 'r1', def: 'ru.447', side: 'ru', hex: 'uD6' },
    { id: 'r2', def: 'ru.447', side: 'ru', hex: 'uC8' },
  ];
  const ids = (t: { id: string; suppressedBy?: string }[]) => t.filter((x) => !x.suppressedBy).map((x) => x.id);

  it('a unit that crossed the Crest Line through the hexside the LOS crosses gets no Height Advantage and is subject to FFMO', () => {
    const { engine, state } = game(pieces, { startPhase: 'PFPh' });
    const env = engine.env(state);
    const at = (firer: string) => buildAttack(env, { units: [firer], sw: [], target: 'uD8' }, 'first', 'ru', ['g1'], { assault: false, viaRoadIntoWoodsRoad: false, from: 'uD7' });
    const below = at('r1');
    expect(ids(env.explain('fire.unitDrm', { attack: below, unit: 'g1' }, 0).trace)).not.toContain('sk2.drm.height-advantage');
    expect(ids(env.explain('fire.drm', { attack: below }, 0).trace)).toContain('sk1.drm.ffmo');
    const aside = at('r2');
    expect(ids(env.explain('fire.unitDrm', { attack: aside, unit: 'g1' }, 0).trace)).toContain('sk2.drm.height-advantage');
    expect(ids(env.explain('fire.drm', { attack: aside }, 0).trace)).not.toContain('sk1.drm.ffmo');
  });
});

describe('B1, B12, B13, B14 TEM and Open Ground on board u (full ASL)', () => {
  it('Open Ground and bare hill are Open Ground; brush, orchard and woods are not; TEM 0, 0, 0, +1', () => {
    const { engine, state } = game([{ id: 'g1', def: 'ge.467', side: 'ge', hex: 'uJ1' }]);
    const env = engine.env(state);
    const og = (h: string) => env.query('hex.openGround', { hex: h }, false);
    const tem = (h: string) => env.query('hex.tem', { hex: h }, 0);
    expect([og('uD7'), og('uD8'), og('uD2'), og('uB7'), og('uC3')]).toEqual([true, true, false, false, false]);
    expect([tem('uD2'), tem('uB7'), tem('uC3')]).toEqual([0, 0, 1]);
    const mf = (from: string, to: string) => env.query('move.cost', { unit: 'g1' as PieceId, from, to, viaRoad: false }, 1);
    expect([mf('uD3', 'uD2'), mf('uB6', 'uB7'), mf('uC4', 'uC3')]).toEqual([2, 1, 2]);
  });

  it('Woods-Road DD4 entered along the road: road rate, and FFMO with no woods TEM (B13.31)', () => {
    const { engine, state } = game([
      { id: 'g1', def: 'ge.467', side: 'ge', hex: 'uDD3' },
      { id: 'r1', def: 'ru.447', side: 'ru', hex: 'uDD6' },
    ]);
    const env = engine.env(state);
    const a = buildAttack(env, { units: ['r1'], sw: [], target: 'uDD4' }, 'first', 'ru', ['g1'], { assault: false, viaRoadIntoWoodsRoad: true, from: 'uDD3' });
    const drm = env.explain('fire.drm', { attack: a }, 0).trace.filter((t) => !t.suppressedBy).map((t) => t.id);
    expect(drm).toEqual(expect.arrayContaining(['sk1.drm.ffmo', 'sk1.drm.woods-road']));
  });
});
