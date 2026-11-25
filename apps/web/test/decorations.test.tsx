// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act as reactAct, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { scenarioById } from '@asl/content';
import { MEDALS, emptyServiceRecord, recordResult, type AwardedMedal, type MedalId, type ServiceRecord } from '@asl/platform';
import { Decorations } from '../src/profile/decorations/Decorations';
import { DecorationHints } from '../src/profile/decorations/DecorationHints';
import { GameOver } from '../src/fx/Overlays';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
function mount(el: ReactElement): HTMLDivElement {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  reactAct(() => root!.render(createElement(MemoryRouter, null, el)));
  return host;
}
afterEach(() => {
  reactAct(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const awarded = (id: string, day: string, level?: number): AwardedMedal => ({ id: id as MedalId, awardedAt: new Date(day), ...(level ? { level, levelAt: new Date(day) } : {}) });
const name = (id: MedalId) => MEDALS.find((m) => m.id === id)!.name;
const wins = (n: number, scenarioId: string, side: string, pool: 'human' | 'bot' = 'human'): ServiceRecord =>
  Array.from({ length: n }).reduce<ServiceRecord>((r) => recordResult(r, { pool, scenarioId, side, outcome: 'win', reason: 'scenario end', opponentBalance: false }), emptyServiceRecord());

describe('the decorations on a service record', () => {
  it('shows the supreme decorations as medals and wears the rest as ribbons, in precedence, the short row on top', () => {
    const medals = [awarded('us-good-conduct', '2027-01-01'), awarded('us-medal-of-honor', '2027-03-01'), awarded('us-bronze-star', '2027-01-02'), awarded('de-iron-cross-2nd-class', '2027-01-03'), awarded('us-purple-heart', '2027-01-04'), awarded('uk-italy-star', '2027-01-05'), awarded('beta-service', '2026-11-01')];
    const el = mount(createElement(Decorations, { medals, base: '/profile/x', own: null }));
    expect([...el.querySelectorAll('.decor-supreme img')].map((i) => i.getAttribute('alt'))).toEqual(['Medal of Honor']);
    const rows = [...el.querySelectorAll('.rack-row')].map((row) => [...row.querySelectorAll('.ribbon-btn')].map((b) => b.getAttribute('title')));
    expect(rows).toEqual([
      [name('us-bronze-star'), name('de-iron-cross-2nd-class')],
      [name('us-purple-heart'), name('uk-italy-star'), name('us-good-conduct'), name('beta-service')],
    ]);
    expect(el.textContent).toContain('6 of 50 decorations earned');
  });

  it('does not wear a retired decoration still on the record', () => {
    const el = mount(createElement(Decorations, { medals: [awarded('cib', '2026-09-01'), awarded('beta-service', '2026-10-01')], base: '/profile/x', own: null }));
    expect([...el.querySelectorAll('.ribbon-btn')].map((b) => b.getAttribute('title'))).toEqual(['Beta Service Ribbon']);
  });

  it('puts a bronze star on the ribbon for each further award, a silver star for five', () => {
    const el = mount(createElement(Decorations, { medals: [awarded('us-bronze-star', '2027-01-01', 3), awarded('de-iron-cross-2nd-class', '2027-01-01', 7)], base: '/profile/x', own: null }));
    const [bronze, iron] = [...el.querySelectorAll('.ribbon-btn')];
    expect([...bronze!.querySelectorAll('.device')].map((d) => d.className)).toEqual(['device star bronze', 'device star bronze']);
    expect([...iron!.querySelectorAll('.device')].map((d) => d.className)).toEqual(['device star silver', 'device star bronze']);
  });

  it('opens the citation with its date and a link to the details', () => {
    const el = mount(createElement(Decorations, { medals: [awarded('us-bronze-star', '2027-01-28T12:00:00')], base: '/profile/x', own: null }));
    reactAct(() => (el.querySelector('.ribbon-btn') as HTMLButtonElement).click());
    const text = document.body.textContent ?? '';
    expect(text).toContain('15 wins against players as the Americans');
    expect(text).toContain('First awarded January 28, 2027');
    expect(document.body.querySelector('a[href="/profile/x/decorations/us-bronze-star"]')).not.toBeNull();
  });

  it('on your own record, names the decorations closest to coming next', () => {
    const el = mount(createElement(Decorations, { medals: [], base: '/profile/x', own: { service: wins(18, 'sk-s7', 'ge'), betaScenarios: [] } }));
    const closest = [...el.querySelectorAll('.decor-closest-card b')].map((b) => b.textContent);
    expect(closest[0]).toBe(name('de-iron-cross-2nd-class'));
    expect(el.querySelector('a[href="/profile/x/decorations/de-iron-cross-2nd-class"]')).not.toBeNull();
  });

  it('says how they are earned when there are none yet', () => {
    const el = mount(createElement(Decorations, { medals: [], base: '/profile/x', own: null }));
    expect(el.textContent).toContain('No decorations yet');
  });
});

describe('the deploy desk’s decoration hints', () => {
  const s7 = scenarioById('sk-s7')!;
  it('lists what a German win would move, and marks what it would earn', () => {
    const el = mount(createElement(DecorationHints, { user: { service: wins(19, 'sk-s7', 'ge') }, scenario: s7, side: 'ge', sideName: 'German', pool: 'human', profileBase: '/profile/x' }));
    expect(el.textContent).toContain('A win as the German counts toward');
    const earns = [...el.querySelectorAll('li.earns b')].map((b) => b.textContent);
    expect(earns).toContain(name('de-iron-cross-2nd-class'));
  });
  it('against the computer opponent, only its decorations', () => {
    const el = mount(createElement(DecorationHints, { user: { service: emptyServiceRecord() }, scenario: s7, side: 'am', sideName: 'American', pool: 'bot', profileBase: null }));
    const listed = [...el.querySelectorAll('li b')].map((b) => MEDALS.find((m) => m.name === b.textContent)!.pool);
    expect(listed.length).toBeGreaterThan(0);
    expect(new Set(listed)).toEqual(new Set(['bot']));
  });
});

describe('the result screen', () => {
  it('names the decorations a match earned and those it moved closer', () => {
    const el = mount(createElement(GameOver, {
      winner: 'ge', reason: 'scenario end', sideName: (s: string) => s, onLobby: () => {}, onReview: () => {},
      awards: { earned: [{ id: 'de-iron-cross-2nd-class', level: 2 }], advanced: [{ id: 'de-knights-cross', value: 21, goal: 40 }] },
    }));
    expect(el.querySelector('.gameover-earned')!.textContent).toBe(`Further award${name('de-iron-cross-2nd-class')}`);
    expect(el.querySelector('.gameover-advanced')!.textContent).toContain(`${name('de-knights-cross')}21 / 40`);
  });
});
