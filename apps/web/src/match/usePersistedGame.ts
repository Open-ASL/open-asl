import { useCallback, useEffect, useRef, useState } from 'react';
import { collection, deleteDoc, doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import type { Action, Engine, GameState } from '@asl/engine';
import type { ScenarioDef } from '@asl/rules';
import { COL, actionDocId, type MatchDoc } from '@asl/platform';
import { api, db, errorOf } from '../firebase';
import { useLocalGame, type Session } from '../game/session';
import { RecordingTracker } from './recordingSync';

/**
 * Why this board can no longer be played: the recording was appended to or undone from another
 * device (or a write of ours was refused, which comes to the same thing), or the match was ended
 * elsewhere while this board was open.
 */
export type HotseatLock = 'moved' | 'ended';

const LOCKED = 'This board is out of step with the saved game.';

/**
 * A hotseat game recorded to its match document as it is played: each action is appended to
 * the actions subcollection and the lobby summary is kept current. When the engine declares a
 * result the server is asked to replay the recording and score it.
 */
export function usePersistedGame(matchId: string, match: MatchDoc, scenario: ScenarioDef, initialActions: Action[], opts: { meta?: (action: Action) => Record<string, unknown> | undefined } = {}) {
  const meta = useRef(opts.meta);
  meta.current = opts.meta;
  const matchRef = doc(db, COL.matches, matchId);
  const actions = collection(matchRef, COL.actions);
  // Writes are chained so the completion call never races the last append.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const [writeError, setWriteError] = useState<string | null>(null);
  const enqueue = useCallback((work: () => Promise<unknown>) => {
    queue.current = queue.current.then(work).catch((e) => setWriteError(errorOf(e).message));
  }, []);

  const engine = useRef<Engine | null>(null);
  const summary = (s: GameState) => ({ turn: s.turn, phase: s.phase, attacker: s.attacker, seq: s.seq, toMove: s.result ? null : (engine.current?.currentDecision(s)?.owner ?? null) });

  const onAct = useCallback(
    (seq: number, action: Action, state: GameState) =>
      enqueue(() => {
        tracker.current.wrote(seq);
        const b = writeBatch(db);
        b.set(doc(actions, actionDocId(seq)), { seq, json: JSON.stringify(action), at: serverTimestamp(), ...meta.current?.(action) });
        b.update(matchRef, { summary: summary(state), actionCount: seq, updatedAt: serverTimestamp() });
        return b.commit();
      }),
    // The refs are derived from matchId.
    [matchId, enqueue],
  );
  const onUndo = useCallback(
    (seq: number, state: GameState) =>
      enqueue(async () => {
        await deleteDoc(doc(actions, actionDocId(seq)));
        tracker.current.wrote(seq - 1);
        const b = writeBatch(db);
        b.update(matchRef, { summary: summary(state), actionCount: seq - 1, updatedAt: serverTimestamp() });
        await b.commit();
      }),
    [matchId, enqueue],
  );

  // Hotseat and computer games always carry their seed (their owner's browser plays them).
  const played: Session = useLocalGame(scenario, match.seed ?? '', { initialActions, onAct, onUndo });
  engine.current = played.engine;

  // The recording was read once, when the board opened; from then on every count the match
  // document takes should be one this browser wrote. Any other count means another device has
  // played (or undone) since, and nothing more may be written from here.
  const tracker = useRef(new RecordingTracker(match.actionCount));
  const [lock, setLock] = useState<HotseatLock | null>(null);
  useEffect(() => {
    if (!tracker.current.observe(match.actionCount)) setLock('moved');
  }, [match.actionCount]);
  const endedElsewhere = match.status !== 'active' && !played.state.result;
  useEffect(() => {
    if (endedElsewhere) setLock('ended');
  }, [endedElsewhere]);
  const session: Session = lock ? { ...played, act: () => LOCKED, check: () => LOCKED, applyActions: undefined, undo: () => {}, canUndo: false } : played;

  // Report the finished game once; the server replays the recording and awards the result.
  const reported = useRef(false);
  const [scored, setScored] = useState<'pending' | 'done' | string>('pending');
  const finished = !!session.state.result;
  useEffect(() => {
    if (!finished || lock || reported.current || match.status !== 'active') return;
    reported.current = true;
    enqueue(() => api('completeHotseatMatch', { matchId }).then(() => setScored('done')).catch((e) => setScored(errorOf(e).message)));
  }, [finished, lock, match.status, matchId, enqueue]);

  return { session, writeError, scored, lock };
}
