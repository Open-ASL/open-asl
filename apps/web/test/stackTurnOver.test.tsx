// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { sk2CoreModules, sk3CoreModules } from '@asl/rules';
import { COUNTERS as CARDBOARD } from '@asl/content';
import { COUNTERS, GE_VS_BR, makeEngine } from '../../../packages/rules/test/fixtures';
import { StackInspector } from '../src/panels/StackInspector';

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

// The Panzerschreck as printed, with its To Hit Table on the back.
COUNTERS['ge.PSK'] = CARDBOARD['ge.PSK']!;
const { engine, state } = makeEngine({
  scenario: GE_VS_BR,
  extra: [...sk2CoreModules, ...sk3CoreModules],
  pieces: [
    { id: 'sq', def: 'ge.467', side: 'ge', hex: 'yK5' },
    { id: 'lmg', def: 'ge.LMG', side: 'ge', heldBy: 'sq' },
    { id: 'psk', def: 'ge.PSK', side: 'ge', heldBy: 'sq' },
    { id: 'bk', def: 'ge.467', side: 'ge', hex: 'yK6', tags: { broken: true } },
    { id: 'tank', def: 'ge.pzivf2', side: 'ge', hex: 'yM5', tags: { vca: 0, ca: 0 } },
    // A counter printed on one side only: nothing to turn over to.
    { id: 'ja', def: 'ja.447', side: 'br', hex: 'yO5' },
  ],
});
const env = engine.env(state);
const before = JSON.stringify(state);

function show(hex: string, onToggle = () => {}) {
  act(() => root.render(createElement(StackInspector, { env, hex, selected: new Set(), onToggle, actingSide: 'ge' })));
}
/** The row of a counter, by the art it shows (front or back). */
const rows = () => [...host.querySelectorAll('li.piece')];
const art = (li: Element) => li.querySelector('img')?.getAttribute('src') ?? '';
const rowOf = (name: RegExp) => rows().find((li) => name.test(li.querySelector('.pname')?.textContent ?? ''))!;
const turnOver = (li: Element) => act(() => (li.querySelector('button.turn-over') as HTMLButtonElement).click());

describe('turning a counter over in the stack card', () => {
  it('a squad, its SW and its LATW each show their back and turn back again, without ticking the unit', () => {
    const onToggle = vi.fn();
    show('yK5', onToggle);
    for (const [name, front, back] of [
      [/-6-7/, 'ge467S.webp', 'ges7b.webp'],
      [/LMG/, 'geLMG.webp', 'geLMGb.webp'],
      [/PSK/, 'gePSK.webp', 'gePSKb.webp'],
    ] as const) {
      expect(art(rowOf(name))).toMatch(front);
      turnOver(rowOf(name));
      expect(art(rowOf(name))).toMatch(back);
      expect(rowOf(name).querySelector('button.turn-over')!.getAttribute('aria-pressed')).toBe('true');
      turnOver(rowOf(name));
      expect(art(rowOf(name))).toMatch(front);
    }
    expect(onToggle).not.toHaveBeenCalled();
    // A view only: the game state is untouched.
    expect(JSON.stringify(state)).toBe(before);
  });

  it('turning several counters over at once keeps each of them turned', () => {
    show('yK5');
    act(() => host.querySelectorAll<HTMLButtonElement>('button.turn-over').forEach((b) => b.click()));
    expect([...host.querySelectorAll('li.piece img')].map((i) => i.getAttribute('src'))).toEqual(expect.arrayContaining([expect.stringMatching('ges7b.webp'), expect.stringMatching('geLMGb.webp'), expect.stringMatching('gePSKb.webp')]));
  });

  it('a counter already on its back (a broken squad) turns over to its front', () => {
    show('yK6');
    expect(art(rowOf(/-6-7/))).toMatch('ges7b.webp');
    expect(rowOf(/-6-7/).querySelector('button.turn-over')!.getAttribute('title')).toBe('Show the front of the counter');
    turnOver(rowOf(/-6-7/));
    expect(art(rowOf(/-6-7/))).toMatch('ge467S.webp');
  });

  it('a vehicle turns over to its wreck side', () => {
    show('yM5');
    const tank = rows()[0]!;
    expect(art(tank)).toMatch('pzivf2.webp');
    turnOver(tank);
    expect(art(rows()[0]!)).toMatch('pzivf2b.webp');
  });

  it('a counter with no back art offers no turn-over', () => {
    show('yO5');
    expect(rows()).toHaveLength(1);
    expect(rows()[0]!.querySelector('button.turn-over')).toBeNull();
    expect(rows()[0]!.querySelector('img')).not.toBeNull();
  });

  it('is forgotten when the card moves to another hex', () => {
    show('yK5');
    turnOver(rowOf(/-6-7/));
    expect(art(rowOf(/-6-7/))).toMatch('ges7b.webp');
    show('yK6');
    show('yK5');
    expect(art(rowOf(/-6-7/))).toMatch('ge467S.webp');
  });

  it("a LATW's row reads out its To Hit Table by range, and its counter notes on hover (SK4 4.4)", () => {
    show('yK5');
    const psk = rowOf(/PSK/);
    expect(psk.textContent).toContain('TH 11/9/8/7/4 at range 0–4');
    expect(psk.querySelector('.pname')!.getAttribute('title')).toMatch(/^PSK To Hit Table 0:11 1:9 2:8 3:7 4:4 · a hit on Infantry in a building on the 12 FP column/);
  });
});
