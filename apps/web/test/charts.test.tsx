// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ChartsDialog } from '../src/panels/Charts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const press = (key: string) => act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key })));
const cells = (sel: string) => [...host.querySelectorAll(sel)].map((e) => e.textContent?.trim());

describe('chart binder', () => {
  it('draws the IFT from the engine table', () => {
    act(() => root.render(createElement(ChartsDialog, { onClose: () => {} })));
    press('1');
    const firstRow = cells('.ch-ift tbody tr:first-child td');
    expect(firstRow).toEqual(['1KIA', '2KIA', '2KIA', '3KIA', '3KIA', '3KIA', '4KIA', '4KIA', '5KIA', '6KIA', '7KIA']);
  });

  it('reads the Leader Creation bands off the engine table', () => {
    act(() => root.render(createElement(ChartsDialog, { onClose: () => {} })));
    press('3');
    expect(cells('.ch-mini tbody tr').map((t) => t)).toEqual(['≤18-1', '2–38-0', '4–57-0', '66+1', '≥7None']);
  });

  it('opens the To Hit chart on a nationality in play and steps through every section', () => {
    act(() => root.render(createElement(ChartsDialog, { onClose: () => {}, nationalities: ['ge'] })));
    press('6');
    expect(host.querySelector('.ch-seg button.on')?.textContent).toBe('German');
    expect(cells('.ch-th tbody th.gun')).toContain('88LL');
    for (let i = 1; i <= 9; i++) {
      press(String(i));
      expect(host.querySelector('.ch-tab.on .ch-tab-n')?.textContent).toBe(String(i));
      expect(host.querySelector('.ch-page-body')?.textContent?.length).toBeGreaterThan(100);
    }
    press('ArrowRight');
    expect(host.querySelector('.ch-tab.on .ch-tab-n')?.textContent).toBe('9');
  });

  it('draws the Vehicle Target Type and AP To Kill rows from the engine tables', () => {
    act(() => root.render(createElement(ChartsDialog, { onClose: () => {}, nationalities: ['ru', 'ge'] })));
    press('7');
    expect(host.querySelector('.ch-seg button.on')?.textContent).toBe('Russian');
    const row = [...host.querySelectorAll('.ch-vtt tbody tr')].find((tr) => tr.querySelector('th')?.textContent === '76L');
    expect([...row!.querySelectorAll('td')].map((td) => td.textContent)).toEqual(['10', '8', '8', '7']);
    const tk = [...host.querySelectorAll('.ch-tk tbody tr')].find((tr) => tr.querySelector('th')?.textContent === '76L (Russian)');
    expect([...tk!.querySelectorAll('td')].map((td) => td.textContent)).toEqual(['14(17)', '13(16)', '13(15)', '13(14)', '13(13)', '12(11)']);
  });
});
