// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act as reactAct, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Engine, GameState, LoggedEvent } from '@asl/engine';
import { makeEngine } from '../../../packages/rules/test/fixtures';
import { usePresentation } from '../src/game/presentation';
import { useGameFx, type GameFx } from '../src/fx/useGameFx';

vi.mock('../src/audio/engine', () => ({ playSfx: () => {} }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let seen: GameFx | null = null;
function Screen({ engine, state, log }: { engine: Engine; state: GameState; log: LoggedEvent[] }) {
  const present = usePresentation(engine, state, log, false, 0);
  seen = useGameFx(engine.env(state), log, engine.currentDecision(present.state), 'full', null, present, 0);
  return null;
}
let root: Root | null = null;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] });
  root = createRoot(document.createElement('div'));
});
afterEach(() => {
  reactAct(() => root?.unmount());
  root = null;
  seen = null;
  vi.useRealTimers();
});

describe('a result word on the board', () => {
  it('floats once over a unit, though the outcome comes as a check and then the piece’s change', () => {
    const { engine, state } = makeEngine({ startPhase: 'PFPh', pieces: [{ id: 'g1', def: 'ge.467', side: 'ge', hex: 'yO5', tags: { broken: true } }] });
    const created = engine.createGame({ scenarioId: 'test', sides: state.sides, attacker: state.attacker, seed: 'test' }).events;
    const show = (log: LoggedEvent[]) => reactAct(() => root!.render(createElement(Screen, { engine, state, log })));
    show(created);
    const at = created.length ? created[created.length - 1]!.seq : 0;
    // A broken squad fails a MC: the check says REDUCED, and so does its replacement by the half-squad.
    const ev = (i: number, type: string, payload: object) => ({ seq: at + i, type, payload }) as LoggedEvent;
    show([
      ...created,
      ev(1, 'dice.rolled', { label: 'MC g1', dice: [5, 6] }),
      ev(2, 'sk1.check', { unit: 'g1', kind: 'MC', outcome: 'reduced', dr: 11, final: 11, target: 7 }),
      ev(3, 'piece.replaced', { id: 'g1', defId: 'ge.247', reason: 'casualty' }),
    ]);
    reactAct(() => vi.advanceTimersByTime(800));
    const words = seen!.boardFx.filter((f) => f.kind === 'text' && f.piece === 'g1').map((f) => (f as { text: string }).text);
    expect(words).toEqual(['REDUCED']);
  });
});
