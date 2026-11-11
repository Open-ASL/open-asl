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
function Screen({ engine, state, log }: { engine: Engine; state: GameState; log: LoggedEvent[] }) {
  const present = usePresentation(engine, state, log);
  const fx = useGameFx(engine.env(state), log, engine.currentDecision(present.state), 'full', null, present);
  seen = { present, fx };
  return null;
}

let root: Root | null = null;
let host: HTMLElement | null = null;
const show = (engine: Engine, state: GameState, log: LoggedEvent[]) =>
  reactAct(() => {
    root!.render(createElement(Screen, { engine, state, log }));
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
