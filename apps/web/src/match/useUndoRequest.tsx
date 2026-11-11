import { useEffect, useState, type ReactNode } from 'react';
import type { MatchDoc } from '@asl/platform';
import { api, errorOf } from '../firebase';
import type { OnlineSession } from '../game/onlineSession';
import { Modal } from '../ui/Modal';

/**
 * Online undo: a player asks to take back their own last action and the opponent allows or
 * refuses it. A refusal stands until another action is played (or an allowed undo goes back to
 * the refused action). Returns what the board's Undo button needs and the dialogs to show.
 */
export function useUndoRequest(matchId: string, match: MatchDoc, session: OnlineSession, opponentName: string): { canUndo: boolean; askUndo(): void; dialogs: ReactNode } {
  const mySide = session.mySide;
  const undo = match.status === 'active' ? (match.undo ?? null) : null;
  const [asking, setAsking] = useState<'confirm' | 'busy' | null>(null);
  /** The id of this player's request whose answer this browser is waiting to show. */
  const [watching, setWatching] = useState<string | null>(null);
  const [answering, setAnswering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A request still pending from before this board opened is followed like a fresh one.
  useEffect(() => {
    if (undo?.status === 'pending' && undo.side === mySide && watching === null) setWatching(undo.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undo?.id, undo?.status]);

  const refused = undo?.status === 'refused' && undo.side === mySide && undo.seq === match.actionCount;
  const canUndo =
    !!mySide &&
    match.status === 'active' &&
    !session.state.result &&
    !session.sending &&
    session.actionCount === match.actionCount &&
    session.lastSide === mySide &&
    undo?.status !== 'pending' &&
    !refused;

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      return true;
    } catch (e) {
      setError(errorOf(e).message);
      return false;
    }
  };

  const request = async () => {
    setAsking('busy');
    await run(async () => {
      const { id } = await api('requestUndo', { matchId, seq: match.actionCount });
      setWatching(id);
    });
    setAsking(null);
  };
  const cancel = () => {
    setWatching(null);
    void run(() => api('cancelUndo', { matchId }));
  };
  const answer = async (allow: boolean) => {
    if (!undo) return;
    setAnswering(true);
    await run(() => api('answerUndo', { matchId, id: undo.id, allow }));
    setAnswering(false);
  };

  const mine = watching !== null && undo?.id === watching ? undo : null;
  let dialog: ReactNode = null;
  if (asking) {
    dialog = (
      <Modal title="Ask to undo?" kicker="Undo" onClose={asking === 'confirm' ? () => setAsking(null) : undefined}>
        <p>Ask your opponent to undo the last action?</p>
        <div className="buttons">
          <button className="ghost" disabled={asking === 'busy'} onClick={() => setAsking(null)}>
            Cancel
          </button>
          <button className="primary" disabled={asking === 'busy'} onClick={request}>
            Ask
          </button>
        </div>
      </Modal>
    );
  } else if (watching !== null && mine?.status === 'pending') {
    dialog = (
      <Modal title="Waiting for opponent to decide" kicker="Undo">
        <p>{opponentName} is deciding whether to allow the undo. You can cancel the request and carry on with your turn.</p>
        <div className="buttons">
          <button className="ghost" onClick={cancel}>
            Cancel request
          </button>
        </div>
      </Modal>
    );
  } else if (watching !== null) {
    const text =
      mine?.status === 'allowed'
        ? `${opponentName} allowed the undo. Your last action has been taken back.`
        : mine?.status === 'refused'
          ? `${opponentName} refused the undo. The action stands, and cannot be asked about again until another action is played.`
          : 'The game moved on before your opponent answered. The action stands.';
    dialog = (
      <Modal title={mine?.status === 'allowed' ? 'Undo allowed' : 'Undo refused'} kicker="Undo" onClose={() => setWatching(null)}>
        <p>{text}</p>
        <div className="buttons">
          <button className="primary" onClick={() => setWatching(null)}>
            OK
          </button>
        </div>
      </Modal>
    );
  } else if (mySide && undo?.status === 'pending' && undo.side !== mySide) {
    dialog = (
      <Modal title={`Allow ${opponentName} to undo their last action?`} kicker="Undo">
        <p>The action is taken back and {opponentName} plays on from before it. The dice stay as they were: playing it again gives the same rolls.</p>
        <div className="buttons">
          <button className="ghost" disabled={answering} onClick={() => answer(false)}>
            Refuse
          </button>
          <button className="primary" disabled={answering} onClick={() => answer(true)}>
            Allow
          </button>
        </div>
      </Modal>
    );
  }

  return {
    canUndo,
    askUndo: () => setAsking('confirm'),
    dialogs: (
      <>
        {dialog}
        {error && <div className="save-warning">{error}</div>}
      </>
    ),
  };
}
