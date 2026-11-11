import { describe, expect, it } from 'vitest';
import type { GameState, RuleModule } from '@asl/engine';
import { aslCoreModules, controlState, cornerBetween, moveState, piecesModule, sideToward, statics, turnModule, type HexTerrainSpec } from '../../src';
import { sk1CoreModules } from '../../src/sk1';
import { sk2CoreModules } from '../../src/sk2';
import { sk3CoreModules } from '../../src/sk3';
import { RU_VS_GE, act, makeEngine, type PieceSpec } from '../fixtures';

/*
 * Bypass (ASLRB A4.3–A4.34). Board u's
 * grid, with the wooden single-hex building R3 of the real board: the German stack comes from Q4 and goes round it.
 * Corner names follow ASLRB A2.2: R3-S3-S4 is where R3, S3 and S4 meet.
 */

const SK: RuleModule[] = [piecesModule, turnModule, ...sk1CoreModules, ...sk2CoreModules, ...sk3CoreModules];
const ASL: RuleModule[] = [...SK, ...aslCoreModules];
const BUILDING: Record<string, HexTerrainSpec> = { uR3: { terrain: 'building-wood' } };

function game(pieces: PieceSpec[], opts: { terrain?: Record<string, HexTerrainSpec>; dice?: number[]; asl?: boolean } = {}) {
  return makeEngine({
    board: 'u',
    terrain: opts.terrain ?? BUILDING,
    scenario: { ...RU_VS_GE, firstSide: 'ge' },
    modules: opts.asl === false ? SK : ASL,
    startPhase: 'MPh',
    pieces,
    ...(opts.dice ? { dice: opts.dice } : {}),
  });
}
const far: PieceSpec = { id: 'far', def: 'ru.447', side: 'ru', hex: 'uY10' };
const squad = (id = 'g', hex = 'uQ4'): PieceSpec => ({ id, def: 'ge.467', side: 'ge', hex });
type Eng = ReturnType<typeof game>['engine'];
const start = (engine: Eng, state: GameState, units = ['g'], extra: Record<string, unknown> = {}) => act(engine, state, { type: 'move.start', units, ...extra }).state;
const check = (engine: Eng, state: GameState, a: Record<string, unknown>) => engine.validate(state, { side: 'ge', decisionId: engine.currentDecision(state)!.id, ...a } as never);
const ms = (engine: Eng, s: GameState) => moveState(engine.env(s))!;
/** Passes any Defensive First Fire offered, so the mover has the decision again. */
const pass = (engine: Eng, s: GameState) => {
  let x = s;
  while (engine.currentDecision(x)?.owner === 'ru') x = act(engine, x, { type: 'defPass' }).state;
  return x;
};
const step = (engine: Eng, s: GameState, a: Record<string, unknown>) => pass(engine, act(engine, s, { type: 'move.step', ...a }).state);

describe('Bypass movement (ASLRB A4.3, A4.31)', () => {
  it('is not in the Starter Kit', () => {
    const { engine, state } = game([squad(), far], { asl: false });
    const s = start(engine, state);
    expect(engine.legalActions(s, 'ge').some((a) => a['bypass'])).toBe(false);
    expect(check(engine, s, { type: 'move.step', to: 'uR3', bypass: ['uR4'] })).toMatch(/Starter Kit/);
  });

  it('round a building from the next hex costs one MF for one or two hexsides, and puts the stack at the corner', () => {
    const { engine, state } = game([squad(), far]);
    const s = start(engine, state);
    const offered = engine.legalActions(s, 'ge').filter((a) => a.type === 'move.step' && a['bypass']);
    expect(offered.map((a) => (a['bypass'] as string[]).join('-'))).toEqual(expect.arrayContaining(['uR4', 'uR4-uS4', 'uQ3', 'uQ3-uR2']));
    const b = step(engine, s, { to: 'uR3', bypass: ['uR4', 'uS4'] });
    const m = ms(engine, b);
    const map = statics(engine.env(b)).map;
    expect(m.hex).toBe('uR3');
    expect(m.spent['g']).toBe(1);
    expect(m.bypass).toMatchObject({ hex: 'uR3', base: 1 });
    expect(m.bypass!.at).toBe(cornerBetween(map, 'uR3', 'uS3', 'uS4'));
    expect(b.pieces['g']!.loc).toEqual({ kind: 'hex', hex: 'uR3' });
  });

  it('a third hexside doubles the hex Bypass cost once: one MF more, then nothing for a fourth (A4.31 example)', () => {
    const { engine, state } = game([squad(), far]);
    let s = step(engine, start(engine, state), { to: 'uR3', bypass: ['uR4', 'uS4'] });
    s = step(engine, s, { to: 'uR3', bypass: ['uS3'] });
    expect(ms(engine, s).spent['g']).toBe(2);
    s = step(engine, s, { to: 'uR3', bypass: ['uR2'] });
    expect(ms(engine, s).spent['g']).toBe(2);
    expect(ms(engine, s).bypass!.sides).toHaveLength(4);
  });

  it('only the hexsides travelled along must be clear, and not the one crossed into the hex', () => {
    const { engine, state } = game([squad(), far], { terrain: { uR3: { terrain: 'building-wood', bypassBlocked: [] } } });
    const s = start(engine, state);
    const map = statics(engine.env(s)).map;
    const entry = sideToward(map, 'uR3', 'uQ4')!;
    // The obstacle touching the entry hexside does not matter...
    const { engine: e2, state: st2 } = game([squad(), far], { terrain: { uR3: { terrain: 'building-wood', bypassBlocked: [entry] } } });
    expect(check(e2, start(e2, st2), { type: 'move.step', to: 'uR3', bypass: ['uR4'] })).toBeNull();
    // ...going along it is not Bypass, and a touched hexside cannot be gone along.
    expect(check(engine, s, { type: 'move.step', to: 'uR3', bypass: ['uQ4'] })).toMatch(/not along the hexside crossed/);
    const side = sideToward(map, 'uR3', 'uR4')!;
    const { engine: e3, state: st3 } = game([squad(), far], { terrain: { uR3: { terrain: 'building-wood', bypassBlocked: [side] } } });
    expect(check(e3, start(e3, st3), { type: 'move.step', to: 'uR3', bypass: ['uR4'] })).toMatch(/touches its hexside/);
  });

  it('from the corner: the two hexes there or the obstacle; entering it costs its whole COT in the same Location', () => {
    const { engine, state } = game([squad(), far]);
    const s = step(engine, start(engine, state), { to: 'uR3', bypass: ['uR4', 'uS4'] });
    const steps = engine.legalActions(s, 'ge').filter((a) => a.type === 'move.step' && !a['bypass']).map((a) => a['to']).sort();
    expect(steps).toEqual(['uR3', 'uS3', 'uS4']);
    expect(check(engine, s, { type: 'move.step', to: 'uQ4' })).toMatch(/may enter/);
    const inside = step(engine, s, { to: 'uR3' });
    const m = ms(engine, inside);
    expect(m.bypass).toBeUndefined();
    expect(m.spent['g']).toBe(3);
    expect(m.mfHere).toBe(3);
    expect(m.hexesEntered).toBe(1);
  });

  it('may not end its move in Bypass (A4.32): no End move, no units left behind', () => {
    const { engine, state } = game([{ id: 'g', def: 'ge.467', side: 'ge', hex: 'uQ4' }, { id: 'g2', def: 'ge.447', side: 'ge', hex: 'uQ4' }, far]);
    const s = step(engine, start(engine, state, ['g', 'g2']), { to: 'uR3', bypass: ['uR4'] });
    const types = engine.legalActions(s, 'ge').map((a) => a.type);
    expect(types).not.toContain('move.end');
    expect(types).not.toContain('move.stopUnits');
    expect(check(engine, s, { type: 'move.end' })).toMatch(/A4.32/);
  });

  it("refuses a Bypass that could never end outside Bypass: a unit with 2 MF, by a full look-ahead", () => {
    // Every hex round R3 is woods (two MF): with two MF a squad that bypasses R3 for one has one left, which can neither
    // enter R3 (two) nor a woods hex at a corner (two); going further round, or bypassing the woods, only spends it.
    const terrain: Record<string, HexTerrainSpec> = { uR3: { terrain: 'building-wood' } };
    for (const h of ['uQ3', 'uR2', 'uS3', 'uS4', 'uR4']) terrain[h] = { terrain: 'woods' };
    const { engine, state } = game([squad('g', 'uQ6'), far], { terrain });
    let s = start(engine, state);
    s = step(engine, s, { to: 'uQ5' });
    s = step(engine, s, { to: 'uQ4' });
    expect(ms(engine, s).spent['g']).toBe(2);
    expect(check(engine, s, { type: 'move.step', to: 'uR3', bypass: ['uR4'] })).toMatch(/could not end its move outside Bypass/);
    expect(engine.legalActions(s, 'ge').some((a) => a['bypass'] && a['to'] === 'uR3')).toBe(false);
    // With three MF left it may: one for the Bypass, two for the woods at the corner.
    const { engine: e2, state: st2 } = game([squad('g', 'uQ5'), far], { terrain });
    const s2 = step(e2, start(e2, st2), { to: 'uQ4' });
    expect(check(e2, s2, { type: 'move.step', to: 'uR3', bypass: ['uR4'] })).toBeNull();
  });

  it('Assault Movement: Bypass and then the obstacle of the same hex is one Location; out to another hex is a second', () => {
    const { engine, state } = game([squad(), far]);
    const s = step(engine, start(engine, state, ['g'], { assault: true }), { to: 'uR3', bypass: ['uR4'] });
    expect(check(engine, s, { type: 'move.step', to: 'uR3' })).toBeNull();
    expect(check(engine, s, { type: 'move.step', to: 'uR4' })).toMatch(/Assault Movement/);
  });

  it('ignores stacking limits in Bypass (full ASL, Q14), and no SW Recovery there (A4.44)', () => {
    const inside = ['a', 'b', 'c'].map((id): PieceSpec => ({ id, def: 'ge.447', side: 'ge', hex: 'uR3' }));
    const { engine, state } = game([squad(), ...inside, far]);
    const s = start(engine, state);
    expect(check(engine, s, { type: 'move.step', to: 'uR3' })).toMatch(/Stacking/);
    const b = step(engine, s, { to: 'uR3', bypass: ['uR4'] });
    expect(ms(engine, b).bypass).toBeDefined();
    expect(check(engine, b, { type: 'move.recover', unit: 'g', sw: 'x' })).toMatch(/A4.44/);
  });

  it('gains no Control in Bypass (A26.11), and does once in the obstacle', () => {
    const { engine, state } = game([squad(), far]);
    const b = step(engine, start(engine, state), { to: 'uR3', bypass: ['uR4'] });
    expect(controlState(engine.env(b)).hexes['uR3']).not.toBe('ge');
    const inside = step(engine, b, { to: 'uR3' });
    expect(controlState(engine.env(inside)).hexes['uR3']).toBe('ge');
  });

  it('cannot bypass an obstacle holding a Known enemy unit (A4.3)', () => {
    const { engine, state } = game([squad(), { id: 'r', def: 'ru.447', side: 'ru', hex: 'uR3' }]);
    expect(check(engine, start(engine, state), { type: 'move.step', to: 'uR3', bypass: ['uR4'] })).toMatch(/Known enemy/);
  });
});

describe('Defensive First Fire at a stack in Bypass (ASLRB A4.34, B23.31, A8.2)', () => {
  const labels = (events: { type: string; payload: unknown }[]) =>
    ((events.find((e) => e.type === 'sk1.fire.attack')?.payload as { explain: { label?: string }[] } | undefined)?.explain ?? []).map((n) => n.label ?? '');
  const bypassed = (pieces: PieceSpec[], dice: number[]) => {
    const { engine, state } = game([squad(), ...pieces], { dice });
    const s = act(engine, start(engine, state), { type: 'move.step', to: 'uR3', bypass: ['uR4', 'uS4'] }).state;
    return { engine, s, map: statics(engine.env(s)).map };
  };

  it('fired at a corner: no building TEM, FFNAM and FFMO; the point is recorded with the shot', () => {
    const { engine, s, map } = bypassed([{ id: 'r', def: 'ru.447', side: 'ru', hex: 'uR5' }], [5, 4]);
    expect(engine.currentDecision(s)!.owner).toBe('ru');
    const at = { uR5: ['uR4', 'uS4'] };
    expect(cornerBetween(map, 'uR3', 'uR4', 'uS4')).not.toBeNull();
    const r = act(engine, s, { type: 'defFire', decl: { units: ['r'], sw: [], target: 'uR3', at } });
    const ev = r.events.find((e) => e.type === 'sk1.fire.attack')!.payload as { attack: { at?: unknown } };
    expect(ev.attack.at).toEqual(at);
    const l = labels(r.events);
    expect(l).toContain('-1 FFNAM');
    expect(l).toContain('-1 FFMO: in Bypass, in the open');
    expect(l.some((x) => /TEM \(/.test(x))).toBe(false);
  });

  it('only corners of hexsides the targets went along may be chosen', () => {
    const { engine, s } = bypassed([{ id: 'r', def: 'ru.447', side: 'ru', hex: 'uR5' }], [5, 4]);
    const bad = engine.validate(s, { side: 'ru', decisionId: engine.currentDecision(s)!.id, type: 'defFire', decl: { units: ['r'], sw: [], target: 'uR3', at: { uR5: ['uQ3', 'uR2'] } } } as never);
    expect(bad).toMatch(/A4.34/);
  });

  it('at the hex centre the LOS must cross a bypassed hexside; one that does not has still fired (A4.34, A6.11)', () => {
    // From P2 the line to R3's centre comes in through its R3-Q3 side, not one the stack went along.
    const { engine, s } = bypassed([{ id: 'r', def: 'ru.447', side: 'ru', hex: 'uP2' }], [5, 4]);
    const r = act(engine, s, { type: 'defFire', decl: { units: ['r'], sw: [], target: 'uR3' } });
    expect(r.events.some((e) => e.type === 'sk1.fire.noLos')).toBe(true);
    expect(r.events.some((e) => e.type === 'sk1.fire.attack')).toBe(false);
    // From R5 the line comes in through R3-R4: the centre is open.
    const { engine: e2, s: s2 } = bypassed([{ id: 'r', def: 'ru.447', side: 'ru', hex: 'uR5' }], [5, 4]);
    const r2 = act(e2, s2, { type: 'defFire', decl: { units: ['r'], sw: [], target: 'uR3' } });
    expect(r2.events.some((e) => e.type === 'sk1.fire.attack')).toBe(true);
  });

  it('each firing hex of a Fire Group chooses its own point; one whose point is out of LOS drops out', () => {
    // P4 picks the far corner R3-S3-S4: its line crosses the building in R3. P5 picks R3-R4-Q4, in the open.
    const { engine, s } = bypassed(
      [
        { id: 'r1', def: 'ru.447', side: 'ru', hex: 'uP4' },
        { id: 'r2', def: 'ru.447', side: 'ru', hex: 'uP5' },
      ],
      [5, 4],
    );
    const at = { uP4: ['uS3', 'uS4'], uP5: ['uQ4', 'uR4'] };
    const r = act(engine, s, { type: 'defFire', decl: { units: ['r1', 'r2'], sw: [], target: 'uR3', at } });
    const noLos = r.events.find((e) => e.type === 'sk1.fire.noLos')!.payload as { from: string[]; attack: { parts: string[] } };
    expect(noLos.from).toEqual(['uP4']);
    expect(noLos.attack.parts).toEqual(['r1']);
    const attack = r.events.find((e) => e.type === 'sk1.fire.attack')!.payload as { attack: { parts: string[]; at: unknown } };
    expect(attack.attack.parts).toEqual(['r2']);
    expect(attack.attack.at).toEqual(at);
  });

  it('Residual FP left by fire at the Bypass attacks it again with the building TEM (A8.2, note 12)', () => {
    // 2 FP at range 2 leaves 1 Residual FP; the stack goes on round R3 (a third hexside, one MF) and meets it.
    const { engine, s } = bypassed([{ id: 'r', def: 'ru.447', side: 'ru', hex: 'uR5' }], [6, 6, 6, 6, 6, 6]);
    let x = act(engine, s, { type: 'defFire', decl: { units: ['r'], sw: [], target: 'uR3', at: { uR5: ['uR4', 'uS4'] } } }).state;
    x = pass(engine, x);
    expect(x.hexMarkers['uR3']?.['residualFp']).toBeGreaterThan(0);
    const r = act(engine, x, { type: 'move.step', to: 'uR3', bypass: ['uS3'] });
    expect(labels(r.events).some((l) => /\+2 TEM/.test(l))).toBe(true);
  });
});

describe('The second target point of A4.132: where the hexside crossed meets the road', () => {
  // Board y: a German squad comes up the road M3-M4; M4 is a Woods-Road hex; a Russian squad in M7 fires at it there.
  const terrain: Record<string, HexTerrainSpec> = { yM4: { terrain: 'woods', features: ['road:dirt', 'woods-road'] } };
  const roads: [string, string][] = [
    ['yM3', 'yM4'],
    ['yM4', 'yM5'],
  ];
  const labelsOf = (events: { type: string; payload: unknown }[]) =>
    ((events.find((e) => e.type === 'sk1.fire.attack')?.payload as { explain: { label?: string }[] } | undefined)?.explain ?? []).map((n) => n.label ?? '');
  const shoot = (asl: boolean) => {
    const { engine, state } = makeEngine({
      board: 'y',
      terrain,
      roadHexsides: roads,
      scenario: { ...RU_VS_GE, firstSide: 'ge' },
      modules: asl ? ASL : SK,
      startPhase: 'MPh',
      dice: [4, 3],
      pieces: [squad('g', 'yM3'), { id: 'r', def: 'ru.447', side: 'ru', hex: 'yM7' }],
    });
    // The thread to the centre crosses the woods symbol in M4; the one to the road point at M4-M3 does not (the pixel
    // LOS reports `woods`; the test grid does not, so it is given here).
    const map = statics(engine.env(state)).map as unknown as Record<string, (...a: unknown[]) => { woods?: string[] }>;
    for (const name of ['los', 'losAt']) {
      const orig = map[name]!.bind(map);
      map[name] = (a: unknown, b: unknown) => {
        const r = orig(a, b);
        const point = typeof a === 'object' && ((a as { side?: number }).side !== undefined || (b as { side?: number }).side !== undefined);
        return point ? r : { ...r, woods: ['yM4'] };
      };
    }
    let s = start(engine, state);
    s = act(engine, s, { type: 'move.step', to: 'yM4' }).state;
    return labelsOf(act(engine, s, { type: 'defFire', decl: { units: ['r'], sw: [], target: 'yM4' } }).events);
  };

  it('full ASL: the road point is clear of the woods, so the unit on the road is subject to FFMO; the Starter Kit: centre only', () => {
    expect(shoot(true)).toContain('-1 FFMO');
    expect(shoot(false)).not.toContain('-1 FFMO');
  });
});

describe('Broken or pinned in Bypass; hidden Guns; Guns (Q7, Q10, Q15)', () => {
  it('units pinned in Bypass stay there for the rest of the MPh: fired on again without TEM, no FFMO while pinned (A4.33)', () => {
    // 4 FP from R5 at the two squads in Bypass, DRM -2: an 8 is a PTC; both fail their NTC (12s) and are pinned.
    const { engine, state } = game([squad('g'), { id: 'g2', def: 'ge.447', side: 'ge', hex: 'uQ4' }, { id: 'r', def: 'ru.447', side: 'ru', hex: 'uR5' }, { id: 'r2', def: 'ru.447', side: 'ru', hex: 'uR4' }], {
      dice: [4, 4, 6, 6, 6, 6, 5, 5],
    });
    let s = act(engine, start(engine, state, ['g', 'g2']), { type: 'move.step', to: 'uR3', bypass: ['uR4', 'uS4'] }).state;
    s = act(engine, s, { type: 'defFire', decl: { units: ['r'], sw: [], target: 'uR3', at: { uR5: ['uR4', 'uS4'] } } }).state;
    const m = ms(engine, s);
    expect(Object.keys(m.stoppedBypass ?? {}).sort()).toEqual(['g', 'g2']);
    expect(engine.currentDecision(s)!.owner).toBe('ru');
    const r = act(engine, s, { type: 'defFire', decl: { units: ['r2'], sw: [], target: 'uR3', at: { uR4: ['uR4', 'uS4'] } } });
    const l = ((r.events.find((e) => e.type === 'sk1.fire.attack')!.payload as { explain: { label?: string }[] }).explain ?? []).map((n) => n.label ?? '');
    expect(l.some((x) => /TEM \(/.test(x))).toBe(false);
    expect(l).not.toContain('-1 FFMO: in Bypass, in the open');
  });

  it('a hidden Gun in the obstacle stays hidden while a stack bypasses it (A12.151; Q10), but is found on entering', () => {
    const { engine, state } = makeEngine({
      board: 'u',
      terrain: BUILDING,
      scenario: { firstSide: 'ge', sides: [{ side: 'ge', name: 'German', nationality: 'ge', elr: 3 }, { side: 'br', name: 'British', nationality: 'br', elr: 3 }] },
      modules: ASL,
      startPhase: 'MPh',
      pieces: [squad(), { id: 'c1', def: 'br.228c', side: 'br', hex: 'uR3', tags: { hip: true } }, { id: 'g40', def: 'br.AA40L', side: 'br', heldBy: 'c1', tags: { ca: 0, hip: true, emplaced: true } }],
    });
    const b = step(engine, start(engine, state), { to: 'uR3', bypass: ['uR4'] });
    expect(b.pieces['g40']!.tags['hip']).toBe(true);
    expect(ms(engine, b).bypass).toBeDefined();
    const inside = act(engine, b, { type: 'move.step', to: 'uR3' }).state;
    expect(inside.pieces['g40']!.tags['hip']).toBeUndefined();
  });

  it('no Gun may be pushed into Bypass', () => {
    const { engine, state } = makeEngine({
      board: 'u',
      terrain: BUILDING,
      scenario: { firstSide: 'ge', sides: [{ side: 'ge', name: 'German', nationality: 'ge', elr: 3 }, { side: 'br', name: 'British', nationality: 'br', elr: 3 }] },
      modules: ASL,
      startPhase: 'MPh',
      pieces: [{ id: 'c1', def: 'ge.228c', side: 'ge', hex: 'uQ4' }, { id: 'g75', def: 'ge.AT75L', side: 'ge', heldBy: 'c1', tags: { ca: 1 } }],
    });
    const s = act(engine, state, { type: 'move.start', units: ['c1'], manhandle: 'g75' }).state;
    expect(check(engine, s, { type: 'move.step', to: 'uR3', bypass: ['uR4'] })).toMatch(/Gun may not be pushed/);
    expect(engine.legalActions(s, 'ge').some((a) => a['bypass'])).toBe(false);
  });
});
