import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { ScenarioDef } from '@asl/rules';
import { paceDef, type MatchDoc } from '@asl/platform';
import { useMember } from '../auth/AuthProvider';
import { api, errorOf } from '../firebase';
import { Briefing } from '../panels/Briefing';
import { Emblem } from '../ui/Emblem';
import { aarPath } from '../aar/links';

/**
 * An online match without a board to show: a seat is still open, or the match ended without
 * the engine reaching a result (a concession or a withdrawal).
 */
export function WaitingRoom({ matchId, match, scenario }: { matchId: string; match: MatchDoc; scenario: ScenarioDef }) {
  const { user } = useMember();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mine = match.playerIds.includes(user.uid);
  const sides = scenario.sides.map((s) => ({ ...s, seat: match.seats[s.side] ?? null }));
  const sideName = (s: string | null) => (s ? (scenario.sides.find((x) => x.side === s)?.name ?? s) : '');
  const open = match.status === 'open';

  const leave = async () => {
    setBusy(true);
    try {
      await api('leaveMatch', { matchId });
      navigate('/app');
    } catch (e) {
      setError(errorOf(e).message);
      setBusy(false);
    }
  };

  const outcome = () => {
    if (match.result) return `${match.result.winner ? `${sideName(match.result.winner)} victory` : 'Draw'} · ${match.result.reason}`;
    if (match.status === 'cancelled') return 'The open seat was withdrawn.';
    if (match.status === 'abandoned') return 'Abandoned.';
    return null;
  };

  return (
    <div className="lobby">
      <div className="lobby-inner">
        <header className="lobby-head">
          <Link to="/app" className="brand-link">
            <Emblem />
          </Link>
          <div>
            <h1>
              {open ? 'WAITING' : 'ONLINE'} <span>MATCH</span>
            </h1>
            <p>{scenario.title}</p>
          </div>
          <span className="spacer" />
          <Link to="/app" className="btn ghost">
            ← Lobby
          </Link>
        </header>
        <div className="lobby-grid">
          <section className="card">
            <h2>Table</h2>
            {open && match.randomSides && match.host ? (
              <div className="seat-list">
                <div className="seat side-neutral">
                  <span className="plate-name">{sides.map((s) => s.name).join(' or ')}</span>
                  <Link to={`/app/profile/${match.host.uid}`}>{match.host.displayName}</Link>
                  <span className="muted small">Sides drawn by lot when the opponent arrives</span>
                </div>
                <div className="seat side-neutral">
                  <span className="plate-name">{sides.map((s) => s.name).join(' or ')}</span>
                  <span className="muted">open seat · waiting for an opponent</span>
                </div>
              </div>
            ) : (
              <div className="seat-list">
                {sides.map((s) => (
                  <div key={s.side} className={`seat side-${s.side}`}>
                    <span className="plate-name">{s.name}</span>
                    {s.seat ? <Link to={`/app/profile/${s.seat.uid}`}>{s.seat.displayName}</Link> : <span className="muted">open seat · waiting for an opponent</span>}
                  </div>
                ))}
              </div>
            )}
            <div className="soon">
              {open ? (
                <>
                  <h3>Waiting for an opponent</h3>
                  <p className="muted small">
                    Clock: <b>{paceDef(match.pace).name}</b> · {paceDef(match.pace).blurb}. The board opens for both players the moment someone takes the empty seat. You can go
                    back to the lobby; the seat stays posted.
                  </p>
                </>
              ) : (
                <>
                  <h3>Match over</h3>
                  <p className="muted small">{outcome()}</p>
                  {match.result && (match.visibility ?? 'public') === 'public' && (
                    <div className="buttons waiting-aar">
                      <Link to={aarPath(matchId)} className="btn">
                        After action report
                      </Link>
                    </div>
                  )}
                </>
              )}
            </div>
            {mine && open && (
              <div className="buttons">
                <button className="ghost" disabled={busy} onClick={leave}>
                  Withdraw the open seat
                </button>
              </div>
            )}
            {error && <p className="warn">{error}</p>}
          </section>
          <section className="card briefing">
            <h2>Mission briefing</h2>
            <Briefing scenario={scenario} balance={match.balance} />
          </section>
        </div>
      </div>
    </div>
  );
}
