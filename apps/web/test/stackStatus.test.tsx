// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act as reactAct, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { sk2CoreModules } from '@asl/rules';
import { GE_VS_BR, makeEngine } from '../../../packages/rules/test/fixtures';
import type { GameState } from '@asl/engine';
import { DEMO_VEHICLES_SCENARIO, newGame } from '@asl/content';
import { StackPeek } from '../src/board/StackPeek';
import { StackInspector } from '../src/panels/StackInspector';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The rendered element's root, for a test that looks at markup rather than text. */
function renderHost(el: ReturnType<typeof createElement>): HTMLElement {
  const host = document.createElement('div');
  const root = createRoot(host);
  reactAct(() => root.render(el));
  return host;
}

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

describe('a stunned vehicle in the stack views', () => {
  it('writes a stun in lowercase, kept out of the capitals, in the map card and the tray: a stun is not a STUN (SK4 7.7; ASLRB D5.34)', () => {
    const { engine, state: s0 } = newGame(DEMO_VEHICLES_SCENARIO, 'stun', { los: 'grid' });
    const v = Object.values(s0.pieces).find((p) => p.defId === 'am.M4A3')!;
    for (const [stun, label] of [['fresh', 'stunned'], ['plus1', 'stun +1']] as const) {
      const state: GameState = { ...s0, pieces: { ...s0.pieces, [v.id]: { ...v, loc: { kind: 'hex', hex: 'yP5' }, tags: { ...v.tags, vca: 0, ca: 0, stun } } } };
      const env = engine.env(state);
      const card = renderHost(createElement(StackPeek, { env, hex: 'yP5', at: { x: 10, y: 10 }, bounds: { w: 800, h: 600 } }));
      expect([...card.querySelectorAll('.peek-status .keep-case')].map((e) => e.textContent), stun).toEqual([label]);
      const tray = renderHost(createElement(StackInspector, { env, hex: 'yP5', selected: new Set(), onToggle: () => {} }));
      expect(tray.querySelector('.tag-stun')?.textContent, stun).toBe(stun === 'fresh' ? 'stunned' : 'stunned (+1)');
    }
  });
});
