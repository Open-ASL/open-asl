// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act as reactAct, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Engine, GameState, LoggedEvent } from '@asl/engine';
import type { Tables } from '@asl/rules';
import { act, makeEngine } from '../../../packages/rules/test/fixtures';
import { usePresentation } from '../src/game/presentation';
import { useGameFx } from '../src/fx/useGameFx';
import { CloseCombat } from '../src/panels/CloseCombat';

vi.mock('../src/audio/engine', () => ({ playSfx: () => {} }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A simultaneous CC (SK1 3.8): an American 7-4-7 and a German 4-6-7 each roll a 3, so each eliminates the other. */
function closeCombat(dice = [1, 2, 2, 1, 6, 6, 6, 6], tables?: Partial<Tables>) {
  const { engine, state } = makeEngine({
    startPhase: 'APh',
    dice,
    ...(tables ? { tables } : {}),
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

/** Each side's result card: whether it shows dice, its text, and the units it attacks. */
const cards = () =>
  [...host.querySelectorAll('.cc-group')].map((g) => ({
    side: [...g.classList].find((c) => c.startsWith('side-'))!.slice(5),
    dice: g.querySelectorAll('.cc-dice').length > 0,
    text: g.querySelector('.cc-mid')?.textContent ?? '',
    result: g.querySelector('.cc-result')?.textContent ?? null,
    targets: [...g.querySelectorAll('.cc-zone.t [data-cc-unit]')].map((u) => u.getAttribute('data-cc-unit')!),
  }));
/** A Leader Creation table that makes a leader on a dr of 3 or less (the stub tables never make one). */
const MAKES_LEADERS: Partial<Tables> = { leaderCreation: (nat, _morale, dr) => (dr <= 3 ? `${nat}.L80` : null) };

describe('the Close Combat overlay while a simultaneous CC is told', () => {
  /**
   * Plays a CC out with the given dice (the American DR, the German DR, then any Leader Creation dr) and samples the
   * overlay every 100 ms: the cards, what each says, and the units in the pools.
   */
  const playOut = (dice?: number[], tables?: Partial<Tables>) => {
    const { engine, before, created, t } = closeCombat(dice, tables);
    const show = (state: GameState, log: LoggedEvent[]) => reactAct(() => root!.render(createElement(Screen, { engine, state, log })));
    show(before, created);
    show(t.state, [...created, ...t.events]);
    const first = [...host.querySelectorAll('.cc-cards .cc-group')];
    const samples: { cards: ReturnType<typeof cards>; same: boolean; pools: string[] }[] = [];
    for (let ms = 0; ms < 20000 && host.querySelector('.cc-overlay'); ms += 100) {
      const now = [...host.querySelectorAll('.cc-cards .cc-group')];
      samples.push({ cards: cards(), same: now.length === first.length && now.every((g, i) => g === first[i]), pools: [...host.querySelectorAll('.cc-pool .cc-unit')].map((u) => u.getAttribute('data-cc-unit')!) });
      reactAct(() => vi.advanceTimersByTime(100));
    }
    return { t, samples };
  };
  type Sample = ReturnType<typeof playOut>['samples'][number];
  const side = (s: Sample, x: string) => s.cards.find((c) => c.side === x)!;
  /** Whether a card shows its result yet (the odds also name the results they lead to, so not just its text). */
  const told = (c: ReturnType<typeof cards>[number]) => c.result !== null;
  /** What every sample must hold, whatever the dice. */
  const steady = (samples: Sample[]) => {
    expect(samples.length).toBeGreaterThan(10);
    // The same two cards from the lock-in to the end: none taken off and put back.
    expect(samples.every((s) => s.same && s.cards.length === 2)).toBe(true);
    // Every DR is rolled before any result is applied (SK1 3.8): no result shows until both sides' dice are in.
    for (const s of samples) if (s.cards.some(told)) expect(s.cards.every((c) => c.dice)).toBe(true);
    // Dice waiting for their result keep the odds they were declared at.
    for (const s of samples) for (const c of s.cards) if (c.dice && !told(c)) expect(c.text).toMatch(/\d+ vs \d+/);
    // Both dice in before either result: there is a moment with both and no result.
    expect(samples.some((s) => s.cards.every((c) => c.dice) && !s.cards.some(told))).toBe(true);
    const last = samples[samples.length - 1]!;
    expect(last.cards.every((c) => c.dice && told(c))).toBe(true);
  };

  it('lands both sides’ dice before either result (SK1 3.8): the American roll, the German roll, then the outcomes', () => {
    const { samples } = playOut();
    steady(samples);
    // The American dice land first, on their own, with the odds they were declared at.
    expect(samples.some((s) => side(s, 'am').dice && !side(s, 'ge').dice && /\d+ vs \d+/.test(side(s, 'am').text))).toBe(true);
    expect(side(samples[samples.length - 1]!, 'am').text).toContain('Eliminated');
    expect(side(samples[samples.length - 1]!, 'ge').text).toContain('Eliminated');
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

  it('tells an American original 2 (1,1) with its Field Promotion on the American card only (SK1 5.3)', () => {
    const { t, samples } = playOut([1, 1, 6, 6, 1, 6, 6, 6, 6]);
    expect(t.events.some((e) => e.type === 'dice.rolled' && (e.payload as { label: string }).label === 'Leader Creation for a1')).toBe(true);
    steady(samples);
    expect(side(samples[samples.length - 1]!, 'am').text).toContain('Field promotion');
    expect(samples.some((s) => side(s, 'ge').text.includes('Field promotion'))).toBe(false);
  });

  it('tells a German original 2 (1,1) on the German card once its dice land, before any result', () => {
    // The new leader defends with g1, so the American CR picks one of the two by Random Selection: 2 and 5 do not tie.
    const { t, samples } = playOut([2, 3, 1, 1, 1, 2, 5, 6, 6, 6, 6], MAKES_LEADERS);
    const promotion = t.events.find((e) => e.type === 'sk1.leaderCreation')!.payload as { unit: string; leader: string | null };
    expect(promotion.unit).toBe('g1');
    expect(promotion.leader).not.toBeNull();
    steady(samples);
    // The American card never carries the German Field Promotion; the German card has it before any result is shown.
    expect(samples.some((s) => side(s, 'am').text.includes('Field promotion'))).toBe(false);
    expect(samples.some((s) => side(s, 'ge').text.includes('Field promotion') && !s.cards.some(told))).toBe(true);
    // The leader joins the German pool once the German dice have landed, and stays.
    for (const s of samples) if (!side(s, 'ge').dice) expect(s.pools).not.toContain(promotion.leader);
    expect(samples[samples.length - 1]!.pools).toContain(promotion.leader);
  });

  /**
   * The German 1,1 makes a leader who defends against the American attack (ASLRB A18.12), so the engine resolves it at
   * worse odds than it was declared at (7 FP against 4 + 1: 3:2 becomes 1:1, kill 6 becomes 5). The promotion is told
   * before any result, so the American result first shows at the odds the leader made, saying why.
   */
  const promotionChangesResult = (americanDr: [number, number], actual: string) => {
    // Then 2 and 5 for the Random Selection of a CR's casualty between g1 and the leader, which do not tie.
    const { t, samples } = playOut([...americanDr, 1, 1, 1, 2, 5, 6, 6, 6, 6], MAKES_LEADERS);
    const leader = (t.events.find((e) => e.type === 'sk1.leaderCreation')!.payload as { leader: string }).leader;
    const attack = t.events.find((e) => e.type === 'sk1.cc.attack' && (e.payload as { side: string }).side === 'am')!.payload as { odds: string; result: string };
    expect(attack).toMatchObject({ odds: '1:1', result: actual.toLowerCase() });
    steady(samples);
    // Before its result, the American card shows its dice at the declared 3-2.
    expect(samples.some((s) => side(s, 'am').dice && !told(side(s, 'am')) && side(s, 'am').text.includes('3-2'))).toBe(true);
    // Its result is only ever the one the leader made, shown once the German promotion is on the German card.
    const results = samples.filter((s) => told(side(s, 'am')));
    expect(results.length).toBeGreaterThan(0);
    for (const s of results) {
      expect(side(s, 'ge').text).toContain('Field promotion');
      expect(side(s, 'am').text).toContain('1-1');
      expect(side(s, 'am').text).toContain(actual);
      expect(side(s, 'am').text).toContain('joins the defence');
      expect(side(s, 'am').targets).toContain(leader);
    }
  };

  it('shows an attack the other side’s new leader defends against at the odds he made, saying why: CR instead of Eliminated', () => {
    promotionChangesResult([2, 3], 'Casualty Reduction');
  });

  it('… and No effect instead of Casualty Reduction', () => {
    promotionChangesResult([2, 4], 'No effect');
  });

  it('after an ambush (SK1 3.8), the other side declares on the ambusher’s new leader knowingly: he does not “join the defence”', () => {
    // Woods allow an ambush: the American dr 1 against the German 6 ambushes. The American attack rolls 1,1 and makes a
    // leader (dr 1); the Germans, declaring after it is resolved, attack the squad and the leader together (6,6).
    const { engine, state } = makeEngine({
      startPhase: 'APh',
      terrain: { yO5: { terrain: 'woods' } },
      dice: [1, 6, 1, 1, 1, 6, 6, 6, 6, 6, 6],
      tables: MAKES_LEADERS,
      pieces: [
        { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5' },
        { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yO5' },
        { id: 'g2', def: 'ge.467', side: 'ge', hex: 'yO5' },
      ],
    });
    const created = engine.createGame({ scenarioId: 'test', sides: state.sides, attacker: state.attacker, seed: 'test' }).events;
    let s: GameState = act(engine, state, { type: 'advance', units: ['a1'], to: 'yO5' }).state;
    s = act(engine, s, { type: 'endPhase' }).state;
    for (let guard = 0; guard < 10 && engine.currentDecision(s)?.kind !== 'ccDeclare'; guard++) s = engine.submit(s, engine.legalActions(s, engine.currentDecision(s)!.owner)[0]!).state;
    expect(engine.currentDecision(s)!.data?.['ambusher']).toBe('am');
    const ambush = act(engine, s, { type: 'cc.declare', attacks: [{ attackers: ['a1'], targets: ['g1'] }] });
    const leader = (ambush.events.find((e) => e.type === 'sk1.leaderCreation')!.payload as { leader: string }).leader;
    expect(leader).toBeTruthy();
    const reply = act(engine, ambush.state, { type: 'cc.declare', attacks: [{ attackers: ['g2'], targets: ['a1', leader] }] });
    const show = (state: GameState, log: LoggedEvent[]) => reactAct(() => root!.render(createElement(Screen, { engine, state, log })));
    show(s, created);
    show(ambush.state, [...created, ...ambush.events]);
    reactAct(() => vi.advanceTimersByTime(6000));
    show(reply.state, [...created, ...ambush.events, ...reply.events]);
    const samples: ReturnType<typeof cards>[] = [];
    for (let ms = 0; ms < 20000 && host.querySelector('.cc-overlay'); ms += 100) {
      samples.push(cards());
      reactAct(() => vi.advanceTimersByTime(100));
    }
    const ge = samples.map((c) => c.find((x) => x.side === 'ge')).filter((c) => !!c);
    expect(ge.some((c) => c.dice)).toBe(true);
    expect(ge.some((c) => c.text.includes('joins the defence'))).toBe(false);
    expect(ge[ge.length - 1]!.targets).toContain(leader);
    expect(samples[samples.length - 1]!.find((c) => c.side === 'am')!.text).toContain('Field promotion');
  });

  it('tells two original 12s (6,6) like any other rolls: both dice, then both results', () => {
    const { t, samples } = playOut([6, 6, 6, 6, 6, 6, 6, 6]);
    expect(t.events.filter((e) => e.type === 'dice.rolled' && /^CC /.test((e.payload as { label: string }).label))).toHaveLength(2);
    steady(samples);
  });
});
