import { describe, expect, it } from 'vitest';
import { deepEqual, type Action, type GameState } from '@asl/engine';
import { hiddenFrom, redactState } from '@asl/rules';
import { ALL_SCENARIOS, newSk1Game } from '@asl/content';
import { PUBLIC_VIEWER } from '@asl/platform';
import { snapshotsOf, stepsOf, usesViews, viewersOf } from '../src/lib/views';

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A scenario whose Bazookas are secretly recorded (S34 SSR 2), and a plain one, played at random by both seats. */
const S34 = ALL_SCENARIOS.find((s) => s.id === 'sk-s34')!;
const S7 = ALL_SCENARIOS.find((s) => s.id === 'sk-s7')!;

describe('per-viewer views of an online match', () => {
  it('writes a view per side and a public one for a public match only', () => {
    expect(viewersOf({ visibility: 'public' }, ['ge', 'am']).map((v) => v.viewer)).toEqual(['ge', 'am', PUBLIC_VIEWER]);
    expect(viewersOf({ visibility: 'private' }, ['ge', 'am']).map((v) => v.viewer)).toEqual(['ge', 'am']);
    expect(usesViews({ mode: 'online', model: 'views' })).toBe(true);
    expect(usesViews({ mode: 'online' })).toBe(false);
    expect(usesViews({ mode: 'hotseat', model: 'views' })).toBe(false);
  });

  for (const scenario of [S34, S7]) {
    it(`${scenario.id}: each viewer's steps fold from the opening snapshot into every later one, and a seat never receives a hidden enemy id`, () => {
      const g = newSk1Game(scenario, 'views-test', { los: 'grid' });
      const { engine } = g;
      const viewers = viewersOf({ visibility: 'public' }, g.state.sides);
      const views = new Map(snapshotsOf(engine, g.state, 0, viewers).map((s) => [s.viewer, s.state]));
      expect([...views.keys()]).toEqual([...g.state.sides, PUBLIC_VIEWER]);
      const rand = mulberry(7);
      let state: GameState = g.state;
      let leaksChecked = 0;
      for (let i = 0; i < 120 && !state.result; i++) {
        const d = engine.currentDecision(state)!;
        const legal = engine.legalActions(state, d.owner);
        const doing = legal.filter((a) => a.type !== 'endPhase' && a.type !== 'defPass');
        const pool = doing.length && rand() < 0.75 ? doing : legal;
        const action = pool[Math.floor(rand() * pool.length)]! as Action;
        const t = engine.submit(state, action);
        const seq = i + 1;
        const { snapshots, steps } = stepsOf(engine, state, t, seq, d.owner, viewers);
        for (const { viewer, side } of viewers) {
          const snap = snapshots.find((s) => s.viewer === viewer)!;
          const step = steps.find((s) => s.viewer === viewer)!;
          expect(snap.seq).toBe(seq);
          expect(snap.eventSeq).toBe(t.state.seq);
          expect(step.side).toBe(d.owner);
          expect(step.events.length).toBe(t.events.length);
          const folded = engine.applyEvents(views.get(viewer)!, step.events);
          expect(deepEqual(folded, snap.state), `${scenario.id} seq ${seq} viewer ${viewer}`).toBe(true);
          const hiddenNow = hiddenFrom(engine.env(t.state), t.state, side);
          const hiddenBefore = hiddenFrom(engine.env(state), state, side);
          const json = JSON.stringify(snap.state) + JSON.stringify(step.events);
          for (const id of hiddenBefore) if (hiddenNow.has(id)) {
            expect(json).not.toContain(JSON.stringify(id));
            leaksChecked++;
          }
          views.set(viewer, snap.state);
        }
        state = t.state;
      }
      if (scenario === S34) expect(leaksChecked).toBeGreaterThan(0);
      // A seat's own view keeps every one of its pieces (only the enemy's secrets are redacted from it).
      for (const side of state.sides) {
        const own = redactState(engine, state, side);
        for (const p of Object.values(state.pieces)) if (p.side === side) expect(own.pieces[p.id], `${side} sees its own ${p.id}`).toBeDefined();
      }
    });
  }
});
