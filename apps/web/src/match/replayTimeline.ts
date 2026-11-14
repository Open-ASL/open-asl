import type { Action, Engine, GameState, LoggedEvent, SideId } from '@asl/engine';
import { newSk1Game } from '@asl/content';
import type { ScenarioDef } from '@asl/rules';

/** The game after a number of recorded actions: its state and how much of the log it has. */
export interface ReplayFrame {
  state: GameState;
  logLen: number;
}

/** A recording replayed once, every step kept (states share structure, so this is cheap). */
export interface Replay {
  engine: Engine;
  /** `frames[i]` is the game after `i` actions; `frames[0]` is the scenario as created. */
  frames: ReplayFrame[];
  log: LoggedEvent[];
  /** Set when an action does not replay under the current rules; the frames stop before it. */
  error: string | null;
}

export function buildReplay(scenario: ScenarioDef, seed: string, actions: Action[]): Replay {
  const g = newSk1Game(scenario, seed);
  const log = [...g.events];
  const frames: ReplayFrame[] = [{ state: g.state, logLen: log.length }];
  return extendReplay({ engine: g.engine, frames, log, error: null }, actions);
}

/** Carry a replay on through actions recorded after the ones it holds (a recording still being written). */
export function extendReplay(replay: Replay, actions: Action[]): Replay {
  if (replay.error || actions.length === replay.frames.length - 1) return replay;
  const frames = [...replay.frames];
  const log = [...replay.log];
  let state = frames[frames.length - 1]!.state;
  for (const a of actions.slice(frames.length - 1)) {
    try {
      const t = replay.engine.submit(state, a);
      state = t.state;
      log.push(...t.events);
      frames.push({ state, logLen: log.length });
    } catch (e) {
      return { engine: replay.engine, frames, log, error: `The recorded game does not replay under the current rules: ${(e as Error).message}` };
    }
  }
  return { engine: replay.engine, frames, log, error: null };
}

/** Where a Player Turn begins on the timeline: the first step whose state is in it. */
export interface TurnMark {
  step: number;
  turn: number;
  side: SideId;
  /** The first Player Turn of a Game Turn (drawn taller, with the turn number). */
  gameTurn: boolean;
}

/** The Player Turn boundaries of a replay, in step order. Setup steps belong to no Player Turn. */
export function turnMarks(frames: ReplayFrame[]): TurnMark[] {
  const marks: TurnMark[] = [];
  let prev: { turn: number; side: SideId } | null = null;
  frames.forEach(({ state }, step) => {
    if (state.phase === 'setup') return;
    if (prev && prev.turn === state.turn && prev.side === state.attacker) return;
    marks.push({ step, turn: state.turn, side: state.attacker, gameTurn: !prev || prev.turn !== state.turn });
    prev = { turn: state.turn, side: state.attacker };
  });
  return marks;
}

/** The step a "previous turn" jump lands on: the start of this Player Turn, or of the one before when already there. */
export function prevTurnStep(marks: TurnMark[], step: number): number {
  const before = marks.filter((m) => m.step < step);
  return before.length ? before[before.length - 1]!.step : 0;
}

/** The step a "next turn" jump lands on: the start of the next Player Turn, or the end. */
export function nextTurnStep(marks: TurnMark[], step: number, last: number): number {
  return marks.find((m) => m.step > step)?.step ?? last;
}
