import { describe, expect, it } from 'vitest';
import type { Engine, GameState } from '@asl/engine';
import { buildAttack, firstFireTargets, moveState, movingInfo, statics } from '../src';
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

  it('a preview before the attack is declared does not trace the LOS (ASLRB A6.11): the same DRM whatever the LOS crosses', () => {
    const preview = (woods: boolean) => {
      const { engine, state } = setup();
      if (woods) woodsInSight(engine, state, 'yM4');
      const s = act(engine, act(engine, state, { type: 'move.start', units: ['a1'] }).state, { type: 'move.step', to: 'yM4' }).state;
      const env = engine.env(s);
      const ms = moveState(env)!;
      const attack = { ...buildAttack(env, { units: ['g1'], sw: [], target: 'yM4' }, 'first', 'ge', firstFireTargets(env, ms), movingInfo(env, ms)), hindrance: 0, losBlind: true };
      return env.explain('fire.drm', { attack }, 0).trace.filter((t) => !t.suppressedBy && t.label).map((t) => t.label);
    };
    expect(preview(true)).toEqual(preview(false));
    // Taken as out on the road, the firer's best case, as the Hindrance is taken as none.
    expect(preview(true)).toContain('-1 FFMO');
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

  it('an advance along the road costs the road rate: a half-squad with a mortar (2 MF) is not made CX (ASLRB A4.72, B13.4)', () => {
    // The 3-4-8 HS (IPC 3) carries a 5-PP mortar: 4 MF less 2 for the excess PP leaves 2 MF. Into the Woods-Road
    // hex M4 across the M3|M4 road hexside costs 1 MF; from L4, not across a road hexside, the woods cost all 2 MF.
    const advance = (from: string) => {
      const { engine, state } = makeEngine({
        terrain,
        roadHexsides,
        startPhase: 'APh',
        pieces: [
          { id: 'h1', def: 'am.348h', side: 'am', hex: from },
          { id: 'm1', def: 'am.MTR', side: 'am', heldBy: 'h1' },
          { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yM9' },
        ],
      });
      expect(engine.env(state).query('unit.mf', { unit: 'h1', stack: ['h1'], doubleTime: false }, 0)).toBe(2);
      return act(engine, state, { type: 'advance', units: ['h1'], to: 'yM4' }).state.pieces['h1']!;
    };
    const road = advance('yM3');
    expect(road.loc).toMatchObject({ kind: 'hex', hex: 'yM4' });
    expect(road.tags['cx']).toBeUndefined();
    const woods = advance('yL4');
    expect(woods.loc).toMatchObject({ kind: 'hex', hex: 'yM4' });
    expect(woods.tags['cx']).toBe(true);
  });
});
