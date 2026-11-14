// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ErrorBoundary } from '../src/ui/ErrorBoundary';
import { installErrorLog, recentErrors, recordError } from '../src/diagnostics/errorLog';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  // React reports a caught render error on the console too; keep the test output quiet.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  act(() => root?.unmount());
  host.remove();
  vi.restoreAllMocks();
});

let broken = true;
function Fragile() {
  if (broken) throw new Error('cannot read the stack');
  return createElement('span', null, 'drawn');
}

describe('ErrorBoundary', () => {
  it('a render error shows what broke with Try again and Reload, and is recorded for bug reports', () => {
    broken = true;
    act(() => root!.render(createElement('div', null, createElement('p', null, 'the board'), createElement(ErrorBoundary, { what: 'the top bar', inline: true }, createElement(Fragile)))));
    // The rest of the screen stays.
    expect(host.textContent).toContain('the board');
    expect(host.querySelector('[role=alert]')!.textContent).toContain('Something went wrong in the top bar.');
    expect(host.textContent).toContain('cannot read the stack');
    expect([...host.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Try again', 'Reload']);
    const last = recentErrors().at(-1)!;
    expect(last.kind).toBe('boundary');
    expect(last.text).toContain('the top bar: Error: cannot read the stack');
  });

  it('Try again draws the part again once it no longer fails', () => {
    broken = true;
    act(() => root!.render(createElement(ErrorBoundary, { what: 'the game screen' }, createElement(Fragile))));
    broken = false;
    act(() => host.querySelector('button')!.click());
    expect(host.textContent).toBe('drawn');
  });

  it('children that do not fail are drawn as they are', () => {
    function Counter() {
      const [n] = useState(3);
      return createElement('b', null, `n=${n}`);
    }
    act(() => root!.render(createElement(ErrorBoundary, { what: 'x' }, createElement(Counter))));
    expect(host.innerHTML).toBe('<b>n=3</b>');
  });
});

describe('error log', () => {
  it('keeps the last 30 errors, each cut to 500 characters', () => {
    for (let i = 0; i < 40; i++) recordError('console', `e${i}`, 'x'.repeat(600));
    const all = recentErrors();
    expect(all).toHaveLength(30);
    expect(all[0]!.text.startsWith('e10 ')).toBe(true);
    expect(all.at(-1)!.text).toHaveLength(500);
  });

  it('records console.error and uncaught errors once installed', () => {
    vi.restoreAllMocks();
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    installErrorLog();
    console.error('computer: rules refused', { type: 'endPhase' });
    expect(recentErrors().at(-1)).toMatchObject({ kind: 'console', text: 'computer: rules refused {"type":"endPhase"}' });
    window.dispatchEvent(new ErrorEvent('error', { error: new TypeError('x is undefined'), message: 'x is undefined' }));
    expect(recentErrors().at(-1)).toMatchObject({ kind: 'exception' });
    expect(recentErrors().at(-1)!.text).toContain('TypeError: x is undefined');
    quiet.mockRestore();
  });
});
