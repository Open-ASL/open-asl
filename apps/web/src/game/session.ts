import { useCallback, useMemo, useRef, useState } from 'react';
import { RuleError, type Action, type Engine, type GameState, type LoggedEvent } from '@asl/engine';
import { newSk1Game } from '@asl/content';
import type { ScenarioDef } from '@asl/rules';

export interface Session {
  engine: Engine;
  state: GameState;
  log: LoggedEvent[];
  /** Submit an action for the current decision owner. Returns an error message if illegal. */
  act(action: Omit<Action, 'side' | 'decisionId'>): string | null;
  /** Check legality without applying. */
  check(action: Omit<Action, 'side' | 'decisionId'>): string | null;
  /**
   * Development builds, local games: submit complete actions (side and decision id included) one after another, each
   * recorded like a player's (a dev fixture's script, `@asl/content` `fixtureActions`). Stops at the first refusal.
   */
  applyActions?(actions: Action[]): string | null;
  /** Undo the last action (hotseat convenience; RNG state is part of GameState, so redoing gives the same dice). */
  undo(): void;
  canUndo: boolean;
  /** Online: undo is asked of the opponent; the Undo button opens the request instead of calling undo(). */
  askUndo?(): void;
  /** Number of actions submitted so far (the replayed ones included). */
  actionCount: number;
  /** Set when the recorded actions could not be replayed (ruleset drift); the game is not playable. */
  replayError: string | null;
  /**
   * The side this browser plays. Absent for a local game (every decision is the player's);
   * null for a spectator. Decisions belonging to another side are shown but cannot be acted on.
   */
  mySide?: string | null;
  /**
   * Online play: share this browser's work in progress on the current decision (setup counters
   * placed so far) with the opponent, or null to clear it. Absent for a local game.
   */
  publishDraft?(draft: Draft | null): void;
  /** Online play: the other player's work in progress, if they have shared any. */
  theirDraft?: Draft | null;
  /** Online play: point a spot out to the opponent (Ctrl+click): the hex and the exact map point. Absent for a local game, where a ping is only drawn here. */
  sendPing?(hex: string, at?: MapPoint): void;
  /** Online play: pings received from the other player, oldest first; the screen draws each once by its id. */
  pings?: Ping[];
}

/** A point in map pixels: the board's own coordinates, the same on every screen whatever its zoom or turn. */
export interface MapPoint {
  x: number;
  y: number;
}

/** A spot the other player pointed out. */
export interface Ping {
  /** Rises with each ping received, so the screen knows which it has already shown. */
  id: number;
  side: string;
  hex: string;
  /** The exact point; absent means the hex centre. */
  at?: MapPoint;
}

/** Work in progress on a decision, shown to the opponent before the deciding action is sent. */
export interface Draft {
  decisionId: string;
  /** Setup: piece id -> hex it is placed in. */
  placements: Record<string, string>;
}

export interface LocalGameOptions {
  /** Actions recorded earlier, replayed in order when the game is created. */
  initialActions?: Action[];
  /** Called after each successful submit with the 1-based action number and the state it produced. */
  onAct?(seq: number, action: Action, state: GameState): void;
  /** Called after an undo with the number of the action that was removed. */
  onUndo?(seq: number, state: GameState): void;
}

/** A local (hotseat / vs-AI) game held in the browser, optionally recording its actions. */
export function useLocalGame(scenario: ScenarioDef, seed: string, opts: LocalGameOptions = {}): Session {
  const { initialActions, onAct, onUndo } = opts;
  const created = useMemo(() => {
    const g = newSk1Game(scenario, seed);
    let state = g.state;
    const events = [...g.events];
    let count = 0;
    try {
      for (const a of initialActions ?? []) {
        const t = g.engine.submit(state, a);
        state = t.state;
        events.push(...t.events);
        count++;
      }
      return { engine: g.engine, state, events, count, error: null as string | null };
    } catch (e) {
      return { engine: g.engine, state, events, count, error: `The recorded game does not replay under the current rules: ${(e as Error).message}` };
    }
    // The recording is replayed once, when the game is opened.
  }, [scenario, seed]);
  const [state, setState] = useState<GameState>(created.state);
  const [log, setLog] = useState<LoggedEvent[]>(created.events);
  const [count, setCount] = useState(created.count);
  const history = useRef<{ state: GameState; logLen: number }[]>([]);
  const engine = created.engine;

  const withSide = useCallback(
    (a: Omit<Action, 'side' | 'decisionId'>, s: GameState): Action | null => {
      const d = engine.currentDecision(s);
      return d ? ({ ...a, side: d.owner, decisionId: d.id } as Action) : null;
    },
    [engine],
  );

  const check = useCallback(
    (a: Omit<Action, 'side' | 'decisionId'>) => {
      const full = withSide(a, state);
      return full ? engine.validate(state, full) : 'No decision pending';
    },
    [engine, state, withSide],
  );

  const act = useCallback(
    (a: Omit<Action, 'side' | 'decisionId'>) => {
      const full = withSide(a, state);
      if (!full) return 'No decision pending';
      try {
        const t = engine.submit(state, full);
        history.current.push({ state, logLen: log.length });
        setState(t.state);
        setLog((l) => [...l, ...t.events]);
        setCount(count + 1);
        onAct?.(count + 1, full, t.state);
        return null;
      } catch (e) {
        if (e instanceof RuleError) return e.message;
        console.error(e);
        return `Engine error: ${(e as Error).message}`;
      }
    },
    [engine, state, log.length, withSide, count, onAct],
  );

  const applyActions = useCallback(
    (actions: Action[]) => {
      let s = state;
      const events: LoggedEvent[] = [];
      let n = count;
      let error: string | null = null;
      for (const a of actions) {
        try {
          const t = engine.submit(s, a);
          history.current.push({ state: s, logLen: log.length + events.length });
          s = t.state;
          events.push(...t.events);
          n++;
          onAct?.(n, a, s);
        } catch (e) {
          error = (e as Error).message;
          break;
        }
      }
      setState(s);
      setLog((l) => [...l, ...events]);
      setCount(n);
      return error;
    },
    [engine, state, log.length, count, onAct],
  );

  const undo = useCallback(() => {
    const prev = history.current.pop();
    if (!prev) return;
    setState(prev.state);
    setLog((l) => l.slice(0, prev.logLen));
    setCount(count - 1);
    onUndo?.(count, prev.state);
  }, [count, onUndo]);

  return { engine, state, log, act, check, undo, canUndo: history.current.length > 0, actionCount: count, replayError: created.error, ...(import.meta.env.DEV ? { applyActions } : {}) };
}
