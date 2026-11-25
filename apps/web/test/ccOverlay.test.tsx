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
function closeCombat(dice = [1, 2, 2, 1, 6, 6, 6, 6]) {
  const { engine, state } = makeEngine({
    startPhase: 'APh',
    dice,
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
    // It keeps the odds it was declared at while its roll waits its turn.
    const waitingGe = first.find((c) => c.side === 'ge')!;
    expect(waitingGe.dice).toBe(false);
    expect(waitingGe.text).toContain('Rolling…');
    expect(waitingGe.text).toMatch(/\d+ vs \d+/);
    // Then the German dice land, and its result shows with them.
    wait(4500);
    const ge = cards().find((c) => c.side === 'ge')!;
    expect(ge.dice).toBe(true);
    expect(ge.text).toContain('Eliminated');
  });

  it('keeps each attack’s card in place when its dice land, instead of taking it away and showing it again', () => {
    const { engine, before, created, t } = closeCombat();
    const show = (state: GameState, log: LoggedEvent[]) => reactAct(() => root!.render(createElement(Screen, { engine, state, log })));
    const wait = (ms: number) => reactAct(() => vi.advanceTimersByTime(ms));
    show(before, created);
    show(t.state, [...created, ...t.events]);
    // Locked in, before any dice have landed: both attacks wait for their rolls.
    const waiting = [...host.querySelectorAll('.cc-group')];
    expect(cards().map((c) => c.dice)).toEqual([false, false]);
    wait(600);
    wait(4500);
    // Every die has landed and the cards are the same elements: not mounted afresh (which replays their entry animation).
    expect(cards().map((c) => c.dice)).toEqual([true, true]);
    expect([...host.querySelectorAll('.cc-group')]).toEqual(waiting);
  });

  /**
   * Plays a CC out with the given dice (the American DR, the German DR, then any Leader Creation dr) and samples the
   * overlay every 100 ms: the cards, what each says, and the units in the pools.
   */
  const playOut = (dice: number[]) => {
    const { engine, before, created, t } = closeCombat(dice);
    const show = (state: GameState, log: LoggedEvent[]) => reactAct(() => root!.render(createElement(Screen, { engine, state, log })));
    show(before, created);
    show(t.state, [...created, ...t.events]);
    const first = [...host.querySelectorAll('.cc-cards .cc-group')];
    const samples: { cards: ReturnType<typeof cards>; same: boolean; pools: string[] }[] = [];
    for (let ms = 0; ms < 9000 && host.querySelector('.cc-overlay'); ms += 100) {
      const now = [...host.querySelectorAll('.cc-cards .cc-group')];
      samples.push({ cards: cards(), same: now.length === first.length && now.every((g, i) => g === first[i]), pools: [...host.querySelectorAll('.cc-pool .cc-unit')].map((u) => u.getAttribute('data-cc-unit')!) });
      reactAct(() => vi.advanceTimersByTime(100));
    }
    return { t, samples };
  };
  /** What every sample must hold, whatever the dice. */
  const steady = (samples: ReturnType<typeof playOut>['samples']) => {
    expect(samples.length).toBeGreaterThan(10);
    // The same two cards from the lock-in to the end: none taken off and put back.
    expect(samples.every((s) => s.same && s.cards.length === 2)).toBe(true);
    // A roll waiting its turn keeps its odds.
    for (const s of samples) for (const c of s.cards) if (c.text.includes('Rolling…')) expect(c.text).toMatch(/\d+ vs \d+/);
    // A side's dice show with its result, never before.
    for (const s of samples) for (const c of s.cards) if (c.dice) expect(c.text).toMatch(/Eliminated|Casualty Reduction|No effect/);
    const last = samples[samples.length - 1]!;
    expect(last.cards.every((c) => c.dice)).toBe(true);
  };

  it('tells an American original 2 (1,1) with its Field Promotion on the American card only (SK1 5.3)', () => {
    const { t, samples } = playOut([1, 1, 6, 6, 1, 6, 6, 6, 6]);
    expect(t.events.some((e) => e.type === 'dice.rolled' && (e.payload as { label: string }).label === 'Leader Creation for a1')).toBe(true);
    steady(samples);
    const last = samples[samples.length - 1]!;
    expect(last.cards.find((c) => c.side === 'am')!.text).toContain('Field promotion');
    expect(samples.some((s) => s.cards.find((c) => c.side === 'ge')!.text.includes('Field promotion'))).toBe(false);
  });

  it('tells a German original 2 (1,1) after the German roll lands, though the engine logs it before the American result', () => {
    const { t, samples } = playOut([2, 3, 1, 1, 1, 6, 6, 6, 6]);
    const promotion = t.events.find((e) => e.type === 'sk1.leaderCreation')!.payload as { unit: string; leader: string | null };
    expect(promotion.unit).toBe('g1');
    steady(samples);
    // The American card never carries the German Field Promotion.
    expect(samples.some((s) => s.cards.find((c) => c.side === 'am')!.text.includes('Field promotion'))).toBe(false);
    expect(samples[samples.length - 1]!.cards.find((c) => c.side === 'ge')!.text).toContain('Field promotion');
    // A leader it creates joins the German pool only once the German roll has been told.
    if (promotion.leader) {
      for (const s of samples) if (s.cards.find((c) => c.side === 'ge')!.text.includes('Rolling…')) expect(s.pools).not.toContain(promotion.leader);
    }
  });

  it('tells two original 12s (6,6) like any other rolls: simultaneous, one side at a time', () => {
    const { t, samples } = playOut([6, 6, 6, 6, 6, 6, 6, 6]);
    expect(t.events.filter((e) => e.type === 'dice.rolled' && /^CC /.test((e.payload as { label: string }).label))).toHaveLength(2);
    steady(samples);
    // The German roll waited for the American result before landing.
    expect(samples.some((s) => s.cards.find((c) => c.side === 'am')!.dice && s.cards.find((c) => c.side === 'ge')!.text.includes('Rolling…'))).toBe(true);
  });
});
