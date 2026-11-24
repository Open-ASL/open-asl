// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act as reactAct, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Action, Ctx, RuleModule, SideId } from '@asl/engine';
import { FP, concealmentModule, sk2CoreModules, sk3CoreModules, type FireDeclaration, type FireMode, type ResolveFireFn } from '@asl/rules';
import { RU_VS_GE, act, makeEngine } from '../../../packages/rules/test/fixtures';
import { describeEvents, phaseSections } from '../src/game/describe';
import { LogSections } from '../src/game/LogEntries';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const testFire: RuleModule = {
  id: 'test.fire',
  install(r) {
    r.action<Action & { decl: FireDeclaration; mode: FireMode }>({
      type: 'test.fire',
      decisionKinds: ['phase'],
      validate: (env, a) => env.query('fire.illegal', { decl: a.decl, mode: a.mode, side: a.side }, null),
      resolve(ctx: Ctx, a) {
        ctx.proc<ResolveFireFn>(FP.resolve)(ctx, a.decl, a.mode);
      },
    });
  },
};

/** A Russian 4-4-7 Prep Fires at a German 4-6-7 in a stone building, two hexes off. */
function shot(opts: { concealed?: boolean; dice?: number[] } = {}) {
  const { engine, state } = makeEngine({
    scenario: { ...RU_VS_GE, firstSide: 'ru', ...(opts.concealed ? { ssr: [{ module: 'concealment', params: {}, text: 'Concealment (SK4 8.3)' }] } : {}) },
    extra: [...sk2CoreModules, ...sk3CoreModules, ...(opts.concealed ? [concealmentModule] : []), testFire],
    terrain: { yK5: { terrain: 'building-stone', buildingId: 'b' } },
    startPhase: 'PFPh',
    pieces: [
      { id: 'r', def: 'ru.447', side: 'ru', hex: 'yK7' },
      { id: 'g', def: 'ge.467', side: 'ge', hex: 'yK5', ...(opts.concealed ? { tags: { concealed: true } } : {}) },
    ],
    dice: opts.dice ?? [1, 1, 3, 3],
  });
  const t = act(engine, state, { type: 'test.fire', decl: { units: ['r'], sw: [], target: 'yK5' }, mode: 'prep' });
  return { env: engine.env(t.state), events: t.events };
}

describe('log lines carry their nationality and every modifier', () => {
  it('marks a shot with its firer and its results with the target, and labels the DRM every target shares', () => {
    const { env, events } = shot({ dice: [2, 1, 3, 3] });
    const [fire, result, check] = describeEvents(env, events);
    expect(fire).toMatchObject({ kind: 'fire', nation: 'ru', title: 'Russian 4-4-7 → K5 · Prep Fire' });
    // "+3" alone read as the target's final DRM; it is the shared one (a target's own DRM is on its result).
    expect(fire!.text).toMatch(/, DR 1\+2=3, DRM \+3$/);
    expect(fire!.rows).toEqual([
      { k: 'Strength', v: '4 FP → 4 column', mods: [] },
      { k: 'Roll', v: 'DR 1+2=3' },
      { k: 'DRM, all', v: '+3', mods: ['+3 TEM (Stone Building)'] },
    ]);
    expect(result).toMatchObject({ nation: 'ge', rows: [{ k: 'Result', v: 'German 4¹-6-7: final DR 6', out: 'PTC' }] });
    expect(check).toMatchObject({ kind: 'check', nation: 'ge', rows: [{ k: 'PTC', v: 'German 4¹-6-7 (IFT PTC): DR 3+3=6 → 6 vs 7', out: 'passed' }] });
  });

  it('a concealed enemy is its side\'s emblem and its result names nothing of it (SK4 8.3)', () => {
    const { env, events } = shot({ concealed: true, dice: [6, 5] });
    const lines = describeEvents(env, events, 'ru');
    const hit = lines.find((l) => l.text.includes('? (concealed)'))!;
    expect(hit.nation).toBe('ge');
    expect(JSON.stringify(lines)).not.toMatch(/German 4/);
  });

  it('a phase heading carries the emblem of the side whose phase it is', () => {
    const { env } = shot();
    const [head] = describeEvents(env, [{ seq: 1, type: 'turn.phaseStarted', payload: { phase: 'DFPh', turn: 2, attacker: 'ru' } }] as never);
    expect(head!.nation).toBe('ge');
  });
});

describe('the log panel', () => {
  let host: HTMLDivElement;
  let root: Root;
  afterEach(() => reactAct(() => root.unmount()));

  function mount(viewer: SideId | null = null) {
    const { env, events } = shot({ dice: [2, 1, 3, 3] });
    const sections = phaseSections(describeEvents(env, events, viewer));
    let los: number | null = null;
    host = document.createElement('div');
    root = createRoot(host);
    const render = () =>
      reactAct(() =>
        root.render(createElement(LogSections, { sections, sideName: (s: string) => s, losReview: los, onLosReview: (v: number | null) => { los = v; render(); } })),
      );
    render();
    return { los: () => los, entry: () => host.querySelector('li.log-entry') as HTMLLIElement };
  }

  it('shows a shot as its lines, each with its nationality\'s emblem, the results indented under it', () => {
    const { entry } = mount();
    const lines = [...entry().querySelectorAll('.log-line')];
    expect(lines.map((l) => l.querySelector('.log-nat')!.getAttribute('aria-label'))).toEqual(['Russian', 'German', 'German']);
    expect(lines.map((l) => l.classList.contains('cont'))).toEqual([false, true, true]);
    expect(entry().querySelector('.log-card')).toBeNull();
  });

  it('opens a clicked shot into every figure behind it, with its LOS on the map, and folds it back', () => {
    const { entry, los } = mount();
    reactAct(() => entry().click());
    const card = entry().querySelector('.log-card')!;
    expect(card.querySelector('.log-card-title')!.textContent).toContain('Russian 4-4-7 → K5 · Prep Fire');
    expect([...card.querySelectorAll('.log-k')].map((k) => k.textContent)).toEqual(['Strength', 'Roll', 'DRM, all', 'Result', 'PTC']);
    expect([...card.querySelectorAll('.log-mod')].map((m) => m.textContent)).toEqual(['+3 TEM (Stone Building)']);
    expect([...card.querySelectorAll('.log-out')].map((m) => m.textContent)).toEqual(['PTC', 'passed']);
    expect(los()).toBe(9);
    // Clicking inside the open card (to read or select it) leaves it open; its heading folds it.
    reactAct(() => (card.querySelector('.log-row') as HTMLElement).click());
    expect(entry().querySelector('.log-card')).not.toBeNull();
    reactAct(() => (entry().querySelector('.log-card-title') as HTMLButtonElement).click());
    expect(entry().querySelector('.log-card')).toBeNull();
    expect(los()).toBeNull();
  });
});
