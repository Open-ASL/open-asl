import { describe, expect, it } from 'vitest';
import type { Engine, GameState } from '@asl/engine';
import { moveState, statics } from '../src';
import { act, makeEngine } from './fixtures';

// Board y: an American squad comes up the road M3-M4-M5; M4 is a Woods-Road hex. A German squad in M7
// watches M4 down the open file M5-M6.
const terrain = { yM4: { terrain: 'woods', features: ['road:dirt', 'woods-road'] } };
const roadHexsides: [string, string][] = [
  ['yM3', 'yM4'],
  ['yM4', 'yM5'],
];

/** The labels of the DRM of the attack in `events`. */
const drmLabels = (events: { type: string; payload: unknown }[]) =>
  ((events.find((e) => e.type === 'sk1.fire.attack')!.payload as { explain: { label?: string }[] }).explain ?? []).map((n) => n.label ?? '');

/** Every firer's LOS into the target hex crosses its woods symbol (the pixel LOS reports it; the test grid does not). */
function woodsInSight(engine: Engine, state: GameState, hex: string) {
  const map = statics(engine.env(state)).map;
  const los = map.los.bind(map);
  map.los = (from, to) => {
    const r = los(from, to);
    return to === hex || from === hex ? { ...r, woods: [hex] } : r;
  };
}

describe('Woods-Road (SK1 1.1.1)', () => {
  const setup = (dice: number[] = []) =>
    makeEngine({
      terrain,
      roadHexsides,
      startPhase: 'MPh',
      dice,
      pieces: [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yM3' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yM7' },
      ],
    });

  it('Infantry entering along the road choose the road or the woods', () => {
    const { engine, state } = setup();
    const s = act(engine, state, { type: 'move.start', units: ['a1'] }).state;
    const into = engine.legalActions(s, 'am').filter((a) => a.type === 'move.step' && a['to'] === 'yM4');
    expect(into.map((a) => !!a['woods']).sort()).toEqual([false, true]);
    // A Woods-Road hex not entered along the road offers no choice.
    expect(engine.legalActions(s, 'am').some((a) => a.type === 'move.step' && a['to'] !== 'yM4' && a['woods'])).toBe(false);
    expect(() => act(engine, s, { type: 'move.step', to: 'yN3', woods: true })).toThrow(/Woods-Road/);

    // Along the road: the road (Open Ground) rate, and still on the road for the bonus.
    const road = moveState(engine.env(act(engine, s, { type: 'move.step', to: 'yM4' }).state))!;
    expect(road).toMatchObject({ hex: 'yM4', viaRoad: true, roadOnly: true, mfHere: 1 });
    // Into the woods: the woods rate, and the road bonus is gone (SK1 3.3).
    const woods = moveState(engine.env(act(engine, s, { type: 'move.step', to: 'yM4', woods: true }).state))!;
    expect(woods).toMatchObject({ hex: 'yM4', viaRoad: false, roadOnly: false, mfHere: 2 });
  });

  it('on the road the unit has no woods TEM and is subject to FFMO; in the woods it has the TEM', () => {
    const { engine, state } = setup([4, 3, 4, 3]);
    const s = act(engine, state, { type: 'move.start', units: ['a1'] }).state;
    const road = act(engine, s, { type: 'move.step', to: 'yM4' }).state;
    const onRoad = drmLabels(act(engine, road, { type: 'defFire', decl: { units: ['g1'], sw: [], target: 'yM4' } }).events);
    expect(onRoad).toContain('-1 FFMO');
    expect(onRoad).toContain('no Woods TEM: moving along Woods-Road');

    const woods = act(engine, s, { type: 'move.step', to: 'yM4', woods: true }).state;
    const inWoods = drmLabels(act(engine, woods, { type: 'defFire', decl: { units: ['g1'], sw: [], target: 'yM4' } }).events);
    expect(inWoods).not.toContain('-1 FFMO');
    expect(inWoods).not.toContain('no Woods TEM: moving along Woods-Road');
  });

  it('keeps the woods TEM, and is not in Open Ground, against a LOS that crosses a woods symbol in the hex', () => {
    const { engine, state } = setup([4, 3]);
    woodsInSight(engine, state, 'yM4');
    const s = act(engine, act(engine, state, { type: 'move.start', units: ['a1'] }).state, { type: 'move.step', to: 'yM4' }).state;
    const labels = drmLabels(act(engine, s, { type: 'defFire', decl: { units: ['g1'], sw: [], target: 'yM4' } }).events);
    expect(labels).not.toContain('-1 FFMO');
    expect(labels).not.toContain('no Woods TEM: moving along Woods-Road');
  });
});

describe('Woods-Road in the Rout Phase (SK1 1.1.1, 3.6)', () => {
  // A broken American in Open Ground at M3, in the view of a German squad: it must rout, and the Woods-Road
  // hex M4 is the nearest woods.
  const setup = (dice: number[] = []) =>
    makeEngine({
      terrain,
      roadHexsides,
      startPhase: 'RtPh',
      dice,
      pieces: [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yM3', tags: { broken: true } },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yQ4' },
      ],
    });
  const rolled = (events: { type: string; payload: unknown }[]) => events.filter((e) => e.type === 'dice.rolled' || e.type === 'roll').length;

  it('routing along the road is Interdiction in the open; into the woods it is not', () => {
    const { engine, state } = setup([2, 1]);
    const steps = engine.legalActions(state, 'am').filter((a) => a.type === 'rout.step' && a['to'] === 'yM4' && !a['lowCrawl']);
    expect(steps.map((a) => !!a['woods']).sort()).toEqual([false, true]);
    const road = act(engine, state, { type: 'rout.step', unit: 'a1', to: 'yM4' });
    expect(rolled(road.events)).toBe(1);
    const woods = act(engine, state, { type: 'rout.step', unit: 'a1', to: 'yM4', woods: true });
    expect(rolled(woods.events)).toBe(0);
  });

  it('no Interdiction on the road when the enemy sees the hex through its woods', () => {
    const { engine, state } = setup([2, 1]);
    woodsInSight(engine, state, 'yM4');
    expect(rolled(act(engine, state, { type: 'rout.step', unit: 'a1', to: 'yM4' }).events)).toBe(0);
  });
});
