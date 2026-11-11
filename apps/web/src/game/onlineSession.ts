import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collection, doc, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import type { Action, GameState, LoggedEvent } from '@asl/engine';
import { engineFor } from '@asl/content';
import type { ScenarioDef } from '@asl/rules';
import { COL, PUBLIC_VIEWER, type ViewDoc, type ViewStepDoc } from '@asl/platform';
import { api, db, errorOf } from '../firebase';
import { useOnlineExtras } from './onlineExtras';
import type { Session } from './session';

export interface OnlineSession extends Session {
  mySide: string | null;
  /** The position has been received at least once; before that the board shows the empty map. */
  ready: boolean;
  /** Orders still on their way to the server. */
  sending: boolean;
  /** The server refused the last order. Cleared by the next order. */
  sendError: string | null;
  /** The position could not be read at all. */
  loadError: string | null;
  /** The side that played the last action shown, null before the first. */
  lastSide: string | null;
}

/** How many of the latest steps the log keeps; the fold-forward reveal only needs the recent ones. */
const LOG_WINDOW = 80;

interface View {
  seq: number;
  state: GameState;
}

/**
 * An online game under the views model: the server holds the recording and the seed, referees every order, and
 * writes this viewer a redacted snapshot of the position after each action (`views/{viewer}`) with the action's
 * events as the viewer may see them (`views/{viewer}/steps`). This browser replays nothing and rolls nothing: it
 * shows the snapshot, checks an order's legality against it for instant feedback, and sends the order to the
 * server, whose answer carries the viewer's next snapshot. A spectator reads the `public` view.
 */
export function useOnlineGame(matchId: string, scenario: ScenarioDef, mySide: string | null): OnlineSession {
  const engine = useMemo(() => engineFor(scenario), [scenario]);
  const viewer = mySide ?? PUBLIC_VIEWER;
  const [view, setView] = useState<View | null>(null);
  const [steps, setSteps] = useState<Map<number, { side: string; events: LoggedEvent[] }>>(new Map());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [outstanding, setOutstanding] = useState(0);
  // Orders go out one at a time, in the order they were given; a refusal drops the ones behind it.
  const chain = useRef(Promise.resolve());
  const generation = useRef(0);
  const extras = useOnlineExtras(matchId, mySide);

  /** A newer snapshot replaces the shown one; an older one (a listener behind the callable's answer) is ignored, unless it is an undo. */
  const takeView = useCallback((next: View, undo = false) => setView((cur) => (cur && !undo && cur.seq >= next.seq ? cur : next)), []);

  useEffect(() => {
    setView(null);
    setSteps(new Map());
    setLoadError(null);
    const stopView = onSnapshot(
      doc(db, COL.matches, matchId, COL.views, viewer),
      (snap) => {
        const d = snap.data() as ViewDoc | undefined;
        if (!d) return setLoadError('This match has no view for you.');
        // The server's snapshot is the truth: a smaller seq than shown is an undo and is followed back.
        setView((cur) => (cur && cur.seq === d.seq ? cur : { seq: d.seq, state: JSON.parse(d.json) as GameState }));
      },
      (e) => setLoadError(e.message),
    );
    const stopSteps = onSnapshot(
      query(collection(db, COL.matches, matchId, COL.views, viewer, COL.steps), orderBy('seq', 'desc'), limit(LOG_WINDOW)),
      (snap) => {
        setSteps((cur) => {
          const next = new Map<number, { side: string; events: LoggedEvent[] }>();
          for (const d of snap.docs) {
            const s = d.data() as ViewStepDoc;
            next.set(s.seq, cur.get(s.seq) ?? { side: s.side, events: JSON.parse(s.json) as LoggedEvent[] });
          }
          return next;
        });
      },
      (e) => setLoadError(e.message),
    );
    return () => {
      stopView();
      stopSteps();
    };
  }, [matchId, viewer]);

  const state = view?.state ?? null;
  /** The events of the steps up to the shown position, in order (the window may not reach back to the start). */
  const log = useMemo(() => {
    if (!view) return [] as LoggedEvent[];
    return [...steps.entries()]
      .filter(([seq]) => seq <= view.seq)
      .sort((a, b) => a[0] - b[0])
      .flatMap(([, s]) => s.events);
  }, [steps, view]);
  const lastSide = view && view.seq > 0 ? (steps.get(view.seq)?.side ?? null) : null;

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
      if (!state) return 'The position is still loading';
      const d = engine.currentDecision(state);
      if (!d) return 'The game is over';
      if (d.owner !== mySide) return 'Waiting for the other player';
      return engine.validate(state, withSide(a, state)!);
    },
    [engine, state, mySide, withSide],
  );

  const act = useCallback(
    (a: Omit<Action, 'side' | 'decisionId'>) => {
      if (!mySide) return 'You are watching this match';
      if (!view) return 'The position is still loading';
      const d = engine.currentDecision(view.state);
      if (!d) return 'The game is over';
      if (d.owner !== mySide) return 'Waiting for the other player';
      const full = withSide(a, view.state)!;
      // Checked here against what this seat sees (instant refusals); the server checks it against the full position.
      const err = engine.validate(view.state, full);
      if (err) return err;
      const seq = view.seq + 1;
      setSendError(null);
      setOutstanding((n) => n + 1);
      const gen = generation.current;
      chain.current = chain.current
        .then(async () => {
          // An earlier order was refused: this one was built on it and is moot.
          if (generation.current !== gen) return;
          try {
            const res = await api('submitAction', { matchId, seq, action: full });
            if (res.step) {
              const step = res.step;
              setSteps((cur) => (cur.has(step.seq) ? cur : new Map(cur).set(step.seq, { side: mySide, events: JSON.parse(step.eventsJson) as LoggedEvent[] })));
              takeView({ seq: step.seq, state: JSON.parse(step.stateJson) as GameState });
            }
          } catch (e) {
            generation.current++;
            setSendError(errorOf(e).message);
          }
        })
        .finally(() => setOutstanding((n) => n - 1));
      return null;
    },
    [engine, view, mySide, matchId, withSide, takeView],
  );

  const undo = useCallback(() => {}, []);
  const empty = useMemo(() => engine.initialState({ scenarioId: scenario.id, sides: scenario.sides.map((s) => s.side), attacker: scenario.firstSide, seed: 'view' }), [engine, scenario]);

  return {
    engine,
    state: state ?? empty,
    log,
    act,
    check,
    undo,
    canUndo: false,
    actionCount: view?.seq ?? 0,
    replayError: null,
    mySide,
    ready: view !== null,
    sending: outstanding > 0,
    sendError,
    loadError,
    lastSide,
    ...extras,
  };
}
