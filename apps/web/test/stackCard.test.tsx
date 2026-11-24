// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { GE_VS_BR, makeEngine } from '../../../packages/rules/test/fixtures';
import { StackPeek } from '../src/board/StackPeek';
import { SettingsPanel } from '../src/settings/SettingsPanel';
import { useStackCard } from '../src/fx/settings';

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
  localStorage.clear();
});

const env = () => {
  const { engine, state } = makeEngine({ scenario: GE_VS_BR, pieces: [{ id: 'a', def: 'ge.467', side: 'ge', hex: 'yK5' }] });
  return engine.env(state);
};
const interactive = (onClose?: () => void) => ({
  selected: new Set<string>(),
  selectable: () => false,
  onToggle: () => {},
  onChitContextMenu: () => {},
  onEnter: () => {},
  onLeave: () => {},
  ...(onClose ? { onClose } : {}),
});

/** Mount a hook in a component of its own; `result()` reads its latest value. */
function renderHook<T>(hook: () => T): { result(): T; unmount(): void } {
  let value: T;
  const el = document.createElement('div');
  const r = createRoot(el);
  const Probe = () => {
    value = hook();
    return null;
  };
  act(() => r.render(createElement(Probe)));
  return { result: () => value, unmount: () => act(() => r.unmount()) };
}

describe('the stack card can be closed', () => {
  it('has a ✕ that closes it, and says Esc closes it', () => {
    let closed = 0;
    act(() => root.render(createElement(StackPeek, { env: env(), hex: 'yK5', at: { x: 10, y: 10 }, bounds: { w: 800, h: 600 }, interactive: interactive(() => closed++) })));
    const x = host.querySelector<HTMLButtonElement>('.stack-peek .peek-close')!;
    expect(x.getAttribute('aria-label')).toBe('Close the stack card');
    act(() => x.click());
    expect(closed).toBe(1);
    expect(host.querySelector('.peek-hint')?.textContent).toContain('Esc closes');
  });

  it('a passive card (no close handler) has no ✕', () => {
    act(() => root.render(createElement(StackPeek, { env: env(), hex: 'yK5', at: { x: 10, y: 10 }, bounds: { w: 800, h: 600 }, interactive: interactive() })));
    expect(host.querySelector('.peek-close')).toBeNull();
  });
});

describe('the stack card on hover is a setting', () => {
  it('is on by default and remembered when switched off', () => {
    const first = renderHook(() => useStackCard());
    expect(first.result()[0]).toBe(true);
    act(() => first.result()[1](false));
    expect(first.result()[0]).toBe(false);
    first.unmount();
    const again = renderHook(() => useStackCard());
    expect(again.result()[0]).toBe(false);
    again.unmount();
  });

  it('the Settings panel offers the switch', () => {
    let set: boolean | null = null;
    act(() =>
      root.render(
        createElement(SettingsPanel, {
          fx: 'full',
          onFx: () => {},
          weatherFx: true,
          onWeatherFx: () => {},
          callStrip: true,
          onCallStrip: () => {},
          stackCard: true,
          onStackCard: (on: boolean) => (set = on),
          onClose: () => {},
        }),
      ),
    );
    act(() => document.querySelector<HTMLButtonElement>('#settings-tab-Visuals')!.click());
    expect(document.querySelector<HTMLElement>('#settings-panel-Visuals')!.hidden).toBe(false);
    const box = document.querySelector<HTMLInputElement>('#settings-panel-Visuals input[aria-label="Stack card on hover"]')!;
    expect(box.checked).toBe(true);
    act(() => box.click());
    expect(set).toBe(false);
  });
});
