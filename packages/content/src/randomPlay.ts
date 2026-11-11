import type { Action, Engine, GameEvent, GameState } from '@asl/engine';
import type { ScenarioDef } from '@asl/rules';
import { newGame } from './game';

/** Small deterministic PRNG (mulberry32): numbers in [0, 1). */
export function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Picks one of the legal actions. */
export type RandomPicker = (legal: Action[], state: GameState, engine: Engine, rand: () => number) => Action;

/** The default random player: mostly doing things (three in four picks skip ending a phase or passing), sometimes passing. */
export const pickMostlyDoing: RandomPicker = (legal, _state, _engine, rand) => {
  const doing = legal.filter((a) => a.type !== 'endPhase' && a.type !== 'defPass');
  const pool = doing.length && rand() < 0.75 ? doing : legal;
  return pool[Math.floor(rand() * pool.length)]!;
};

/** A picker that chooses in proportion to a weight per legal action (a weight of 0 never picks; if all are 0, the last action). */
export function weightedPicker(weigh: (a: Action, legal: Action[], state: GameState, engine: Engine) => number): RandomPicker {
  return (legal, state, engine, rand) => {
    const w = legal.map((a) => weigh(a, legal, state, engine));
    let r = rand() * w.reduce((x, y) => x + y, 0);
    for (let i = 0; i < legal.length; i++) if ((r -= w[i]!) <= 0 && w[i]! > 0) return legal[i]!;
    return legal[legal.length - 1]!;
  };
}

export interface RandomPlayOptions {
  /** The random source (default `mulberry(0)`). */
  rand?: () => number;
  /** Stop after this many actions even without a result (default 6000). */
  maxSteps?: number;
  los?: 'pixel' | 'grid';
  /** How to choose among the legal actions (default `pickMostlyDoing`). */
  pick?: RandomPicker;
  /** Called after every action with the new state and the events it produced. */
  onStep?: (state: GameState, events: GameEvent[], action: Action) => void;
}

export interface RandomPlayResult {
  engine: Engine;
  /** The last state: it has a `result` unless `maxSteps` ran out. */
  state: GameState;
  /** Every action submitted, in order: replaying them from the same seed reproduces the game. */
  actions: Action[];
  steps: number;
}

/** Plays a scenario from a fresh game (seeded `seed`) to its end, both sides picking among the legal actions at random. */
export function playRandom(scenario: ScenarioDef, seed: string, opts: RandomPlayOptions = {}): RandomPlayResult {
  const { engine, state: s0 } = newGame(scenario, seed, { los: opts.los ?? 'grid' });
  const rand = opts.rand ?? mulberry(0);
  const pick = opts.pick ?? pickMostlyDoing;
  const max = opts.maxSteps ?? 6000;
  const actions: Action[] = [];
  let state = s0;
  let steps = 0;
  while (!state.result && steps++ < max) {
    const d = engine.currentDecision(state);
    if (!d) throw new Error(`No decision at seq ${state.seq}`);
    const legal = engine.legalActions(state, d.owner);
    if (legal.length === 0) throw new Error(`No legal actions for ${d.kind} (${d.owner}) in ${state.phase}`);
    const action = pick(legal, state, engine, rand);
    const res = engine.submit(state, action);
    actions.push(action);
    state = res.state;
    opts.onStep?.(state, res.events, action);
  }
  return { engine, state, actions, steps };
}
