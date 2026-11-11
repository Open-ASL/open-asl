import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collection, doc, onSnapshot, orderBy, query } from 'firebase/firestore';
import { RuleError, type Action, type Engine, type GameState, type LoggedEvent } from '@asl/engine';
import { newSk1Game } from '@asl/content';
import type { ScenarioDef } from '@asl/rules';
import { COL, type MatchActionDoc } from '@asl/platform';
import { api, db, errorOf } from '../firebase';
import { useOnlineExtras } from './onlineExtras';
import type { OnlineSession } from './onlineSession';

/** A position reached by replaying a prefix of the recording. */
interface Position {
  count: number;
  state: GameState;
  log: LoggedEvent[];
  /** The recorded actions, as stored, so a snapshot can be matched against what is shown. */
  jsons: string[];
}

function advance(engine: Engine, from: Position, jsons: string[]): Position {
  let { state } = from;
  const log = [...from.log];
  for (const json of jsons) {
    const t = engine.submit(state, JSON.parse(json) as Action);
    state = t.state;
    log.push(...t.events);
  }
  return { count: from.count + jsons.length, state, log, jsons: [...from.jsons, ...jsons] };
}

const isPrefix = (a: string[], b: string[]) => a.length <= b.length && a.every((j, i) => j === b[i]);

/**
 * The recording model (online matches without `model: 'views'`, from before the per-viewer views): the server holds
 * the recording and referees every order; this browser replays the recording as it grows and, for its own side,
 * applies orders optimistically while they are sent; a refused order puts the board back to the recorded position.
 * Kept until the last such live match ends, then deleted.
 */
export function useOnlineGameLegacy(matchId: string, scenario: ScenarioDef, seed: string, mySide: string | null): OnlineSession {
  const game = useMemo(() => newSk1Game(scenario, seed), [scenario, seed]);
  const engine = game.engine;
  const start = useMemo((): Position => ({ count: 0, state: game.state, log: [...game.events], jsons: [] }), [game]);

  /** The last position confirmed by the recording. */
  const server = useRef<Position>(start);
  const [shown, setShown] = useState<Position>(start);
  const [ready, setReady] = useState(false);
  const [replayError, setReplayError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [outstanding, setOutstanding] = useState(0);
  // The same count, readable from the recording listener.
  const inFlight = useRef(0);
  // Orders go out one at a time, in the order they were given; a refusal drops the ones behind it.
  const chain = useRef(Promise.resolve());
  const generation = useRef(0);

  const extras = useOnlineExtras(matchId, mySide);

  useEffect(() => {
    server.current = start;
    setShown(start);
    setReady(false);
    setReplayError(null);
    const q = query(collection(doc(db, COL.matches, matchId), COL.actions), orderBy('seq'));
    return onSnapshot(
      q,
      (snap) => {
        const jsons = snap.docs.map((d) => (d.data() as MatchActionDoc).json);
        // Extend the last confirmed position when the recording still begins with it; otherwise start over.
        const base = isPrefix(server.current.jsons, jsons) ? server.current : start;
        let pos: Position;
        try {
          pos = advance(engine, base, jsons.slice(base.count));
        } catch (e) {
          setReplayError(`The recorded game does not replay under the current rules: ${(e as Error).message}`);
          return;
        }
        server.current = pos;
        setReady(true);
        // Keep an optimistic position only while its orders are still on their way and the recording
        // is behind it along the same line. Otherwise a shorter recording is an undo: follow it back.
        setShown((cur) => (inFlight.current > 0 && cur.count > pos.count && isPrefix(pos.jsons, cur.jsons) ? cur : pos));
      },
      (e) => setLoadError(e.message),
    );
  }, [matchId, engine, start]);

  const withSide = useCallback(
    (a: Omit<Action, 'side' | 'decisionId'>, s: GameState): Action | null => {
      const d = engine.currentDecision(s);
      return d ? ({ ...a, side: d.owner, decisionId: d.id } as Action) : null;
    },
    [engine],
  );

  const check = useCallback(
    (a: Omit<Action, 'side' | 'decisionId'>) => {
      if (!mySide) return 'You are watching this match';
      const d = engine.currentDecision(shown.state);
      if (!d) return 'The game is over';
      if (d.owner !== mySide) return 'Waiting for the other player';
      return engine.validate(shown.state, withSide(a, shown.state)!);
    },
    [engine, shown.state, mySide, withSide],
  );

  const act = useCallback(
    (a: Omit<Action, 'side' | 'decisionId'>) => {
      if (!mySide) return 'You are watching this match';
      const d = engine.currentDecision(shown.state);
      if (!d) return 'The game is over';
      if (d.owner !== mySide) return 'Waiting for the other player';
      const full = withSide(a, shown.state)!;
      let t;
      try {
        t = engine.submit(shown.state, full);
      } catch (e) {
        if (e instanceof RuleError) return e.message;
        console.error(e);
        return `Engine error: ${(e as Error).message}`;
      }
      const seq = shown.count + 1;
      setShown({ count: seq, state: t.state, log: [...shown.log, ...t.events], jsons: [...shown.jsons, JSON.stringify(full)] });
      setSendError(null);
      setOutstanding((n) => n + 1);
      inFlight.current++;
      const gen = generation.current;
      chain.current = chain.current
        .then(async () => {
          // An earlier order was refused: this one was built on it and is moot.
          if (generation.current !== gen) return;
          try {
            await api('submitAction', { matchId, seq, action: full });
          } catch (e) {
            generation.current++;
            setSendError(errorOf(e).message);
            setShown(server.current);
          }
        })
        .finally(() => {
          inFlight.current--;
          setOutstanding((n) => n - 1);
        });
      return null;
    },
    [engine, shown, mySide, matchId, withSide],
  );

  const undo = useCallback(() => {}, []);
  const lastSide = useMemo(() => (shown.jsons.length ? (JSON.parse(shown.jsons[shown.jsons.length - 1]!) as Action).side : null), [shown.jsons]);

  return {
    engine,
    state: shown.state,
    log: shown.log,
    act,
    check,
    undo,
    canUndo: false,
    actionCount: shown.count,
    replayError,
    mySide,
    ready,
    sending: outstanding > 0,
    sendError,
    loadError,
    lastSide,
    ...extras,
  };
}
