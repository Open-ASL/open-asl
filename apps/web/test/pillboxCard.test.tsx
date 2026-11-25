// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act as reactAct, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { GameState } from '@asl/engine';
import { aslCoreModules, piecesModule, redactState, sk2CoreModules, sk3CoreModules, turnModule } from '@asl/rules';
import { sk1CoreModules } from '../../../packages/rules/src/sk1';
import { makeEngine } from '../../../packages/rules/test/fixtures';
import { StackPeek } from '../src/board/StackPeek';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function render(el: ReturnType<typeof createElement>): string {
  const host = document.createElement('div');
  const root = createRoot(host);
  reactAct(() => root.render(el));
  const text = host.textContent ?? '';
  reactAct(() => root.unmount());
  return text;
}

/*
 * The stack card of a pillbox hex (full ASL, ASLRB B30.7, B30.8, B30.91, A26.132): the other side reads that the pillbox is
 * occupied, its contents not inspectable, and who Controls it; the owner sees his units inside.
 */
describe('the pillbox on the stack card', () => {
  function game() {
    const scenario = {
      firstSide: 'ge',
      sides: [
        { side: 'ge', name: 'German', nationality: 'ge', elr: 3 },
        { side: 'ru', name: 'Russian', nationality: 'ru', elr: 3 },
      ],
      forces: [],
    };
    const { engine, state } = makeEngine({
      board: 'u',
      scenario,
      modules: [piecesModule, turnModule, ...sk1CoreModules, ...sk2CoreModules, ...sk3CoreModules, ...aslCoreModules],
      pieces: [
        { id: 'r', def: 'ru.447', side: 'ru', hex: 'uO5' },
        { id: 'g', def: 'ge.467', side: 'ge', hex: 'uY9' },
      ],
    });
    const pb = { id: 'ru.fort1', side: 'ru', kind: 'pillbox', hex: 'uO5', hidden: false, ca: 0, pillbox: { capacity: 1, ca: 3, nca: 5 } };
    const s: GameState = {
      ...state,
      pieces: { ...state.pieces, r: { ...state.pieces['r']!, loc: { kind: 'hex', hex: 'uO5', sub: 'pb' } } },
      ext: { ...state.ext, 'asl.fortifications': { counters: [pb] }, 'sk1.control': { hexes: {}, buildings: {}, locations: { 'uO5:pb': 'ru' } } },
    };
    return { engine, s };
  }

  it("the other seat reads 'occupied: contents not inspectable' and who Controls it, not the units inside", () => {
    const { engine, s } = game();
    const theirs = redactState(engine, s, 'ge');
    const card = render(createElement(StackPeek, { env: engine.env(theirs), hex: 'uO5', at: { x: 10, y: 10 }, bounds: { w: 800, h: 600 } }));
    expect(card).toContain('occupied: contents not inspectable (ASLRB B30.7)');
    expect(card).toContain('Pillbox: Controlled by Russian');
    expect(card).not.toContain('4-4-7');
  });

  it('the owner sees his squad inside, under its own heading, and no occupied note', () => {
    const { engine, s } = game();
    const own = redactState(engine, s, 'ru');
    const card = render(createElement(StackPeek, { env: engine.env(own), hex: 'uO5', at: { x: 10, y: 10 }, bounds: { w: 800, h: 600 } }));
    expect(card).toContain('Pillbox');
    expect(card).not.toContain('occupied');
  });
});
