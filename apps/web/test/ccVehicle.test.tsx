// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act as reactAct, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Engine, GameState, LoggedEvent } from '@asl/engine';
import { ccAttackPreview, sk2CoreModules, sk3CoreModules } from '@asl/rules';
import { RU_VS_GE, act, makeEngine } from '../../../packages/rules/test/fixtures';
import { CloseCombat } from '../src/panels/CloseCombat';

vi.mock('../src/audio/engine', () => ({ playSfx: () => {} }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/*
 * The Close Combat panel against a vehicle (SK4 3.8): Infantry attack it with their Close Combat Value, a final DR under
 * it eliminating the vehicle and equal to it Immobilizing it. There are no odds to show; the vehicle's own attack on the
 * Infantry is odds of its FP against their CCV.
 */

/** A German half-squad in a T-34's hex at the CCPh's declarations (the vehicle's side attacking second); the HS rolls 3 + 3. */
function position(): { engine: Engine; state: GameState; log: LoggedEvent[] } {
  const g = makeEngine({
    pieces: [
      { id: 'hs', def: 'ge.247', side: 'ge', hex: 'yM5' },
      { id: 'pziv', def: 'ru.T34M43', side: 'ru', hex: 'yM5', tags: { vca: 3, ca: 3 } },
    ],
    scenario: RU_VS_GE,
    extra: [...sk2CoreModules, ...sk3CoreModules],
    startPhase: 'CCPh',
    dice: [3, 3, 6, 6],
  });
  let state = g.state;
  const log: LoggedEvent[] = [];
  const step = (a: Parameters<typeof act>[2]) => {
    const t = act(g.engine, state, a);
    log.push(...(t.events as LoggedEvent[]));
    state = t.state;
  };
  if (g.engine.currentDecision(state)?.kind === 'ccHex') step({ type: 'cc.chooseHex', hex: 'yM5' });
  while (g.engine.currentDecision(state)?.kind === 'ccArrange') step({ type: 'cc.arranged' });
  return { engine: g.engine, state, log };
}

let root: Root | null = null;
let host: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  reactAct(() => root?.unmount());
  host.remove();
  vi.useRealTimers();
});

describe('the Close Combat panel against a vehicle', () => {
  it('previews the half-squad attack by its CCV, not odds, and shows its roll and result', () => {
    const { engine, state, log } = position();
    const show = (s: GameState, l: LoggedEvent[]) =>
      reactAct(() =>
        root!.render(
          createElement(CloseCombat, {
            env: engine.env(s),
            log: l,
            resolving: false,
            decision: engine.currentDecision(s) ?? undefined,
            owner: engine.currentDecision(s)?.owner,
            waitingOn: undefined,
            sideName: (x?: string) => (x === 'ru' ? 'Russian' : 'German'),
            run: () => null,
            check: () => null,
            plain: (m?: string | null) => m ?? null,
            animate: true,
          }),
        ),
      );
    show(state, log);
    expect(engine.currentDecision(state)).toMatchObject({ kind: 'ccDeclare', owner: 'ge' });
    // The HS drawn up against the tank, as the panel's draft would hold it: the preview is CCV 3.
    const pv = ccAttackPreview(engine.env(state), 'yM5', 'ge', { attackers: ['hs'], targets: ['pziv'] });
    expect(pv.ccv?.value).toBe(3);
    expect(pv.odds).toBeNull();

    // The HS attacks: 3 + 3 = 6 is not under its CCV of 3. The card shows the roll against CCV 3, never an odds column.
    const t = act(engine, state, { type: 'cc.declare', attacks: [{ attackers: ['hs'], targets: ['pziv'] }] });
    show(t.state, [...log, ...(t.events as LoggedEvent[])]);
    reactAct(() => vi.advanceTimersByTime(3000));
    const text = host.textContent ?? '';
    expect(text).toContain('CCV 3');
    expect(text).toContain('No effect');
    expect(text).not.toMatch(/>10-1|10-1/);
  });

  it('keeps the results up for several seconds once the Close Combat is over, and Close dismisses them', () => {
    const { engine, state, log } = position();
    const props = (s: GameState, l: LoggedEvent[]) => ({
      env: engine.env(s),
      log: l,
      resolving: false,
      decision: engine.currentDecision(s) ?? undefined,
      owner: engine.currentDecision(s)?.owner,
      waitingOn: undefined,
      sideName: (x?: string) => (x === 'ru' ? 'Russian' : 'German'),
      run: () => null,
      check: () => null,
      plain: (m?: string | null) => m ?? null,
      animate: true,
    });
    const show = (s: GameState, l: LoggedEvent[]) => reactAct(() => root!.render(createElement(CloseCombat, props(s, l))));
    show(state, log);
    let s = state;
    let l = log;
    for (const a of [
      { type: 'cc.declare', attacks: [{ attackers: ['hs'], targets: ['pziv'] }] },
      { type: 'cc.declare', attacks: [{ attackers: ['pziv'], targets: ['hs'] }] },
    ]) {
      const t = act(engine, s, a);
      s = t.state;
      l = [...l, ...(t.events as LoggedEvent[])];
      show(s, l);
    }
    // Over: both have attacked. The results stay up well past the old 2.6 s.
    expect(host.querySelector('.cc-overlay')).not.toBeNull();
    reactAct(() => vi.advanceTimersByTime(5000));
    expect(host.querySelector('.cc-overlay')).not.toBeNull();
    const close = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Close');
    expect(close).toBeDefined();
    reactAct(() => close!.click());
    reactAct(() => vi.advanceTimersByTime(1000));
    expect(host.querySelector('.cc-overlay')).toBeNull();
  });
});
