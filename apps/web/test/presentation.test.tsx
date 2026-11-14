// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act as reactAct, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Action, Ctx, Engine, GameState, LoggedEvent, RuleModule } from '@asl/engine';
import { FP, type FireDeclaration, type FireMode, type ResolveFireFn } from '@asl/rules';
import { act, makeEngine } from '../../../packages/rules/test/fixtures';
import { usePresentation, type Presentation } from '../src/game/presentation';
import { useGameFx, type GameFx } from '../src/fx/useGameFx';

vi.mock('../src/audio/engine', () => ({ playSfx: () => {} }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const testFire: RuleModule = {
  id: 'test.fire',
  install(r) {
    r.action<Action & { decl: FireDeclaration; mode: FireMode }>({
      type: 'test.fire',
      decisionKinds: ['phase'],
      resolve(ctx: Ctx, a) {
        ctx.proc<ResolveFireFn>(FP.resolve)(ctx, a.decl, a.mode);
      },
    });
  },
};

/** What the screen would show, captured at each render. */
let seen: { present: Presentation; fx: GameFx } | null = null;
function Screen({ engine, state, log, seek = 0 }: { engine: Engine; state: GameState; log: LoggedEvent[]; seek?: number }) {
  const present = usePresentation(engine, state, log, false, seek);
  const fx = useGameFx(engine.env(state), log, engine.currentDecision(present.state), 'full', null, present, seek);
  seen = { present, fx };
  return null;
}

let root: Root | null = null;
let host: HTMLElement | null = null;
const show = (engine: Engine, state: GameState, log: LoggedEvent[], seek = 0) =>
  reactAct(() => {
    root!.render(createElement(Screen, { engine, state, log, seek }));
  });
const wait = (ms: number) =>
  reactAct(() => {
    vi.advanceTimersByTime(ms);
  });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] });
  host = document.createElement('div');
  root = createRoot(host);
});
afterEach(() => {
  reactAct(() => root?.unmount());
  root = null;
  host = null;
  seen = null;
  vi.useRealTimers();
});

describe('the board follows the dice as they are revealed', () => {
  it('breaks a unit when its Morale Check is shown, not when the fire is resolved', async () => {
    const { engine, state } = makeEngine({
      extra: [testFire],
      terrain: { yP5: { terrain: 'building-stone' } },
      pieces: [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5' },
        { id: 'a2', def: 'am.666', side: 'am', hex: 'yO6' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP5' },
      ],
      // Attack DR 4+2 (an NMC); g1's MC 6+5 = 11 vs morale 7: broken (and ELR-replaced).
      dice: [4, 2, 6, 5],
    });
    const created = engine.createGame({ scenarioId: 'test', sides: state.sides, attacker: state.attacker, seed: 'test' });
    await show(engine, state, created.events);
    const t = act(engine, state, { type: 'test.fire', mode: 'prep', decl: { units: ['a1', 'a2'], sw: [], target: 'yP5' } });
    expect(t.state.pieces['g1']!.tags['broken']).toBe(true);
    const log = [...created.events, ...t.events];
    await show(engine, t.state, log);

    // Resolved by the engine, but nothing shown yet: the unit stands, orders wait.
    expect(seen!.present.resolving).toBe(true);
    expect(seen!.present.state.pieces['g1']!.tags['broken']).toBeUndefined();
    expect(seen!.present.state.pieces['g1']!.defId).toBe('ge.467');
    expect(seen!.present.log.some((e) => e.type === 'sk1.check')).toBe(false);

    // The attack roll lands: its result is shown, the Morale Check is still to come.
    await wait(600);
    expect(seen!.fx.history).toHaveLength(1);
    expect(seen!.present.state.pieces['g1']!.tags['broken']).toBeUndefined();
    expect(seen!.present.log.some((e) => e.type === 'sk1.fire.result')).toBe(true);

    // The Morale Check roll appears, then its result: broken, replaced, and the game is caught up.
    await wait(1200);
    expect(seen!.fx.history).toHaveLength(2);
    expect(seen!.present.state.pieces['g1']!.tags['broken']).toBeUndefined();
    await wait(600);
    expect(seen!.present.state.pieces['g1']!.tags['broken']).toBe(true);
    expect(seen!.present.resolving).toBe(false);
    expect(seen!.present.state).toBe(t.state);
  });

  it('starts the next phase only once the last Close Combat roll has played out', async () => {
    const { engine, state } = makeEngine({
      startPhase: 'APh',
      dice: [6, 6, 6, 6, 6, 6, 6, 6],
      pieces: [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yO5' },
      ],
    });
    const created = engine.createGame({ scenarioId: 'test', sides: state.sides, attacker: state.attacker, seed: 'test' });
    let log = [...created.events];
    await show(engine, state, log);
    const adv = act(engine, state, { type: 'advance', units: ['a1'], to: 'yO5' });
    let s = adv.state;
    log = [...log, ...adv.events];
    const t = act(engine, s, { type: 'endPhase' });
    s = t.state;
    log = [...log, ...t.events];
    expect(s.phase).toBe('CCPh');
    await show(engine, s, log);
    await wait(100);
    expect(seen!.present.state.phase).toBe('CCPh');
    // Resolve the Close Combat as fast as the engine allows, as a remote opponent's actions arrive.
    for (let guard = 0; guard < 20 && s.phase === 'CCPh'; guard++) {
      const d = engine.currentDecision(s)!;
      // Each side attacks with everything it may (a declaration with attacks, when offered).
      const options = engine.legalActions(s, d.owner);
      const next = engine.submit(s, options.find((o) => Array.isArray(o['attacks']) && (o['attacks'] as unknown[]).length > 0) ?? options[0]!);
      s = next.state;
      log = [...log, ...next.events];
      await show(engine, s, log);
    }
    expect(s.phase).not.toBe('CCPh');
    const rolls = log.filter((e) => e.type === 'dice.rolled' && e.seq > created.events.length).length;
    expect(rolls).toBeGreaterThan(0);
    // Step through time: note when the last roll is shown and when the phase changes on screen.
    let lastRollAt = -1;
    let phaseAt = -1;
    for (let ms = 0; ms < 30000 && phaseAt < 0; ms += 50) {
      await wait(50);
      if (lastRollAt < 0 && seen!.fx.history.length === rolls) lastRollAt = ms;
      if (seen!.present.state.phase !== 'CCPh') phaseAt = ms;
    }
    expect(lastRollAt).toBeGreaterThanOrEqual(0);
    expect(phaseAt).toBeGreaterThanOrEqual(lastRollAt + 1500);
    expect(seen!.present.resolving).toBe(false);
  });
});

describe('a replay jump shows where it lands at once', () => {
  /** A fire that breaks g1 (attack 4+2, MC 6+5), then the phase ended: two steps a replay can jump across. */
  function recorded() {
    const { engine, state } = makeEngine({
      extra: [testFire],
      terrain: { yP5: { terrain: 'building-stone' } },
      pieces: [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5' },
        { id: 'a2', def: 'am.666', side: 'am', hex: 'yO6' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP5' },
      ],
      dice: [4, 2, 6, 5],
    });
    const created = engine.createGame({ scenarioId: 'test', sides: state.sides, attacker: state.attacker, seed: 'test' });
    const fired = act(engine, state, { type: 'test.fire', mode: 'prep', decl: { units: ['a1', 'a2'], sw: [], target: 'yP5' } });
    const ended = act(engine, fired.state, { type: 'endPhase' });
    const log0 = [...created.events];
    const log1 = [...log0, ...fired.events];
    const log2 = [...log1, ...ended.events];
    return { engine, frames: [{ state, log: log0 }, { state: fired.state, log: log1 }, { state: ended.state, log: log2 }] };
  }

  it('jumping forward over a fire and a phase change plays no dice and turns no wheel', async () => {
    const { engine, frames } = recorded();
    await show(engine, frames[0]!.state, frames[0]!.log);
    await wait(5000);
    await reactAct(() => seen!.fx.dismissWheel());
    await show(engine, frames[2]!.state, frames[2]!.log, 1);
    expect(seen!.present.resolving).toBe(false);
    expect(seen!.present.state).toBe(frames[2]!.state);
    expect(seen!.present.state.pieces['g1']!.tags['broken']).toBe(true);
    expect(seen!.fx.toasts).toHaveLength(0);
    expect(seen!.fx.wheel).toBeNull();
    await wait(5000);
    expect(seen!.fx.history).toHaveLength(0);
    expect(seen!.fx.wheel).toBeNull();
  });

  it('jumping back shows the earlier position without a wheel, and the next step forward plays as it happened', async () => {
    const { engine, frames } = recorded();
    await show(engine, frames[0]!.state, frames[0]!.log);
    await show(engine, frames[2]!.state, frames[2]!.log, 1);
    await wait(5000);
    await reactAct(() => seen!.fx.dismissWheel());
    await show(engine, frames[0]!.state, frames[0]!.log, 2);
    await wait(100);
    expect(seen!.present.state).toBe(frames[0]!.state);
    expect(seen!.fx.wheel).toBeNull();

    // One step on, with no jump: the fire plays roll by roll, as it did in the game.
    await show(engine, frames[1]!.state, frames[1]!.log, 2);
    expect(seen!.present.resolving).toBe(true);
    expect(seen!.present.state.pieces['g1']!.tags['broken']).toBeUndefined();
    await wait(5000);
    expect(seen!.fx.history).toHaveLength(2);
    expect(seen!.present.state.pieces['g1']!.tags['broken']).toBe(true);

    // The step that ends the phase turns the wheel.
    await show(engine, frames[2]!.state, frames[2]!.log, 2);
    await wait(100);
    expect(seen!.fx.wheel?.phase).toBe(frames[2]!.state.phase);
  });

  it('a jump while a step is still playing drops what was left of it', async () => {
    const { engine, frames } = recorded();
    await show(engine, frames[0]!.state, frames[0]!.log);
    await show(engine, frames[1]!.state, frames[1]!.log);
    expect(seen!.present.resolving).toBe(true);
    await show(engine, frames[2]!.state, frames[2]!.log, 1);
    expect(seen!.present.resolving).toBe(false);
    await wait(5000);
    expect(seen!.present.state).toBe(frames[2]!.state);
    expect(seen!.fx.toasts).toHaveLength(0);
  });
});

describe('a tab in the background follows the game silently', () => {
  /** A fire that breaks g1 (attack 4+2, MC 6+5): two rolls. */
  function fire() {
    const { engine, state } = makeEngine({
      extra: [testFire],
      terrain: { yP5: { terrain: 'building-stone' } },
      pieces: [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5' },
        { id: 'a2', def: 'am.666', side: 'am', hex: 'yO6' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP5' },
      ],
      dice: [4, 2, 6, 5],
    });
    const created = engine.createGame({ scenarioId: 'test', sides: state.sides, attacker: state.attacker, seed: 'test' });
    const fired = act(engine, state, { type: 'test.fire', mode: 'prep', decl: { units: ['a1', 'a2'], sw: [], target: 'yP5' } });
    const ended = act(engine, fired.state, { type: 'endPhase' });
    return { engine, state, created, fired, ended };
  }
  let hidden = false;
  const setHidden = (h: boolean) =>
    reactAct(() => {
      hidden = h;
      document.dispatchEvent(new Event('visibilitychange'));
    });
  beforeEach(() => {
    hidden = false;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  });
  afterEach(() => {
    delete (document as { hidden?: boolean }).hidden;
  });

  it('plays nothing for what happened while away, and the dice log still has the rolls', async () => {
    const { engine, state, created, fired, ended } = fire();
    await show(engine, state, created.events);
    await wait(5000);
    await reactAct(() => seen!.fx.dismissWheel());
    await setHidden(true);
    const log = [...created.events, ...fired.events, ...ended.events];
    await show(engine, ended.state, log);
    // The board is caught up at once: no beats queued, no toasts, no board effects, no wheel.
    expect(seen!.present.resolving).toBe(false);
    expect(seen!.present.state).toBe(ended.state);
    expect(seen!.fx.toasts).toHaveLength(0);
    expect(seen!.fx.boardFx).toHaveLength(0);
    expect(seen!.fx.wheel).toBeNull();
    expect(seen!.fx.history).toHaveLength(2);
    // Back in the tab: nothing is left to play.
    await setHidden(false);
    await wait(5000);
    expect(seen!.fx.toasts).toHaveLength(0);
    expect(seen!.fx.boardFx).toHaveLength(0);
    expect(seen!.fx.wheel).toBeNull();
  });

  it('leaving the tab mid-fire shows the outcome and drops the rest; the next action back in the tab plays', async () => {
    const { engine, state, created, fired, ended } = fire();
    await show(engine, state, created.events);
    await wait(5000);
    await reactAct(() => seen!.fx.dismissWheel());
    await show(engine, fired.state, [...created.events, ...fired.events]);
    expect(seen!.present.resolving).toBe(true);
    await setHidden(true);
    expect(seen!.present.resolving).toBe(false);
    expect(seen!.present.state.pieces['g1']!.tags['broken']).toBe(true);
    expect(seen!.fx.boardFx).toHaveLength(0);
    expect(seen!.fx.history).toHaveLength(2);
    await setHidden(false);
    await wait(5000);
    expect(seen!.fx.boardFx).toHaveLength(0);
    // Watching again: the phase change turns the wheel as usual.
    await show(engine, ended.state, [...created.events, ...fired.events, ...ended.events]);
    await wait(100);
    expect(seen!.fx.wheel?.phase).toBe(ended.state.phase);
  });
});
