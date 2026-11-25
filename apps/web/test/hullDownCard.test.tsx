// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act as reactAct, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { GameState } from '@asl/engine';
import { aslCoreModules, piecesModule, redactState, sk2CoreModules, sk3CoreModules, turnModule } from '@asl/rules';
import { sk1CoreModules } from '../../../packages/rules/src/sk1';
import { makeEngine } from '../../../packages/rules/test/fixtures';
import { StackPeek } from '../src/board/StackPeek';
import { describeEvents } from '../src/game/describe';

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
 * A tank beneath a trench on the stack card and in the log (full ASL, ASLRB B27.52, D4.2, A12.33): its owner reads that it
 * is Hull Down and never moves; the other seat, while the trench is hidden, reads nothing of it; a hull hit on it reads as
 * no effect.
 */
describe('a vehicle beneath a trench', () => {
  function game(hidden: boolean) {
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
        { id: 't', def: 'ru.T34M43', side: 'ru', hex: 'uO5', tags: { vca: 0, ca: 0 } },
        { id: 'g', def: 'ge.467', side: 'ge', hex: 'uY9' },
      ],
    });
    const trench = { id: 'ru.fort1', side: 'ru', kind: 'trench', hex: 'uO5', hidden };
    const s: GameState = {
      ...state,
      pieces: { ...state.pieces, t: { ...state.pieces['t']!, loc: { kind: 'hex', hex: 'uO5', pos: { ent: 'trench' } } } },
      ext: { ...state.ext, 'asl.fortifications': { counters: [trench] } },
    };
    return { engine, s };
  }

  it('its owner reads it is Hull Down and never moves (B27.52)', () => {
    const { engine, s } = game(true);
    const card = render(createElement(StackPeek, { env: engine.env(redactState(engine, s, 'ru')), hex: 'uO5', at: { x: 10, y: 10 }, bounds: { w: 800, h: 600 } }));
    expect(card).toContain('Hull Down to Direct Fire ordnance');
    expect(card).toContain('ASLRB B27.52');
  });

  it('the other seat, while the trench is hidden, reads nothing of the trench or the HD status (A12.33); once shown, it does', () => {
    const hidden = game(true);
    const theirs = render(createElement(StackPeek, { env: hidden.engine.env(redactState(hidden.engine, hidden.s, 'ge')), hex: 'uO5', at: { x: 10, y: 10 }, bounds: { w: 800, h: 600 } }));
    expect(theirs).not.toContain('Hull Down');
    expect(theirs).not.toContain('trench');
    const open = game(false);
    const shown = render(createElement(StackPeek, { env: open.engine.env(redactState(open.engine, open.s, 'ge')), hex: 'uO5', at: { x: 10, y: 10 }, bounds: { w: 800, h: 600 } }));
    expect(shown).toContain('Hull Down');
  });

  it('the log reads a hull hit on it as no effect, and names the owner\'s choice of the in-hex TEM', () => {
    const { engine, s } = game(false);
    const lines = describeEvents(engine.env(s), [
      { seq: 1, type: 'asl.hd.hullHit', payload: { weapon: 'x', target: 't', dice: [2, 3], kind: 'trench', tem: 2 } },
      { seq: 2, type: 'asl.hd.chosen', payload: { vehicle: 't', choice: 'tem' } },
    ] as never).map((l) => l.text);
    expect(lines[0]).toMatch(/hull hit on .*: no effect, it is Hull Down beneath the trench \(ASLRB B27.52, D4.2\)/);
    expect(lines[1]).toMatch(/the in-hex TEM is taken instead of Hull Down for this shot/);
  });
});
