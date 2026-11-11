import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, orderBy, query } from 'firebase/firestore';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router';
import type { Action } from '@asl/engine';
import type { ScenarioDef } from '@asl/rules';
import { COL, type MatchActionDoc, type MatchDoc } from '@asl/platform';
import { useAuth } from '../auth/AuthProvider';
import { loginPath } from '../aar/links';
import { db } from '../firebase';
import { GameScreen } from '../GameScreen';
import { useLocalGame } from '../game/session';
import { useOnlineGame } from '../game/onlineSession';
import { matchScenario } from './scenarios';

export function PublicReplay() {
  const { id } = useParams<{ id: string }>();
  const auth = useAuth();
  const location = useLocation();
  const [match, setMatch] = useState<MatchDoc | null | undefined>(undefined);
  const [scenario, setScenario] = useState<ScenarioDef | null>(null);
  const [actions, setActions] = useState<Action[]>([]);
  const [cursor, setCursor] = useState(0);
  useEffect(() => {
    if (!id) return;
    return onSnapshot(doc(db, COL.matches, id), (snap) => {
      const value = snap.data() as MatchDoc | undefined;
      setMatch(value ?? null);
      setScenario(value ? matchScenario(value.scenarioId, value.balance) ?? null : null);
    }, () => setMatch(null));
  }, [id]);
  useEffect(() => {
    if (!id || !match) return;
    // A live views-model match keeps its recording closed (the rules refuse the read); it opens when the match ends.
    if (match.model === 'views' && match.status === 'active') return;
    return onSnapshot(query(collection(db, COL.matches, id, COL.actions), orderBy('seq')), (snap) => {
      const next = snap.docs.map((d) => JSON.parse((d.data() as MatchActionDoc).json) as Action);
      setActions(next); setCursor(next.length);
    });
  }, [id, match]);
  // Reading a report is open to all; replaying the recording asks for an account.
  if (auth.status === 'signed-out') return <Navigate to={loginPath(location.pathname)} replace />;
  if (match === undefined || auth.status === 'loading') return <div className="gate"><div className="gate-card"><p>Reading the recording…</p></div></div>;
  if (!match || !scenario || match.visibility !== 'public') return <div className="gate"><div className="gate-card"><h1>Replay unavailable</h1><p>This match is private or no longer exists.</p><Link to="/" className="btn">Open ASL</Link></div></div>;
  // A live match under the views model keeps its recording closed: watchers follow the public view of the position.
  if (match.model === 'views' && match.status === 'active') return <LiveBoard matchId={match && id ? id : ''} match={match} scenario={scenario} />;
  return <ReplayBoard key={cursor} matchId={id ?? ''} match={match} scenario={scenario} actions={actions.slice(0, cursor)} cursor={cursor} total={actions.length} onCursor={setCursor} />;
}

function LiveBoard({ matchId, match, scenario }: { matchId: string; match: MatchDoc; scenario: ScenarioDef }) {
  const navigate = useNavigate();
  const live = useOnlineGame(matchId, scenario, null);
  if (live.loadError) return <div className="gate"><div className="gate-card"><h1>Replay unavailable</h1><p>{live.loadError}</p></div></div>;
  if (!live.ready) return <div className="gate"><div className="gate-card"><p>Reading the position…</p></div></div>;
  const session = { ...live, act: () => 'You are watching this match', check: () => 'You are watching this match' };
  return <><GameScreen scenario={scenario} session={session} matchId={undefined} viewKey={`watch.${matchId}`} onQuit={() => navigate(-1)} /><div className="replay-controls"><div><b>{match.scenarioTitle}</b><span>Live · what both players can see</span></div></div></>;
}

function ReplayBoard({ matchId, match, scenario, actions, cursor, total, onCursor }: { matchId: string; match: MatchDoc; scenario: ScenarioDef; actions: Action[]; cursor: number; total: number; onCursor(value: number): void }) {
  const navigate = useNavigate();
  // A finished match has its seed on the document (written back when it ended); the empty string never reaches a live one.
  const base = useLocalGame(scenario, match.seed ?? '', { initialActions: actions });
  const session = { ...base, mySide: null, act: () => 'Replay is read-only', check: () => 'Replay is read-only', undo: () => {}, canUndo: false };
  return <><GameScreen scenario={scenario} session={session} matchId={undefined} viewKey={`watch.${matchId}`} onQuit={() => navigate(-1)} /><div className="replay-controls"><div><b>{match.scenarioTitle}</b><span>{match.result ? match.result.winner ? `${match.result.winner} victory · ${match.result.reason}` : `Draw · ${match.result.reason}` : 'Live recording'}</span></div><button onClick={() => onCursor(0)}>⏮</button><button onClick={() => onCursor(Math.max(0, cursor - 1))}>◀</button><input aria-label="Replay position" type="range" min="0" max={total} value={cursor} onChange={(e) => onCursor(Number(e.target.value))} /><button onClick={() => onCursor(Math.min(total, cursor + 1))}>▶</button><button onClick={() => onCursor(total)}>⏭</button><small>{cursor} / {total}</small></div></>;
}
