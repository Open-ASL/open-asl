import { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, orderBy, query } from 'firebase/firestore';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router';
import type { Action } from '@asl/engine';
import type { ScenarioDef } from '@asl/rules';
import { COL, type MatchActionDoc, type MatchDoc } from '@asl/platform';
import { useAuth } from '../auth/AuthProvider';
import { loginPath } from '../aar/links';
import { db } from '../firebase';
import { GameScreen } from '../GameScreen';
import { seatNames } from './seatNames';
import { useOnlineGame } from '../game/onlineSession';
import { matchScenario } from './scenarios';
import { ReplayBoard } from './ReplayBoard';

export function PublicReplay() {
  const { id } = useParams<{ id: string }>();
  const auth = useAuth();
  const location = useLocation();
  const [match, setMatch] = useState<MatchDoc | null | undefined>(undefined);
  const [actions, setActions] = useState<Action[] | null>(null);
  useEffect(() => {
    if (!id) return;
    return onSnapshot(doc(db, COL.matches, id), (snap) => {
      const value = snap.data() as MatchDoc | undefined;
      setMatch(value ?? null);
    }, () => setMatch(null));
  }, [id]);
  // Built once per scenario and balance, not at every update of the match document (a replay is rebuilt from it).
  const balance = JSON.stringify(match?.balance ?? null);
  const scenario: ScenarioDef | null = useMemo(() => (match ? matchScenario(match.scenarioId, match.balance) ?? null : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [match?.scenarioId, balance]);
  const closed = !match || (match.model === 'views' && match.status === 'active');
  useEffect(() => {
    // A live views-model match keeps its recording closed (the rules refuse the read); it opens when the match ends.
    if (!id || closed) return;
    return onSnapshot(query(collection(db, COL.matches, id, COL.actions), orderBy('seq')), (snap) => {
      setActions(snap.docs.map((d) => JSON.parse((d.data() as MatchActionDoc).json) as Action));
    });
  }, [id, closed]);
  // Reading a report is open to all; replaying the recording asks for an account.
  if (auth.status === 'signed-out') return <Navigate to={loginPath(location.pathname)} replace />;
  if (match === undefined || auth.status === 'loading') return <div className="gate"><div className="gate-card"><p>Reading the recording…</p></div></div>;
  if (!match || !scenario || match.visibility !== 'public') return <div className="gate"><div className="gate-card"><h1>Replay unavailable</h1><p>This match is private or no longer exists.</p><Link to="/" className="btn">Open ASL</Link></div></div>;
  // A live match under the views model keeps its recording closed: watchers follow the public view of the position.
  if (match.model === 'views' && match.status === 'active') return <LiveBoard matchId={match && id ? id : ''} match={match} scenario={scenario} />;
  if (!actions) return <div className="gate"><div className="gate-card"><p>Reading the recording…</p></div></div>;
  return <ReplayBoard matchId={id ?? ''} match={match} scenario={scenario} actions={actions} />;
}

function LiveBoard({ matchId, match, scenario }: { matchId: string; match: MatchDoc; scenario: ScenarioDef }) {
  const navigate = useNavigate();
  const live = useOnlineGame(matchId, scenario, null);
  if (live.loadError) return <div className="gate"><div className="gate-card"><h1>Replay unavailable</h1><p>{live.loadError}</p></div></div>;
  if (!live.ready) return <div className="gate"><div className="gate-card"><p>Reading the position…</p></div></div>;
  const session = { ...live, act: () => 'You are watching this match', check: () => 'You are watching this match' };
  return <><GameScreen scenario={scenario} players={seatNames(match)} session={session} matchId={undefined} viewKey={`watch.${matchId}`} onQuit={() => navigate(-1)} /><div className="replay-controls"><div className="replay-head"><div className="replay-title"><b>{match.scenarioTitle}</b><span>Live · what both players can see</span></div></div></div></>;
}
