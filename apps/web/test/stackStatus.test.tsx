// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act as reactAct, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { sk2CoreModules } from '@asl/rules';
import { GE_VS_BR, makeEngine } from '../../../packages/rules/test/fixtures';
import { StackPeek } from '../src/board/StackPeek';
import { StackInspector } from '../src/panels/StackInspector';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function render(el: ReturnType<typeof createElement>): string {
  const host = document.createElement('div');
  const root = createRoot(host);
  reactAct(() => root.render(el));
  const text = host.textContent ?? '';
  reactAct(() => root.unmount());
  return text;
}

describe('Gun status in the stack views', () => {
  it('shows the limited ammo a Gun has run out of (SK4 6.2) in the tray and the map card', () => {
    const { engine, state } = makeEngine({
      scenario: GE_VS_BR,
      extra: sk2CoreModules,
      pieces: [
        { id: 'c1', def: 'ge.228c', side: 'ge', hex: 'yK5' },
        { id: 'g75', def: 'ge.AT75L', side: 'ge', heldBy: 'c1', tags: { ca: 0, ammoOut: 'HEAT,APCR' } },
      ],
    });
    const env = engine.env(state);
    const tray = render(createElement(StackInspector, { env, hex: 'yK5', selected: new Set(), onToggle: () => {} }));
    expect(tray).toContain('Out of HEAT, APCR');
    const card = render(createElement(StackPeek, { env, hex: 'yK5', at: { x: 10, y: 10 }, bounds: { w: 800, h: 600 } }));
    expect(card).toContain('out of HEAT, APCR');
  });
});
