// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act as reactAct, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Engine, GameState, LoggedEvent } from '@asl/engine';
import { act, makeEngine } from '../../../packages/rules/test/fixtures';
import { usePresentation } from '../src/game/presentation';
import { useGameFx } from '../src/fx/useGameFx';
import { CloseCombat } from '../src/panels/CloseCombat';

vi.mock('../src/audio/engine', () => ({ playSfx: () => {} }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A simultaneous CC (SK1 3.8): an American 7-4-7 and a German 4-6-7 each roll a 3, so each eliminates the other. */
function closeCombat() {
  const { engine, state } = makeEngine({
    startPhase: 'APh',
    dice: [1, 2, 2, 1, 6, 6, 6, 6],
    pieces: [
      { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5' },
      { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yO5' },
    ],
  });
  const created = engine.createGame({ scenarioId: 'test', sides: state.sides, attacker: state.attacker, seed: 'test' });
  let s: GameState = act(engine, state, { type: 'advance', units: ['a1'], to: 'yO5' }).state;
  s = act(engine, s, { type: 'endPhase' }).state;
  for (let guard = 0; guard < 10 && engine.currentDecision(s)?.kind !== 'ccDeclare'; guard++) s = engine.submit(s, engine.legalActions(s, engine.currentDecision(s)!.owner)[0]!).state;
  s = act(engine, s, { type: 'cc.declare', attacks: [{ attackers: ['a1'], targets: ['g1'] }] }).state;
  const t = act(engine, s, { type: 'cc.declare', attacks: [{ attackers: ['g1'], targets: ['a1'] }] });
  return { engine, before: s, created: created.events, t };
}

function Screen({ engine, state, log }: { engine: Engine; state: GameState; log: LoggedEvent[] }) {
  const present = usePresentation(engine, state, log, false, 0);
  const env = engine.env(present.state);
  useGameFx(engine.env(state), log, engine.currentDecision(present.state), 'full', null, present, 0);
  return createElement(CloseCombat, {
    env,
    log: present.log,
    resolving: present.resolving,
    decision: engine.currentDecision(present.state) ?? undefined,
    owner: undefined,
    waitingOn: undefined,
    sideName: (s?: string) => (s === 'am' ? 'American' : 'German'),
    run: () => null,
    check: () => null,
    plain: (m) => m ?? null,
    animate: true,
  });
}

let root: Root | null = null;
let host: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] });
  host = document.createElement('div');
  root = createRoot(host);
});
afterEach(() => {
  reactAct(() => root?.unmount());
  root = null;
  vi.useRealTimers();
});

/** Each side's result card: whether it shows dice, and its text. */
const cards = () =>
  [...host.querySelectorAll('.cc-group')].map((g) => ({
    side: [...g.classList].find((c) => c.startsWith('side-'))!.slice(5),
    dice: g.querySelectorAll('.cc-dice').length > 0,
    text: g.querySelector('.cc-mid')?.textContent ?? '',
  }));

describe('the Close Combat overlay while a simultaneous CC is told', () => {
  it('shows a side’s dice only when they land: the other side’s roll waits, then comes with its result', () => {
    const { engine, before, created, t } = closeCombat();
    const show = (state: GameState, log: LoggedEvent[]) => reactAct(() => root!.render(createElement(Screen, { engine, state, log })));
    const wait = (ms: number) => reactAct(() => vi.advanceTimersByTime(ms));
    show(before, created);
    show(t.state, [...created, ...t.events]);
    // The American roll has landed with its result; the German roll is logged but has not been played yet.
    wait(600);
    const first = cards();
    expect(first.find((c) => c.side === 'am')).toMatchObject({ dice: true });
    expect(first.find((c) => c.side === 'am')!.text).toContain('Eliminated');
    expect(first.find((c) => c.side === 'ge')).toMatchObject({ dice: false, text: 'Rolling…' });
    // Then the German dice land, and its result shows with them.
    wait(4500);
    const ge = cards().find((c) => c.side === 'ge')!;
    expect(ge.dice).toBe(true);
    expect(ge.text).toContain('Eliminated');
  });
});
