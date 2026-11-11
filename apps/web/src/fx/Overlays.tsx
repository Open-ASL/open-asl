import { useNavigate } from 'react-router';
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
export function YourCall({ side, who, title, text, action }: { side: SideId; who: string | null; title: string; text: string; action?: { label: string; onClick(): void; hint?: string } | null }) {
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
  sideName(s: SideId): string;
  onLobby(): void;
  onReview(): void;
  aar?: AarCue | null;
}

export function GameOver({ winner, reason, sideName, onLobby, onReview, aar = null }: GameOverProps) {
  const navigate = useNavigate();
  return (
    <div className={`gameover ${winner ? `side-${winner}` : ''}`}>
      <div className="box">
        <div className="kicker">{winner ? 'Victory' : 'Stalemate'}</div>
        <div className="big">{winner ? sideName(winner) : 'Draw'}</div>
        <div className="reason">{reason}</div>
        <div className="buttons">
          <button className="primary" onClick={onLobby}>
            Back to lobby
          </button>
          {aar?.kind === 'link' && <button onClick={() => navigate(aar.href)}>After action report</button>}
          {aar?.kind === 'pending' && <button disabled>Preparing report…</button>}
          <button onClick={onReview}>Review the board</button>
        </div>
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
