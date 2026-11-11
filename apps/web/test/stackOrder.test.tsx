// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act as reactAct, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { GE_VS_BR, makeEngine } from '../../../packages/rules/test/fixtures';
import { StackPeek } from '../src/board/StackPeek';
import { StackInspector } from '../src/panels/StackInspector';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The names of the counters a view lists, in the order it lists them. */
function rows(el: ReturnType<typeof createElement>, sel: string): string[] {
  const host = document.createElement('div');
  const root = createRoot(host);
  reactAct(() => root.render(el));
  const out = [...host.querySelectorAll(sel)].map((e) => e.textContent ?? '');
  reactAct(() => root.unmount());
  return out;
}

/*
 * SW were once listed under the unit carrying them. A SW belongs to the unit beneath it
 * (ASLRB A4.43), so every view of a stack reads from the top down with each SW above its holder.
 */
describe('stack views list a SW above the unit carrying it', () => {
  const { engine, state } = makeEngine({
    scenario: GE_VS_BR,
    pieces: [
      { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yK5' },
      { id: 'lmg', def: 'ge.LMG', side: 'ge', heldBy: 'g1' },
      { id: 'g2', def: 'ge.467', side: 'ge', hex: 'yK5' },
      { id: 'mmg', def: 'ge.MMG', side: 'ge', heldBy: 'g2' },
    ],
  });
  const env = engine.env(state);
  const order = (names: string[]) => names.map((n) => (/LMG/.test(n) ? 'LMG' : /MMG/.test(n) ? 'MMG' : /-6-7/.test(n) ? '467' : '?'));

  it('in the Stack panel', () => {
    const list = order(rows(createElement(StackInspector, { env, hex: 'yK5', selected: new Set(), onToggle: () => {} }), '.pieces > li'));
    expect(list).toHaveLength(4);
    for (const sw of ['LMG', 'MMG']) expect(list[list.indexOf(sw) + 1]).toBe('467');
    expect(list[list.length - 1]).toBe('467');
  });

  it('in the hover card', () => {
    const list = order(rows(createElement(StackPeek, { env, hex: 'yK5', at: { x: 10, y: 10 }, bounds: { w: 800, h: 600 } }), '.peek-row'));
    expect(list).toHaveLength(4);
    for (const sw of ['LMG', 'MMG']) expect(list[list.indexOf(sw) + 1]).toBe('467');
    expect(list[list.length - 1]).toBe('467');
  });
});
