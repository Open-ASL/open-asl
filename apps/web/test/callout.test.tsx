// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act as reactAct, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Decision, Engine, GameState, SideId } from '@asl/engine';
import { makeEngine } from '../../../packages/rules/test/fixtures';
import { usePresentation } from '../src/game/presentation';
import { useGameFx, type GameFx } from '../src/fx/useGameFx';

const sfx = vi.hoisted(() => ({ played: [] as string[] }));
vi.mock('../src/audio/engine', () => ({ playSfx: (name: string) => sfx.played.push(name) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let seen: GameFx | null = null;
function Screen({ engine, state, decision, viewer }: { engine: Engine; state: GameState; decision: Decision | undefined; viewer: SideId | null }) {
  const present = usePresentation(engine, state, []);
  seen = useGameFx(engine.env(state), [], decision, 'full', viewer, present);
  return null;
}

let root: Root | null = null;
beforeEach(() => {
  sfx.played = [];
  root = createRoot(document.createElement('div'));
});
afterEach(() => {
  reactAct(() => root?.unmount());
  root = null;
  seen = null;
});

/** The screen as `viewer` sees it, first with no decision pending, then with `decision` asked. */
function ask(decision: Decision, viewer: SideId | null) {
  const { engine, state } = makeEngine({ pieces: [{ id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP5' }] });
  reactAct(() => root!.render(createElement(Screen, { engine, state, decision: undefined, viewer })));
  reactAct(() => root!.render(createElement(Screen, { engine, state, decision, viewer })));
}

const dff: Decision = { id: 'd-dff', kind: 'firstFire', owner: 'ge', deadlineClass: 'phase', data: { hex: 'yP5' } } as Decision;

describe('the banner for a Defensive First Fire chance', () => {
  it('is not shown to the player it waits on, who has the standing cue with its Pass button, but they hear the chime', () => {
    ask(dff, 'ge');
    expect(seen!.callout).toBeNull();
    expect(sfx.played).toContain('callout');
  });

  it('is shown to the moving player as news', () => {
    ask(dff, 'am');
    expect(seen!.callout?.text).toBe('Defensive First Fire · P5');
  });

  it('is shown to a spectator', () => {
    ask(dff, null);
    expect(seen!.callout?.text).toBe('Defensive First Fire · P5');
  });
});
