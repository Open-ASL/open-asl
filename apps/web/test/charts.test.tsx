// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ChartsDialog, ChartsWindow } from '../src/panels/Charts';

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

  it('draws the Close Combat and Hand-to-Hand Kill # rows from the engine tables: Hand-to-Hand two higher in every column (SK4 8.1.8.4)', () => {
    act(() => root.render(createElement(ChartsDialog, { onClose: () => {} })));
    press('2');
    const tables = [...host.querySelectorAll('.ch-cct')];
    expect(tables).toHaveLength(2);
    const kills = (t: Element) => [...t.querySelectorAll('tr.kill td')].map((e) => Number(e.textContent));
    const [cc, hth] = tables.map(kills);
    expect(cc!.length).toBeGreaterThan(5);
    expect(hth).toEqual(cc!.map((k) => k + 2));
    expect(host.textContent).toContain('Hand-to-Hand CC Table');
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

  it("lists every LATW's own To Hit Table from the counter data, as printed on the counter backs (SK4 4.4)", () => {
    act(() => root.render(createElement(ChartsDialog, { onClose: () => {} })));
    press('6');
    const rows = [...host.querySelectorAll('.ch-latw tbody tr')].map((tr) => [tr.querySelector('th')!.textContent!.trim(), ...[...tr.querySelectorAll('td')].map((td) => td.textContent)]);
    const row = (name: RegExp) => rows.find((r) => name.test(r[0]!))!.slice(1);
    // Range 0–5, FP column, removal, HEAT TK, Backblast.
    expect(rows).toHaveLength(6);
    expect(row(/BAZ ?43/)).toEqual(['11', '9', '8', '7', '4', '–', '8', 'X10', '13', '+2 or 1 FP']);
    expect(row(/BAZ ?44/)).toEqual(['11', '9', '8', '7', '4', '–', '8', 'X11', '16', '+2 or 1 FP']);
    expect(row(/BAZ ?45/)).toEqual(['11', '10', '9', '8', '6', '4', '8', 'X11', '16', '+2 or 1 FP']);
    expect(row(/PSK/)).toEqual(['11', '9', '8', '7', '4', '–', '12', 'X10', '26', '+2 or 1 FP']);
    expect(row(/PIAT/)).toEqual(['11', '9', '7', '5', '–', '–', '8', 'B10', '15', 'none']);
    expect(row(/PF/)).toEqual(['10', '8', '6', '4', '–', '–', '16', 'one shot', '31', '+2 or 1 FP']);
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

describe('charts in a window of their own', () => {
  it('the dialog pops out into the /charts window with the nationalities in play, and closes itself', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    let closed = 0;
    act(() => root.render(createElement(ChartsDialog, { onClose: () => closed++, nationalities: ['ge', 'ru'] })));
    const pop = host.querySelector<HTMLButtonElement>('.ch-popout')!;
    expect(pop.textContent).toContain('Pop out');
    act(() => pop.click());
    expect(open).toHaveBeenCalledWith('/charts?n=ge%2Cru', 'open-asl-charts', expect.stringContaining('popup'));
    expect(closed).toBe(1);
    open.mockRestore();
  });

  it('the window fills its page, offers no second pop-out, opens on a nationality in play and still steps through every section', () => {
    window.history.replaceState(null, '', '/charts?n=ru');
    act(() => root.render(createElement(ChartsWindow)));
    expect(host.querySelector('.set-panel.charts.windowed')).not.toBeNull();
    expect(host.querySelector('.ch-popout')).toBeNull();
    expect(document.title).toBe('Charts · Open ASL');
    press('6');
    expect(host.querySelector('.ch-page-head .modal-title')!.textContent).toBe('Guns');
    expect(host.querySelector('.ch-seg button.on')?.textContent).toBe('Russian');
    press('8');
    expect(host.querySelector('.afv-diagram image.afv-tank')?.getAttribute('href')).toBe('/charts/afv-tank.webp');
    window.history.replaceState(null, '', '/');
  });
});
