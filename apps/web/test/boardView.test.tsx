// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Statics } from '@asl/rules';
import { makeEngine } from '../../../packages/rules/test/fixtures';
import type { BoardFx } from '../src/fx/useGameFx';

/**
 * Regression guard for the board canvas. BoardView builds its Pixi application once and keeps
 * it for the life of the match; when a prop it was set up with is replaced by a fresh value of
 * the same content (as every React render of a parent can do), the canvas must NOT be torn down
 * and rebuilt. A rebuild blanks the screen, drops the running animations and loses any effect
 * (tracer, burst, result) that arrived with that state change.
 */

const pixi = vi.hoisted(() => ({ inits: 0, destroys: 0, tickers: [] as (() => void)[], graphics: [] as { calls: string[] }[] }));

vi.mock('pixi.js', () => {
  // A stand-in Pixi: every display object is a recorder whose methods are chainable no-ops.
  const node = (): any => {
    const o: Record<string, any> = {
      calls: [] as string[],
      children: [] as unknown[],
      x: 0,
      y: 0,
      alpha: 1,
      visible: true,
      width: 0,
      height: 0,
      then: undefined, // never thenable, so `await` resolves with it as-is
      position: { set() {} },
      scale: { x: 1, y: 1, set() {} },
      anchor: { set() {} },
      pivot: { set() {} },
      style: {},
    };
    const p: any = new Proxy(o, {
      get: (t, k) => {
        if (k in t) return t[k as string];
        if (typeof k === 'symbol') return undefined;
        return (...args: unknown[]) => {
          t['calls'].push(k as string);
          if (k === 'addChild') t['children'].push(...args);
          return p;
        };
      },
    });
    return p;
  };
  class Application {
    canvas = Object.assign(document.createElement('canvas'), { setPointerCapture() {} });
    stage = node();
    screen = { width: 800, height: 600 };
    // The board listens for the renderer's resize to keep the map in view.
    renderer = { on() {} };
    ticker = { deltaMS: 16, add: (fn: () => void) => pixi.tickers.push(fn) };
    async init() {
      pixi.inits++;
    }
    destroy() {
      pixi.destroys++;
    }
  }
  const plain = class {
    constructor() {
      return node();
    }
  };
  const Graphics = class {
    constructor() {
      const g = node();
      pixi.graphics.push(g);
      return g;
    }
  };
  return { Application, Assets: { load: async () => node() }, Container: plain, Graphics, Sprite: plain, Text: plain, Texture: plain, Rectangle: plain };
});

const { BoardView } = await import('../src/board/BoardView');

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { engine, state } = makeEngine({
  pieces: [
    { id: 'a1', def: 'am.747', side: 'am', hex: 'yN5' },
    { id: 'g1', def: 'ge.467', side: 'ge', hex: 'yP5' },
  ],
});
const statics = engine.statics as Statics;
const placements = [{ board: 'y', x: 0, y: 0 }];
const noop = () => {};

/** Lets the async Pixi setup and texture loads run to completion. */
async function settle() {
  for (let i = 0; i < 6; i++) await act(async () => await new Promise((r) => setTimeout(r, 0)));
}

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  pixi.inits = pixi.destroys = 0;
  pixi.tickers.length = pixi.graphics.length = 0;
});

async function mount(props: Partial<Parameters<typeof BoardView>[0]> = {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  const render = (p: Partial<Parameters<typeof BoardView>[0]>) =>
    act(() => root!.render(<BoardView state={state} statics={statics} placements={placements} overlay={{}} onHexClick={noop} {...props} {...p} />));
  await render({});
  await settle();
  return render;
}

describe('BoardView keeps its canvas across renders', () => {
  it('builds the Pixi application once and keeps it when the game state changes', async () => {
    const render = await mount({ offboard: statics.map.offboard('N'), objectives: [] });
    expect(pixi.inits).toBe(1);

    // Every action yields a new state; parents also tend to hand down fresh arrays of the same hexes.
    const next = { ...state, pieces: { ...state.pieces } };
    await render({ state: next, offboard: statics.map.offboard('N'), objectives: [] });
    await settle();
    expect(pixi.inits).toBe(1);
    expect(pixi.destroys).toBe(0);
  });

  it('rebuilds only when the map itself changes (a rotation)', async () => {
    const render = await mount({ rotation: 0 });
    expect(pixi.inits).toBe(1);
    await render({ rotation: 90 });
    await settle();
    expect(pixi.destroys).toBe(1);
    expect(pixi.inits).toBe(2);
  });

  it('plays a tracer that arrives with a state change', async () => {
    const render = await mount({ offboard: statics.map.offboard('N') });
    const before = pixi.graphics.length;
    const fx: BoardFx[] = [{ id: 1, kind: 'tracer', from: ['yN5'], to: 'yP5', color: 0xffc85a }];
    await render({ state: { ...state, pieces: { ...state.pieces } }, offboard: statics.map.offboard('N'), fx });
    await settle();
    // One animation frame: the tracer draws its line and muzzle flash.
    for (const tick of pixi.tickers) tick();
    const drawn = pixi.graphics.slice(before).filter((g) => g.calls.includes('lineTo') && g.calls.includes('circle'));
    expect(pixi.inits).toBe(1);
    expect(drawn.length).toBeGreaterThan(0);
  });
});
