import { describe, expect, it } from 'vitest';
import { moveState, sk2CoreModules, statics } from '../src';
import { GE_VS_BR, RU_VS_GE, act, makeEngine } from './fixtures';

/*
 * SK4 1.1.1 Orchard-Road (ASLRB B14.6). Board u's tree-lined road J4-J5-J6-J7 on the hex-level
 * map: J5-J7 are Orchard-Road hexes (orchard with a paved road), entered along the road at the road rate. On the grid
 * the line is on the road in an Orchard-Road hex when it enters and leaves it through road hexsides (the pixel map,
 * `content/test/orchardRoad.test.ts`, follows the road art itself).
 */
const OR = { terrain: 'orchard', features: ['road:paved', 'orchard-road'] };
const terrain = { uJ3: { terrain: 'open', features: ['road:paved'] }, uJ4: { terrain: 'open', features: ['road:paved'] }, uJ5: OR, uJ6: OR, uJ7: OR, uJ8: OR };
const roadHexsides: [string, string][] = [
  ['uJ3', 'uJ4'],
  ['uJ4', 'uJ5'],
  ['uJ5', 'uJ6'],
  ['uJ6', 'uJ7'],
  ['uJ7', 'uJ8'],
];

const drmLabels = (events: { type: string; payload: unknown }[]) =>
  ((events.find((e) => e.type === 'sk1.fire.attack')!.payload as { explain: { label?: string }[] }).explain ?? []).map((n) => n.label ?? '');

describe('Orchard-Road LOS (SK4 1.1.1, ASLRB B14.6)', () => {
  const { engine, state } = makeEngine({ board: 'u', terrain, roadHexsides, pieces: [] });
  const env = engine.env(state);
  const los = (a: string, b: string) => env.query('los.trace', { from: a, to: b }, { clear: true, hindrance: 0, parts: [] });

  it('a LOS along the road through Orchard-Road hexes is not hindered; one across them is', () => {
    expect(los('uJ3', 'uJ8')).toMatchObject({ clear: true, hindrance: 0 });
    expect(los('uJ8', 'uJ3')).toMatchObject({ clear: true, hindrance: 0 });
    // Across the road: J5 hinders as any orchard (B14.21).
    const across = los('uI5', 'uK6');
    expect(across.parts.map((p) => p.hex)).toEqual(['uJ5']);
  });

  it('reports the end Orchard-Road hexes the line leaves the road in', () => {
    const map = statics(env).map;
    expect(map.los('uJ3', 'uJ6').orchard).toBeUndefined();
    expect(map.los('uI6', 'uJ6').orchard).toEqual(['uJ6']);
  });
});

describe('Orchard-Road LOS between elevations (SK4 1.1.1: "regardless of elevation differences")', () => {
  // J3 and I5 on a level 1 hill; in season an orchard blocks LOS between elevations, except along its road.
  const hill = { terrain: 'open', elevation: 1 };
  const mk = (month: number) =>
    makeEngine({
      board: 'u',
      terrain: { ...terrain, uJ3: { ...hill, features: ['road:paved'] }, uI5: hill },
      roadHexsides,
      extra: [...sk2CoreModules],
      scenario: { ...GE_VS_BR, month },
      pieces: [],
    });
  const losIn = (month: number, a: string, b: string) => {
    const { engine, state } = mk(month);
    return engine.env(state).query('los.trace', { from: a, to: b }, { clear: true, hindrance: 0, parts: [] });
  };

  it('in season, the LOS down the road from the hill is clear; one across an Orchard-Road hex is blocked', () => {
    expect(losIn(7, 'uJ3', 'uJ8')).toMatchObject({ clear: true, hindrance: 0 });
    expect(losIn(7, 'uI5', 'uK6')).toMatchObject({ clear: false });
    expect(losIn(1, 'uI5', 'uK6')).toMatchObject({ clear: true, hindrance: 1 });
  });
});

describe('Orchard-Road movement (SK4 1.1.1, ASLRB B3.43, B14.6)', () => {
  // A German squad comes down the road J4-J5-J6; Russian squads watch J6 from J8 (down the road) and from I6 (across).
  const setup = (dice: number[] = []) =>
    makeEngine({
      board: 'u',
      terrain,
      roadHexsides,
      startPhase: 'MPh',
      dice,
      pieces: [
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'uJ5' },
        { id: 'r1', def: 'ru.447', side: 'ru', hex: 'uJ8' },
        { id: 'r2', def: 'ru.447', side: 'ru', hex: 'uI6' },
      ],
      scenario: { ...RU_VS_GE, firstSide: 'ge' },
    });
  const started = (dice: number[] = []) => {
    const { engine, state } = setup(dice);
    return { engine, s: act(engine, state, { type: 'move.start', units: ['g1'] }).state };
  };

  it('Infantry entering along the road choose the road or the orchard, both at one MF; the orchard forfeits the road bonus', () => {
    const { engine, s } = started();
    const into = engine.legalActions(s, 'ge').filter((a) => a.type === 'move.step' && a['to'] === 'uJ6');
    expect(into.map((a) => !!a['woods']).sort()).toEqual([false, true]);
    const road = moveState(engine.env(act(engine, s, { type: 'move.step', to: 'uJ6' }).state))!;
    expect(road).toMatchObject({ hex: 'uJ6', viaRoad: true, roadOnly: true, mfHere: 1 });
    const orchard = moveState(engine.env(act(engine, s, { type: 'move.step', to: 'uJ6', woods: true }).state))!;
    expect(orchard).toMatchObject({ hex: 'uJ6', viaRoad: false, roadOnly: false, mfHere: 1 });
    // No choice off the road.
    expect(engine.legalActions(s, 'ge').some((a) => a.type === 'move.step' && a['to'] !== 'uJ6' && a['woods'])).toBe(false);
  });

  it('on the road: FFMO against a firer whose LOS stays on the road; not from the side, nor once in the orchard', () => {
    const { engine, s } = started([4, 3, 4, 3, 4, 3]);
    const road = act(engine, s, { type: 'move.step', to: 'uJ6' }).state;
    const along = drmLabels(act(engine, road, { type: 'defFire', decl: { units: ['r1'], sw: [], target: 'uJ6' } }).events);
    expect(along).toContain('-1 FFMO');
    expect(along.some((l) => /Hindrance/.test(l))).toBe(false);
    const side = drmLabels(act(engine, road, { type: 'defFire', decl: { units: ['r2'], sw: [], target: 'uJ6' } }).events);
    expect(side).not.toContain('-1 FFMO');

    const orchard = act(engine, s, { type: 'move.step', to: 'uJ6', woods: true }).state;
    const inOrchard = drmLabels(act(engine, orchard, { type: 'defFire', decl: { units: ['r1'], sw: [], target: 'uJ6' } }).events);
    expect(inOrchard).not.toContain('-1 FFMO');
  });
});
