// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LogText } from '../src/game/LogText';

const render = (text: string) => {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(createElement(LogText, { text }));
  const dice = [...host.querySelectorAll('.die')].map((d) => `${d.classList.contains('colored') ? 'c' : 'w'}${d.getAttribute('aria-label')}`);
  return { dice, text: host.textContent };
};

describe('LogText', () => {
  it('draws a DR as the colored die then the white one, keeping the total', () => {
    const r = render('Prep Fire on P5: 19 FP → 16 column, DR 2+4=6 +4');
    expect(r.dice).toEqual(['c2', 'w4']);
    expect(r.text).toBe('Prep Fire on P5: 19 FP → 16 column, DR =6 +4');
  });

  it('draws a dr as a white die, and the colored one when the line says so', () => {
    expect(render('Leader Creation for German 4-6-7: dr 6 — no leader').dice).toEqual(['w6']);
    expect(render('MMG keeps ROF (colored dr 2 ≤ 2): it may fire again this phase').dice).toEqual(['c2']);
    expect(render('SSR 1: Group A stack — colored 3 (south), white 4 → K5').dice).toEqual(['c3', 'w4']);
    expect(render('CC: German 4-6-7 vs T-34: CCV 7, DR 1+2=3, third die 5 → no effect').dice).toEqual(['c1', 'w2', 'w5']);
  });

  it('leaves totals that are not rolls alone', () => {
    expect(render('German 4-6-7: NMC (final DR 10)').dice).toEqual([]);
    expect(render('Weather DR 9: no change').dice).toEqual([]);
  });
});
