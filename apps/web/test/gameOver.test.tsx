// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act as reactAct, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { newGame, scenarioById } from '@asl/content';
import type { GameResult, GameState, Piece } from '@asl/engine';
import { GameOver } from '../src/fx/Overlays';
import { gameOverText } from '../src/game/gameOver';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
function mount(el: ReactElement): HTMLDivElement {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  reactAct(() => root!.render(createElement(MemoryRouter, null, el)));
  return host;
}
afterEach(() => {
  reactAct(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

/** LMA6: the Free French win at game end if no Good Order German is left in the buildings of hexrows I to P. */
const LMA6 = scenarioById('lma-6')!;
const sideName = (s: string) => LMA6.sides.find((x) => x.side === s)!.name;

/** The game ended with `result`, the Germans wiped out when `germansGone`. */
function ended(result: GameResult, germansGone: boolean) {
  const { engine, state } = newGame(LMA6, 'gameover', { los: 'grid' });
  const pieces: Record<string, Piece> = {};
  for (const p of Object.values(state.pieces)) pieces[p.id] = germansGone && p.side === 'ge' ? { ...p, loc: { kind: 'eliminated' } } : p;
  const s: GameState = { ...state, pieces, turn: 6, phase: 'CCPh', result };
  return { env: engine.env(s), state: s };
}

describe('the game-over screen says what decided the game', () => {
  it('a win on a condition at scenario end lists the condition met', () => {
    const { env, state } = ended({ winner: 'br', reason: 'scenario end' }, true);
    expect(gameOverText(env, LMA6, state, sideName)).toEqual({
      reason: 'The game ended after Turn 6',
      decidedBy: ['No Good Order Germans in the 27 buildings of hexrows I to P of board U at game end'],
    });
  });

  it('a defender who held on: the attacker\'s failed condition is the reason, nothing listed', () => {
    const { env, state } = ended({ winner: 'ge', reason: 'scenario end' }, false);
    expect(gameOverText(env, LMA6, state, sideName)).toEqual({ reason: 'The Free French never cleared the objective', decidedBy: [] });
  });

  it('a draw, a concession and an annihilation keep their own reasons', () => {
    const draw = ended({ winner: null, reason: 'scenario end' }, false);
    expect(gameOverText(draw.env, LMA6, draw.state, sideName)).toEqual({ reason: 'Neither side met its victory conditions', decidedBy: [] });
    const conceded = ended({ winner: 'br', reason: 'concession' }, true);
    expect(gameOverText(conceded.env, LMA6, conceded.state, sideName)).toEqual({ reason: 'The Germans concede', decidedBy: [] });
    const wiped = ended({ winner: 'br', reason: 'annihilation' }, true);
    expect(gameOverText(wiped.env, LMA6, wiped.state, sideName)?.reason).toBe('The Germans have no units left');
    expect(gameOverText(wiped.env, LMA6, wiped.state, sideName)?.decidedBy).toHaveLength(1);
  });

  it('a game still going has no game-over text', () => {
    const { engine, state } = newGame(LMA6, 'gameover', { los: 'grid' });
    expect(gameOverText(engine.env(state), LMA6, state, sideName)).toBeNull();
  });

  it('renders the conditions under "Decided by", and nothing extra when there are none', () => {
    const noop = () => {};
    const el = mount(createElement(GameOver, { winner: 'br', reason: 'The game ended after Turn 6', decidedBy: ['Control P5 and R5 at game end', 'Eliminate every German Gun'], sideName, onLobby: noop, onReview: noop }));
    expect(el.querySelector('.reason')?.textContent).toBe('The game ended after Turn 6');
    expect(el.querySelector('.decided-kicker')?.textContent).toBe('Decided by');
    expect([...el.querySelectorAll('.decided li')].map((li) => li.textContent)).toEqual(['Control P5 and R5 at game end', 'Eliminate every German Gun']);
    reactAct(() => root?.unmount());
    const plain = mount(createElement(GameOver, { winner: 'ge', reason: 'The Free French concede', sideName, onLobby: noop, onReview: noop }));
    expect(plain.querySelector('.decided')).toBeNull();
  });
});
