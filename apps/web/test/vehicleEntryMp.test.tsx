// @vitest-environment jsdom
import { act as reactAct, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type { Action, LoggedEvent } from '@asl/engine';
import { moveState, type Statics } from '@asl/rules';
import { sk2CoreModules } from '../../../packages/rules/src/sk2';
import { sk3CoreModules } from '../../../packages/rules/src/sk3';
import { T3 } from '../../../packages/rules/src/sk3/status';
import { RU_VS_GE, act, makeEngine } from '../../../packages/rules/test/fixtures';
import type { Session } from '../src/game/session';

vi.mock('../src/board/BoardView', () => ({
  BoardView: ({ onHexContextMenu }: { onHexContextMenu(hex: string, at: { x: number; y: number }): void }) => (
    <button onContextMenu={() => onHexContextMenu('yM4', { x: 420, y: 360 })}>M4</button>
  ),
}));

const { GameScreen } = await import('../src/GameScreen');
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

async function mountGame({ woods = false, inMotion = false, dice = [4, 4] } = {}) {
  const { engine, state } = makeEngine({
    pieces: [{ id: 't34', def: 'ru.T34M43', side: 'ru', hex: 'yM5', tags: { vca: 0, ca: 0, ...(inMotion ? { [T3.motion]: true } : {}) } }],
    scenario: RU_VS_GE,
    extra: [...sk2CoreModules, ...sk3CoreModules],
    startPhase: 'MPh',
    ...(woods ? { terrain: { yM4: { terrain: 'woods' } }, dice } : {}),
  });
  let latest = act(engine, state, { type: 'vmove.start', vehicle: 't34' }).state;
  const events: LoggedEvent[] = [];
  function Game() {
    const [current, setCurrent] = useState(latest);
    const session: Session = {
      state: current, engine, log: [], undo: () => {}, canUndo: false, actionCount: 1, replayError: null,
      check: (action) => {
        const decision = engine.currentDecision(current)!;
        return engine.validate(current, { ...action, side: decision.owner, decisionId: decision.id } as Action);
      },
      act: (action) => {
        const result = act(engine, current, action);
        latest = result.state;
        events.push(...result.events);
        setCurrent(latest);
        return null;
      },
    };
    return <GameScreen scenario={(engine.statics as Statics).scenario} session={session} viewKey="entry-mp" onQuit={() => {}} />;
  }
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  cleanup = async () => {
    await reactAct(() => root.unmount());
    host.remove();
  };
  await reactAct(() => root.render(<Game />));
  const openWheel = () => reactAct(() => {
    const hex = [...host.querySelectorAll('button')].find((button) => button.textContent === 'M4')!;
    hex.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
  });
  const wheelAction = (label: string) => [...host.querySelectorAll<HTMLButtonElement>('.aw-item')]
    .find((button) => button.querySelector('.aw-label')?.textContent === label);
  return { host, events, unit: () => latest.pieces['t34']!, move: () => moveState(engine.env(latest)), openWheel, wheelAction };
}

it('declares a custom entry cost from the side panel without stopping the vehicle', async () => {
  const { host, unit, move } = await mountGame();
  const destination = host.querySelector<HTMLSelectElement>('select[aria-label="Destination hex"]')!;
  const input = host.querySelector<HTMLInputElement>('input[aria-label="Total entry MP"]')!;
  const enter = destination.form!.querySelector('button')!;
  reactAct(() => {
    destination.value = 'yM4';
    destination.dispatchEvent(new Event('change', { bubbles: true }));
  });

  const setMp = (value: string) => reactAct(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  for (const invalid of ['1', '16', '5.25']) {
    setMp(invalid);
    expect(enter.disabled).toBe(true);
  }

  setMp('5.5');
  expect(enter.disabled).toBe(false);
  reactAct(() => enter.click());
  expect(unit().loc).toEqual({ kind: 'hex', hex: 'yM4' });
  expect(move()).toMatchObject({ spent: { t34: 6.5 }, vehicle: { stopped: false } });
});

it.each([false, true])('can enter woods at full cost while reserving 1 MP for the stop (already in Motion: %s)', async (inMotion) => {
  const { events, move, openWheel, wheelAction } = await mountGame({ woods: true, inMotion });
  const left = inMotion ? 16 : 15;
  openWheel();
  expect(wheelAction('Enter at half MP (8 MP)')).toBeDefined();
  expect(wheelAction(`Enter with all MP (${left} MP)`)).toBeDefined();
  reactAct(() => wheelAction(`Enter for ${left - 1} MP (1 MP to stop)`)!.click());
  expect(events.find((event) => event.type === 'sk3.vehicle.bog')?.payload).toMatchObject({ drm: 1, bogged: false });
  expect(move()).toMatchObject({ hex: 'yM4', spent: { t34: 15 }, vehicle: { stopped: false } });

  openWheel();
  const stop = wheelAction('Stop (1 MP)')!;
  expect(stop.getAttribute('aria-disabled')).toBeNull();
  reactAct(() => stop.click());
  expect(move()).toMatchObject({ spent: { t34: 16 }, vehicle: { stopped: true } });
});

it('ends movement without a paid stop if the vehicle bogs on entry', async () => {
  const { events, unit, move, openWheel, wheelAction } = await mountGame({ woods: true, dice: [6, 6] });
  openWheel();
  reactAct(() => wheelAction('Enter for 14 MP (1 MP to stop)')!.click());
  expect(events.find((event) => event.type === 'sk3.vehicle.bog')?.payload).toMatchObject({ drm: 1, bogged: true });
  expect(unit().tags[T3.bog]).toBe('bogged');
  expect(move()).toBeUndefined();
});
