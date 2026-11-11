import { useState } from 'react';
import { SideBadge } from '../lobby-v2/SideBadge';
import { Link, useNavigate } from 'react-router';
import { COMPUTER_NAME, formatLeft, type MatchDoc } from '@asl/platform';
import { useMember } from '../auth/AuthProvider';
import { api, errorOf } from '../firebase';
import { PHASE_NAME } from '../game/describe';
import { matchOutdated, scenarioById } from '../match/scenarios';
import { Modal } from '../ui/Modal';
import { ago, toDate, useNow } from '../ui/time';
import type { MatchRow } from './useMatches';
import { ScenarioLink } from '../lobby-v2/ScenarioLink';

interface Props {
  rows: MatchRow[];
  empty: string;
  error?: string | null;
}

/** A list of matches with whatever each one lets the viewer do: resume, join, abandon. */
export function MatchList({ rows, empty, error }: Props) {
  if (error) return <p className="warn small">{error}</p>;
  if (!rows.length) return <p className="muted small">{empty}</p>;
  return (
    <ul className="match-list">
      {rows.map((r) => (
        <MatchItem key={r.id} id={r.id} match={r.match} />
      ))}
    </ul>
  );
}

function MatchItem({ id, match }: { id: string; match: MatchDoc }) {
  const { user, profile } = useMember();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The ending asked about, while its in-app confirmation is open. */
  const [ask, setAsk] = useState<'abandon' | 'outdated' | null>(null);
  const scenario = scenarioById(match.scenarioId);
  const sideName = (s: string) => scenario?.sides.find((x) => x.side === s)?.name ?? s;
  const mine = match.playerIds.includes(user.uid);
  const [code, ...rest] = match.scenarioTitle.split(' ');
  const seats = Object.entries(match.seats);
  const open = match.status === 'open';
  const outdated = mine && matchOutdated(match);
  const now = useNow(match.mode === 'online' && match.status === 'active' ? 1000 : 60_000);
  const dueAt = toDate(match.deadline?.at)?.getTime();
  const left = match.status === 'active' && dueAt !== undefined ? dueAt - now : null;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setAsk(null);
    } catch (e) {
      setError(errorOf(e).message);
    } finally {
      setBusy(false);
    }
  };

  const status = () => {
    if (match.result) {
      const winner = match.result.winner ? `${sideName(match.result.winner)} victory` : 'Draw';
      return `${winner} · ${match.result.reason}${match.result.eloDelta ? ` · ±${match.result.eloDelta}` : ''}`;
    }
    if (open) return 'Open seat · waiting for an opponent';
    if (match.status === 'abandoned') return 'Abandoned';
    if (match.status === 'cancelled') return 'Withdrawn';
    if (outdated) return 'Recorded under older rules · cannot be resumed';
    const s = match.summary;
    const where = s.phase === 'setup' ? 'Setting up' : `Turn ${s.turn} · ${PHASE_NAME[s.phase] ?? s.phase} · ${sideName(s.attacker)} attacking`;
    const clock = left === null ? '' : left <= 0 ? ' · out of time' : ` · ${formatLeft(left)} left`;
    if (match.mode === 'online' && s.toMove && !yourMove) return `${where} · waiting for ${match.seats[s.toMove]?.displayName ?? sideName(s.toMove)}${clock}`;
    return `${where}${clock}`;
  };
  const yourMove = match.mode === 'online' && match.status === 'active' && !!match.summary.toMove && match.seats[match.summary.toMove]?.uid === user.uid;

  return (
    <li className={`match-item ${open ? 'open' : ''} ${yourMove ? 'your-move' : ''}`}>
      <div className="match-main">
        <span className="code">
          <ScenarioLink scenarioId={match.scenarioId} balance={match.balance}>{code} <span style={{ fontWeight: 400 }}>{rest.join(' ')}</span></ScenarioLink>
        </span>
        <span className="mode-chip">{match.mode === 'hotseat' ? 'Hotseat' : match.mode === 'online' ? 'Online' : COMPUTER_NAME}</span>
        {yourMove && <span className="mode-chip your-move">Your move</span>}
        <span className="sub">{status()}</span>
        <span className="players">
          {match.mode === 'hotseat' ? (
            <Link to={`/app/profile/${match.createdBy}`}>{match.seats[seats[0]![0]]?.displayName}</Link>
          ) : match.mode === 'computer' ? (
            <span>
              <Link to={`/app/profile/${match.createdBy}`}>{match.seats[seats.find(([s]) => s !== match.computer?.side)?.[0] ?? '']?.displayName}</Link>
              <span className="muted"> vs </span>
              <span className={`side-${match.computer?.side}`}>{COMPUTER_NAME} <SideBadge scenario={scenario} side={match.computer?.side ?? ''} /></span>
            </span>
          ) : open && match.randomSides && match.host ? (
            <span>
              <Link to={`/app/profile/${match.host.uid}`}>{match.host.displayName}</Link>
              <span className="muted"> vs </span>
              <em className="muted">open</em> <small className="muted">(sides drawn by lot)</small>
            </span>
          ) : (
            seats.map(([side, seat], i) => (
              <span key={side}>
                {i > 0 && <span className="muted"> vs </span>}
                <span className={`side-${side}`}>
                  {seat ? <Link to={`/app/profile/${seat.uid}`}>{seat.displayName}</Link> : <em className="muted">open</em>} <SideBadge scenario={scenario} side={side} />
                </span>
              </span>
            ))
          )}
        </span>
        <span className="muted small">{ago(match.completedAt ?? match.updatedAt)}</span>
      </div>
      <div className="match-actions">
        {mine && (match.status === 'active' || open) && (
          <button className="primary" onClick={() => navigate(`/app/match/${id}`)}>
            {match.mode === 'hotseat' || match.mode === 'computer' ? 'Resume' : 'Open'}
          </button>
        )}
        {!mine && open && (
          <button className="primary" disabled={busy || !!profile.activeMatchId} title={profile.activeMatchId ? 'Finish your current match first' : undefined} onClick={() => run(() => api('joinOpenMatch', { matchId: id }).then(() => navigate(`/app/match/${id}`)))}>
            Join
          </button>
        )}
        {!mine && match.status === 'active' && (
          <Link to={`/app/match/${id}`} className="btn ghost">
            View
          </Link>
        )}
        {mine && (match.mode === 'hotseat' || match.mode === 'computer') && match.status === 'active' && (
          <button className="ghost" disabled={busy} onClick={() => { setError(null); setAsk('abandon'); }}>
            Abandon
          </button>
        )}
        {mine && match.mode === 'online' && outdated && (
          <button className="ghost" disabled={busy} title="The rules changed since this match was recorded; it cannot be resumed. Ending it counts for nothing." onClick={() => { setError(null); setAsk('outdated'); }}>
            End match
          </button>
        )}
        {mine && open && (
          <button className="ghost" disabled={busy} onClick={() => run(() => api('leaveMatch', { matchId: id }))}>
            Withdraw
          </button>
        )}
      </div>
      {error && !ask && <p className="warn small">{error}</p>}
      {ask && (
        <Modal title={ask === 'abandon' ? 'Abandon this game?' : 'End this match?'} kicker={match.scenarioTitle} onClose={busy ? undefined : () => setAsk(null)}>
          <p>{ask === 'abandon' ? 'It cannot be resumed.' : 'It was recorded under older rules and cannot be resumed. Nobody wins or loses.'}</p>
          {error && <p className="warn">{error}</p>}
          <div className="buttons">
            <button className="ghost" disabled={busy} onClick={() => setAsk(null)}>
              {ask === 'abandon' ? 'Keep it' : 'Cancel'}
            </button>
            <button className="primary" disabled={busy} onClick={() => run(() => api('leaveMatch', ask === 'abandon' ? { matchId: id } : { matchId: id, reason: 'ruleset' }))}>
              {ask === 'abandon' ? 'Abandon' : 'End match'}
            </button>
          </div>
        </Modal>
      )}
    </li>
  );
}
