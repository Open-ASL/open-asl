// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act as reactAct, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { UNKNOWN_DEF, UNKNOWN_DEF_ID, concealmentModule, redactState, sk2CoreModules, sk3CoreModules } from '@asl/rules';
import { GE_VS_BR, RU_VS_GE, makeEngine } from '../../../packages/rules/test/fixtures';
import type { GameState } from '@asl/engine';
import { DEMO_VEHICLES_SCENARIO, newGame } from '@asl/content';
import { StackPeek } from '../src/board/StackPeek';
import { StackInspector } from '../src/panels/StackInspector';
import { StunCase } from '../src/game/StunCase';

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

describe('a Stunned vehicle in the stack views', () => {
  it('writes a Stun in title case, kept out of the capitals, and a STUN in capitals, in the map card and the tray (SK4 7.10; ASLRB D5.34)', () => {
    const { engine, state: s0 } = newGame(DEMO_VEHICLES_SCENARIO, 'stun', { los: 'grid' });
    const v = Object.values(s0.pieces).find((p) => p.defId === 'am.M4A3')!;
    // [tags, the label in the card and the tray, the words kept out of the capitals]
    const cases = [
      [{ stun: 'fresh' }, 'Stunned', ['Stunned']],
      [{ stun: 'plus1' }, 'Stun +1', ['Stun']],
      [{ stun: 'fresh', stunRecall: true, recall: true }, 'STUNNED', []],
      [{ stun: 'plus1', stunRecall: true, recall: true }, 'STUN +1', []],
    ] as const;
    for (const [tags, label, kept] of cases) {
      const stun = JSON.stringify(tags);
      const state: GameState = { ...s0, pieces: { ...s0.pieces, [v.id]: { ...v, loc: { kind: 'hex', hex: 'yP5' }, tags: { ...v.tags, vca: 0, ca: 0, ...tags } } } };
      const env = engine.env(state);
      const card = renderHost(createElement(StackPeek, { env, hex: 'yP5', at: { x: 10, y: 10 }, bounds: { w: 800, h: 600 } }));
      expect(card.querySelector('.peek-status')?.textContent?.split(' · '), stun).toContain(label);
      expect([...card.querySelectorAll('.peek-status .keep-case')].map((e) => e.textContent), stun).toEqual(kept);
      const tray = renderHost(createElement(StackInspector, { env, hex: 'yP5', selected: new Set(), onToggle: () => {} }));
      expect(tray.querySelector('.tag-stun')?.textContent, stun).toBe(label);
      expect([...tray.querySelectorAll('.tag-stun .keep-case')].map((e) => e.textContent), stun).toEqual(kept);
    }
  });

  it('keeps a title-case Stun out of the capitals inside a longer line, and leaves a STUN alone', () => {
    const words = (text: string) => [...renderHost(createElement(StunCase, { text })).querySelectorAll('.keep-case')].map((e) => e.textContent);
    expect(words('Stun')).toEqual(['Stun']);
    expect(words('Immobilized · Stun · crew Stunned')).toEqual(['Stun', 'Stunned']);
    expect(words('STUN')).toEqual([]);
    expect(words('STUNNED · STUN +1')).toEqual([]);
    expect(words('DESTROYED')).toEqual([]);
    expect(renderHost(createElement(StunCase, { text: 'Immobilized · Stun' })).textContent).toBe('Immobilized · Stun');
  });
});

describe('a concealed enemy stack', () => {
  it('reads as one "?" over the number of counters beneath it, not as a count of "?" counters (SK4 8.3, ASLRB A12.1)', () => {
    const { engine, state } = makeEngine({
      scenario: { ...RU_VS_GE, ssr: [{ module: 'concealment', params: {}, text: 'Concealment' }] },
      extra: [...sk2CoreModules, ...sk3CoreModules, concealmentModule],
      counters: { [UNKNOWN_DEF_ID]: UNKNOWN_DEF },
      terrain: { yK5: { terrain: 'building-stone', buildingId: 'b' } },
      pieces: [
        { id: 'a', def: 'ru.447', side: 'ru', hex: 'yK5', tags: { concealed: true } },
        { id: 'b', def: 'ru.447', side: 'ru', hex: 'yK5', tags: { concealed: true } },
        { id: 'g', def: 'ge.467', side: 'ge', hex: 'yK8' },
      ],
    });
    const env = engine.env(redactState(engine, state, 'ge'));
    const card = render(createElement(StackPeek, { env, hex: 'yK5', at: { x: 10, y: 10 }, bounds: { w: 800, h: 600 } }));
    expect(card).toContain('one "?" over 2 counters');
    // The card's count is the stack's height at the table: the "?" and the two beneath it.
    expect(card).toContain('3 counters');
    expect(card).not.toMatch(/stack of \d+ counter/);
    const tray = render(createElement(StackInspector, { env, hex: 'yK5', selected: new Set(), onToggle: () => {} }));
    expect(tray).toContain('one "?" over 2 counters');
  });
});
