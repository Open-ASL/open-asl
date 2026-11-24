import { useState } from 'react';
import { useNavigate } from 'react-router';
import { levelName, medalById, type MatchAwards } from '@asl/platform';
import type { SideId } from '@asl/engine';
import type { Callout } from './useGameFx';

/** Banner dropped from the top when a decision passes to the other player mid-phase. */
export function CalloutBanner({ callout }: { callout: Callout }) {
  return (
    <div key={callout.id} className={`callout side-${callout.side}`}>
      <span className="cw">{callout.title}</span>
      <span className="ct">{callout.text}</span>
    </div>
  );
}

/**
 * A standing cue while a mid-phase decision waits on this player (Defensive First Fire, a ROF choice,
 * a Motion facing): it stays, pulsing, until the call is answered. The dropped banner above it lasts
 * three seconds and was easy to miss; this is what a player looks for when unsure whose go it is.
 */
export function YourCall({ side, who, title, text, action, onDismiss }: { side: SideId; who: string | null; title: string; text: string; action?: { label: string; onClick(): void; hint?: string } | null; onDismiss?(): void }) {
  return (
    <div className={`your-call side-${side}`} role="status" aria-live="polite">
      <span className="yc-kicker">{who ? `${who}: your call` : 'Your call'}</span>
      <span className="yc-body">
        <span className="yc-title">{title}</span>
        <span className="yc-text">{text}</span>
      </span>
      {action && (
        <button className="primary" onClick={action.onClick} title={action.hint}>
          {action.label}
        </button>
      )}
      {onDismiss && (
        <button className="ghost yc-close" onClick={onDismiss} title="Hide this until the next phase. Pass stays in the top bar, on the action wheel and in the orders panel" aria-label="Hide">
          ✕
        </button>
      )}
    </div>
  );
}

/**
 * The after action report's place on the victory screen: a link once the server has written
 * it, a disabled button while it is on its way, or a note on why this game gets none.
 */
export type AarCue = { kind: 'link'; href: string } | { kind: 'pending' } | { kind: 'none'; note: string };

interface GameOverProps {
  winner: SideId | null;
  reason: string;
  /** The winner's victory conditions that decided the game, as the card words them. */
  decidedBy?: string[];
  sideName(s: SideId): string;
  onLobby(): void;
  onReview(): void;
  aar?: AarCue | null;
  /** What the match did for this player's decorations, once the server has scored it. */
  awards?: MatchAwards | null;
}

export function GameOver({ winner, reason, decidedBy = [], sideName, onLobby, onReview, aar = null, awards = null }: GameOverProps) {
  const navigate = useNavigate();
  return (
    <div className={`gameover ${winner ? `side-${winner}` : ''}`}>
      <div className="box">
        <div className="kicker">{winner ? 'Victory' : 'Stalemate'}</div>
        <div className="big">{winner ? sideName(winner) : 'Draw'}</div>
        <div className="reason">{reason}</div>
        {decidedBy.length > 0 && (
          <div className="decided">
            <span className="decided-kicker">Decided by</span>
            <ul>
              {decidedBy.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="buttons">
          <button className="primary" onClick={onLobby}>
            Back to lobby
          </button>
          {aar?.kind === 'link' && <button onClick={() => navigate(aar.href)}>After action report</button>}
          {aar?.kind === 'pending' && <button disabled>Preparing report…</button>}
          <button onClick={onReview}>Review the board</button>
        </div>
        {awards && (awards.earned.length > 0 || awards.advanced.length > 0) && <MatchAwardsNote awards={awards} />}
        {aar?.kind === 'none' && (
          <div className="no-aar">
            <svg viewBox="0 0 24 24" aria-hidden>
              <path d="M12 3 4 7v5c0 5 3.5 8 8 9 4.5-1 8-4 8-9V7z" />
              <path d="M9 12h6M12 9v6" />
            </svg>
            <span>
              <b>No after action report</b>
              {aar.note}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

const ADVANCED_SHOWN = 5;

/** The decorations a finished match earned or raised, and those it moved closer. */
function MatchAwardsNote({ awards }: { awards: MatchAwards }) {
  const [all, setAll] = useState(false);
  const advanced = all ? awards.advanced : awards.advanced.slice(0, ADVANCED_SHOWN);
  return (
    <div className="gameover-awards">
      {awards.earned.map(({ id, level }) => {
        const m = medalById(id);
        return (
          <div key={id} className="gameover-earned">
            <span className="gameover-earned-kicker">{level > 1 ? (m.classes ? 'Raised' : 'Further award') : 'Decorated'}</span>
            <b>{levelName(m, level)}</b>
          </div>
        );
      })}
      {advanced.length > 0 && (
        <ul className="gameover-advanced">
          {advanced.map(({ id, value, goal }) => (
            <li key={id}>
              <span>{medalById(id).name}</span>
              <span className="xp-bar"><span style={{ width: `${Math.round(Math.min(1, value / goal) * 100)}%` }} /></span>
              <small>{Math.min(value, goal)} / {goal}</small>
            </li>
          ))}
        </ul>
      )}
      {awards.advanced.length > ADVANCED_SHOWN && <button type="button" className="link" onClick={() => setAll(!all)}>{all ? 'Fewer' : `${awards.advanced.length - ADVANCED_SHOWN} more moved closer`}</button>}
    </div>
  );
}
