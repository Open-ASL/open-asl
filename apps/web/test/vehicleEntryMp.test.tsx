// @vitest-environment jsdom
import { act as reactAct, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { Action } from '@asl/engine';
import { moveState, type Statics } from '@asl/rules';
import { sk2CoreModules } from '../../../packages/rules/src/sk2';
import { sk3CoreModules } from '../../../packages/rules/src/sk3';
import { RU_VS_GE, act, makeEngine } from '../../../packages/rules/test/fixtures';
import type { Session } from '../src/game/session';

vi.mock('../src/board/BoardView', () => ({ BoardView: () => null }));

const { GameScreen } = await import('../src/GameScreen');
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it('declares a custom entry cost from the side panel without stopping the vehicle', async () => {
  const { engine, state } = makeEngine({
    pieces: [{ id: 't34', def: 'ru.T34M43', side: 'ru', hex: 'yM5', tags: { vca: 0, ca: 0 } }],
    scenario: RU_VS_GE,
    extra: [...sk2CoreModules, ...sk3CoreModules],
    startPhase: 'MPh',
  });
  let latest = act(engine, state, { type: 'vmove.start', vehicle: 't34' }).state;
  function Game() {
    const [current, setCurrent] = useState(latest);
    const session: Session = {
      state: current, engine, log: [], undo: () => {}, canUndo: false, actionCount: 1, replayError: null,
      check: (action) => {
        const decision = engine.currentDecision(current)!;
        return engine.validate(current, { ...action, side: decision.owner, decisionId: decision.id } as Action);
      },
      act: (action) => {
        latest = act(engine, current, action).state;
        setCurrent(latest);
        return null;
      },
    };
    return <GameScreen scenario={(engine.statics as Statics).scenario} session={session} viewKey="entry-mp" onQuit={() => {}} />;
  }
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    await reactAct(() => root.render(<Game />));
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
    const move = moveState(engine.env(latest))!;
    expect(latest.pieces['t34']!.loc).toEqual({ kind: 'hex', hex: 'yM4' });
    expect(move.spent['t34']).toBe(6.5);
    expect(move.vehicle?.stopped).toBe(false);
  } finally {
    await reactAct(() => root.unmount());
    host.remove();
  }
});
