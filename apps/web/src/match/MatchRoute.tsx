import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { collection, doc, getDocs, onSnapshot, orderBy, query } from 'firebase/firestore';
import type { Action } from '@asl/engine';
import type { ScenarioDef } from '@asl/rules';
import { COL, COMPUTER_AVAILABLE, COMPUTER_NAME, formatLeft, reachedOfficialProgress, type MatchActionDoc, type MatchDoc } from '@asl/platform';
import { useMember } from '../auth/AuthProvider';
import { Splash } from '../auth/RequireMember';
import { api, db, errorOf } from '../firebase';
import { GameScreen } from '../GameScreen';
import { useOnlineGame, type OnlineSession } from '../game/onlineSession';
import { useOnlineGameLegacy } from '../game/onlineSessionLegacy';
import { Modal } from '../ui/Modal';
import { toDate, useNow } from '../ui/time';
import { matchScenario } from './scenarios';
import { WaitingRoom } from './WaitingRoom';
import { aarPath } from '../aar/links';
import type { AarCue } from '../fx/Overlays';
import { useUndoRequest } from './useUndoRequest';
import { useDevFixture } from './useDevFixture';
import { type HotseatLock, usePersistedGame } from './usePersistedGame';
import { BOT_VERSION, type ComputerSpeed, useComputerOpponent } from '../ai';
import type { Session } from '../game/session';
import { ChatDock } from '../chat/ChatDock';
import { SUPPORT_NAME } from '../siteConfig';

type Loaded = { match: MatchDoc; scenario: ScenarioDef; actions: Action[] };

/** /app/match/:id — opens a match: the board for a hotseat or online game, the waiting room for an open seat. */
export function MatchRoute() {
  const { id } = useParams<{ id: string }>();
  const { user } = useMember();
  const [loaded, setLoaded] = useState<Loaded | { error: string } | null>(null);
  // Bumped to read the recording again (a hotseat board that fell behind another device).
  const [generation, setGeneration] = useState(0);
  const reload = () => {
    setLoaded(null);
    setGeneration((g) => g + 1);
  };

  useEffect(() => {
    if (!id) return;
    let first = true;
    const stop = onSnapshot(
      doc(db, COL.matches, id),
      async (snap) => {
        const match = snap.data() as MatchDoc | undefined;
        if (!match) return setLoaded({ error: 'No such match.' });
        const scenario = matchScenario(match.scenarioId, match.balance);
        if (!scenario) return setLoaded({ error: `Unknown scenario ${match.scenarioId}.` });
        if (first) {
          first = false;
          // A hotseat recording is read once; after that this browser is the one writing it.
          // An online game subscribes to its recording itself.
          const recorded = match.mode === 'hotseat' || match.mode === 'computer' ? await getDocs(query(collection(snap.ref, COL.actions), orderBy('seq'))) : null;
          const actions = recorded?.docs.map((d) => JSON.parse((d.data() as MatchActionDoc).json) as Action) ?? [];
          setLoaded({ match, scenario, actions });
        } else {
          setLoaded((l) => (l && 'match' in l ? { ...l, match } : l));
        }
      },
      (e) => setLoaded({ error: e.message }),
    );
    return stop;
  }, [id, generation]);

  if (!id || !loaded) return <Splash text="Unpacking the map…" />;
  if ('error' in loaded) return <Gate title="Match unavailable" text={loaded.error} />;
  if (loaded.match.mode === 'online') {
    if (loaded.match.status === 'open' || loaded.match.status === 'cancelled') return <WaitingRoom matchId={id} match={loaded.match} scenario={loaded.scenario} />;
    return <OnlineMatch matchId={id} match={loaded.match} scenario={loaded.scenario} />;
  }
  if (loaded.match.mode === 'computer') {
    if (!COMPUTER_AVAILABLE) return <Gate title="No computer opponent" text="This build of Open ASL has no computer opponent." />;
    if (loaded.match.createdBy !== user.uid) return <Gate title="Not your table" text={`Games against ${COMPUTER_NAME} are played on their owner's screen.`} />;
    return <ComputerMatch key={generation} matchId={id} match={loaded.match} scenario={loaded.scenario} actions={loaded.actions} onReload={reload} />;
  }
  if (loaded.match.createdBy !== user.uid) return <Gate title="Not your table" text="Hotseat games are played on their owner's screen." />;
  return <HotseatMatch key={generation} matchId={id} match={loaded.match} scenario={loaded.scenario} actions={loaded.actions} onReload={reload} />;
}

function Gate({ title, text, warn = true }: { title: string; text: string; warn?: boolean }) {
  return (
    <div className="gate">
      <div className="gate-card">
        <h1>{title}</h1>
        <p className={warn ? 'warn' : undefined}>{text}</p>
        <Link to="/app" className="btn">
          Back to the lobby
        </Link>
      </div>
    </div>
  );
}

const OLD_RULES = 'This game was saved by an earlier version of the rules and cannot be resumed.';
const PRIVATE_NOTE = 'This was a private game. Public games get a shareable report with casualties, dice luck and highlights.';

/**
 * What the victory screen says about the after action report: a private online or computer game
 * gets none; otherwise it is a link once the server has written it (the match is scored) and a
 * waiting button until then. Hotseat games always get one. When the server refused to score the
 * game (`failure`) no report is coming, and the screen says why instead of waiting for ever.
 */
function aarCue(matchId: string, match: MatchDoc, ready: boolean, failure: string | null = null): AarCue {
  if (match.mode !== 'hotseat' && (match.visibility ?? 'public') === 'private') return { kind: 'none', note: PRIVATE_NOTE };
  if (ready) return { kind: 'link', href: aarPath(matchId) };
  if (failure) return { kind: 'none', note: `The result was not recorded: ${failure.replace(/\.$/, '')}. ${SUPPORT_NAME ? `Tell us on ${SUPPORT_NAME} and we can restore it.` : 'The people who run this site can restore it.'}` };
  return { kind: 'pending' };
}

/** Why the server would not score a finished hotseat or computer game, or null while it is pending or done. */
const scoreFailure = (scored: string): string | null => (scored === 'pending' || scored === 'done' ? null : scored);

/**
 * The gate for a recording that no longer replays. A seated player can end the match here: it is
 * voided on the server (no result, no rating change, nothing counted against anyone).
 */
function OutdatedGate({ matchId, text, canEnd }: { matchId: string; text: string; canEnd: boolean }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('leaveMatch', { matchId, reason: 'ruleset' });
      navigate('/app');
    } catch (e) {
      setError(errorOf(e).message);
      setBusy(false);
    }
  };
  return (
    <div className="gate">
      <div className="gate-card">
        <h1>Recorded under older rules</h1>
        <p className="warn">{text}</p>
        {canEnd && <p>Either player can end it. It counts for nothing: no result, no rating change.</p>}
        {error && <p className="warn">{error}</p>}
        <div className="row">
          {canEnd && (
            <button className="primary" disabled={busy} onClick={end}>
              End this match
            </button>
          )}
          <Link to="/app" className="btn">
            Back to the lobby
          </Link>
        </div>
      </div>
    </div>
  );
}

function HotseatMatch({ matchId, match, scenario, actions, onReload }: { matchId: string; onReload(): void } & Loaded) {
  const navigate = useNavigate();
  const { session, writeError, scored, lock } = usePersistedGame(matchId, match, scenario, actions);
  // Development builds: `?fixture=<id>` starts the game at a dev fixture position.
  const fixtureError = useDevFixture(session);
  if (session.replayError) return <OutdatedGate matchId={matchId} text={`${session.replayError} ${OLD_RULES}`} canEnd={match.status === 'active'} />;
  return (
    <>
      <GameScreen scenario={scenario} session={session} matchId={matchId} onQuit={() => navigate('/app')} aar={aarCue(matchId, match, scored === 'done' || match.status === 'complete', scoreFailure(scored))} />
      {lock && <LockedBoard lock={lock} onReload={lock === 'moved' || match.result ? onReload : null} />}
      {fixtureError && <div className="save-warning">Dev fixture: {fixtureError}</div>}
      {!lock && (writeError || (scored !== 'pending' && scored !== 'done')) && <div className="save-warning">{writeError ? `Not saved: ${writeError}` : `Result not recorded: ${scored}`}</div>}
    </>
  );
}

/**
 * A game against the computer: recorded like a hotseat game, but the player commands only their
 * side, there is no undo (decisions stand, as online), and the computer answers its own decisions.
 */
function ComputerMatch({ matchId, match, scenario, actions, onReload }: { matchId: string; onReload(): void } & Loaded) {
  const navigate = useNavigate();
  const ai = match.computer ?? null;
  // The computer's moves are recorded with the bot's version and how long it thought.
  const thinkMs = useRef(0);
  const { session: played, writeError, scored, lock } = usePersistedGame(matchId, match, scenario, actions, {
    meta: (a) => (a.side === ai?.side ? { bot: { version: BOT_VERSION, ms: Math.round(thinkMs.current) } } : undefined),
  });
  const mySide = Object.keys(match.seats).find((s) => s !== ai?.side) ?? null;
  const [revealing, setRevealing] = useState(false);
  const [speed, setSpeed] = useState<ComputerSpeed>(() => {
    try {
      return (localStorage.getItem('asl.computerSpeed') as ComputerSpeed | null) ?? 'normal';
    } catch {
      return 'normal';
    }
  });
  const pickSpeed = (s: ComputerSpeed) => {
    setSpeed(s);
    try {
      localStorage.setItem('asl.computerSpeed', s);
    } catch {
      // A private window: the choice lasts this visit only.
    }
  };
  const computer = useComputerOpponent(played, match.scenarioId, match.balance, match.status === 'active' && !lock ? ai : null, { paused: revealing, speed, onMove: (ms) => (thinkMs.current = ms) });
  const session: Session = { ...played, mySide: match.status === 'active' ? mySide : null, undo: () => {}, canUndo: false, pings: computer.pings };
  if (session.replayError) return <OutdatedGate matchId={matchId} text={`${session.replayError} ${OLD_RULES}`} canEnd={match.status === 'active'} />;
  const sideName = (s: string | undefined) => (s ? (scenario.sides.find((x) => x.side === s)?.name ?? s) : '');
  const theirTurn = session.engine.currentDecision(session.state)?.owner === ai?.side;
  return (
    <>
      <GameScreen scenario={scenario} session={session} matchId={matchId} onQuit={() => navigate('/app')} onResolvingChange={setRevealing} slow={speed === 'slow'} aar={aarCue(matchId, match, scored === 'done' || match.status === 'complete', scoreFailure(scored))} />
      {!session.state.result && (
        <div className={`online-strip ${computer.thinking ? '' : 'mine'}`}>
          <span>
            <b className={`side-${mySide}`}>{sideName(mySide ?? undefined)}</b> vs {COMPUTER_NAME} <small className="muted">({sideName(ai?.side)})</small>
          </span>
          <span className="status">
            {theirTurn ? (computer.caption ? `${sideName(ai?.side)} ${computer.caption}` : `${COMPUTER_NAME} is thinking…`) : computer.caption ? `Your move · last: ${sideName(ai?.side)} ${computer.caption}` : 'Your move'}
          </span>
          <span className="seg small" title={`How fast ${COMPUTER_NAME}'s moves are played out`}>
            {(['slow', 'normal', 'fast'] as const).map((s) => (
              <button key={s} className={speed === s ? 'on' : ''} onClick={() => pickSpeed(s)}>
                {s === 'slow' ? 'Slow' : s === 'normal' ? 'Normal' : 'Fast'}
              </button>
            ))}
          </span>
        </div>
      )}
      {lock && <LockedBoard lock={lock} onReload={lock === 'moved' || match.result ? onReload : null} />}
      {!lock && computer.stalled && (
        <Modal title={`${COMPUTER_NAME} could not start`} kicker="Site updated">
          <p>Open ASL was updated since this page was loaded, and this page can no longer start {COMPUTER_NAME}. Reload the page to pick up the game where you left it.</p>
          <div className="buttons">
            <button className="primary" onClick={() => window.location.reload()}>
              Reload the page
            </button>
          </div>
        </Modal>
      )}
      {!lock && (writeError || (scored !== 'pending' && scored !== 'done')) && <div className="save-warning">{writeError ? `Not saved: ${writeError}` : `Result not recorded: ${scored}`}</div>}
    </>
  );
}

/**
 * A hotseat board that fell behind its recording: the game was played, undone or ended on
 * another screen since this one opened. Nothing more can be done here until the recording is
 * read again; moves made here after the other screen took over were refused and are gone. An
 * abandoned game has nothing to read again, so it offers only the lobby.
 */
function LockedBoard({ lock, onReload }: { lock: HotseatLock; onReload: (() => void) | null }) {
  const moved = lock === 'moved';
  return (
    <Modal title={moved ? 'Played elsewhere' : 'Ended elsewhere'} kicker="Out of step">
      <p>
        {moved
          ? 'This game has been played on another screen since this one was opened. This board no longer matches the saved game, and anything done here since then was not saved.'
          : 'This game was ended on another screen. This board no longer matches the saved game.'}
      </p>
      <div className="buttons">
        <Link to="/app" className="btn">
          Back to the lobby
        </Link>
        {onReload && (
          <button className="primary" onClick={onReload}>
            {moved ? 'Pick up the game' : 'See how it ended'}
          </button>
        )}
      </div>
    </Modal>
  );
}

/**
 * A seated player's board (or a spectator's) for an online match; the server referees every order. New matches
 * (`model: 'views'`) show the server's redacted view of the position; older ones still replay their open recording.
 */
function OnlineMatch({ matchId, match, scenario }: { matchId: string; match: MatchDoc; scenario: ScenarioDef }) {
  const { user } = useMember();
  const mySide = Object.entries(match.seats).find(([, s]) => s?.uid === user.uid)?.[0] ?? null;
  const seat = match.status === 'active' ? mySide : null;
  return match.model === 'views' ? <ViewsMatch matchId={matchId} match={match} scenario={scenario} mySide={mySide} seat={seat} /> : <LegacyMatch matchId={matchId} match={match} scenario={scenario} mySide={mySide} seat={seat} />;
}

function ViewsMatch({ matchId, match, scenario, mySide, seat }: { matchId: string; match: MatchDoc; scenario: ScenarioDef; mySide: string | null; seat: string | null }) {
  const session = useOnlineGame(matchId, scenario, seat);
  return <OnlineMatchBody matchId={matchId} match={match} scenario={scenario} mySide={mySide} session={session} />;
}

function LegacyMatch({ matchId, match, scenario, mySide, seat }: { matchId: string; match: MatchDoc; scenario: ScenarioDef; mySide: string | null; seat: string | null }) {
  const session = useOnlineGameLegacy(matchId, scenario, match.seed ?? '', seat);
  return <OnlineMatchBody matchId={matchId} match={match} scenario={scenario} mySide={mySide} session={session} />;
}

function OnlineMatchBody({ matchId, match, scenario, mySide, session }: { matchId: string; match: MatchDoc; scenario: ScenarioDef; mySide: string | null; session: OnlineSession }) {
  const navigate = useNavigate();
  const [conceding, setConceding] = useState<'ask' | 'busy' | null>(null);
  const [concedeError, setConcedeError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState<'ask' | 'busy' | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);
  const now = useNow(match.status === 'active' ? 1000 : 60_000);
  const undo = useUndoRequest(matchId, match, session, Object.entries(match.seats).find(([side]) => side !== mySide)?.[1]?.displayName ?? 'Your opponent');

  if (session.loadError) return <Gate title="Match unavailable" text={session.loadError} />;
  if (session.replayError) return <OutdatedGate matchId={matchId} text={`${session.replayError} ${OLD_RULES}`} canEnd={match.status === 'active' && mySide !== null} />;
  if (!session.ready) return <Splash text="Reading the position…" />;
  // Ended without the engine reaching a result: a concession.
  if (match.status !== 'active' && !session.state.result) return <WaitingRoom matchId={matchId} match={match} scenario={scenario} />;

  const sideName = (s: string | null | undefined) => (s ? (scenario.sides.find((x) => x.side === s)?.name ?? s) : '');
  const opponent = Object.entries(match.seats).find(([side]) => side !== mySide)?.[1];
  const toMove = session.state.result ? null : session.engine.currentDecision(session.state)?.owner;
  // The clock belongs to the recorded position; while an optimistic order is in flight it is stale, so it is hidden.
  const deadline = match.status === 'active' && match.deadline && match.deadline.seq === session.actionCount ? match.deadline : null;
  const dueAt = toDate(deadline?.at)?.getTime();
  const left = dueAt === undefined ? null : dueAt - now;
  const expired = left !== null && left <= 0;
  const clock = left === null ? '' : expired ? ' · out of time' : ` · ${formatLeft(left)}`;
  const status = session.state.result
    ? match.result
      ? `Scored${match.result.eloDelta ? ` · ±${match.result.eloDelta} Elo` : ''}`
      : 'Scoring…'
    : session.sending
      ? 'Sending your orders…'
      : toMove === mySide
        ? `Your move${clock}`
        : `Waiting for ${match.seats[toMove ?? '']?.displayName ?? sideName(toMove)}${clock}`;
  const officialConcession = reachedOfficialProgress(match.summary, scenario);

  const claim = async (outcome: 'pass' | 'forfeit') => {
    setClaiming('busy');
    setClaimError(null);
    try {
      await api('claimTimeout', { matchId, outcome });
    } catch (e) {
      setClaimError(errorOf(e).message);
    } finally {
      setClaiming(null);
    }
  };

  const concede = async () => {
    setConceding('busy');
    try {
      await api('leaveMatch', { matchId });
      setConceding(null);
    } catch (e) {
      setConcedeError(errorOf(e).message);
      setConceding('ask');
    }
  };

  return (
    <>
      <GameScreen scenario={scenario} session={mySide && match.status === 'active' ? { ...session, canUndo: undo.canUndo, askUndo: undo.askUndo } : session} matchId={matchId} onQuit={() => navigate('/app')} aside={mySide ? <ChatDock variant="rail" channelId={matchId} title="Table chat" storageKey="asl.matchChat" /> : undefined} aar={aarCue(matchId, match, match.status === 'complete' && !!match.result)} />
      <div className={`online-strip ${toMove && toMove === mySide && !session.sending ? 'mine' : ''}`}>
        {mySide ? (
          <span>
            <b className={`side-${mySide}`}>{sideName(mySide)}</b> vs {opponent ? <Link to={`/app/profile/${opponent.uid}`}>{opponent.displayName}</Link> : '—'}
          </span>
        ) : (
          <span>Watching</span>
        )}
        <span className={`status ${expired ? 'expired' : left !== null && left < 60_000 ? 'urgent' : ''}`}>{status}</span>
        {session.state.result && match.result && (match.visibility ?? 'public') === 'public' && (
          <Link className="btn ghost small" to={aarPath(matchId)}>
            After action report
          </Link>
        )}
        {expired && deadline && mySide && deadline.side !== mySide && deadline.class === 'interrupt' && (
          <button className="ghost small" disabled={claiming === 'busy'} onClick={() => claim('pass')} title="Their first-fire window has lapsed: pass it for them and play on">
            Pass for them
          </button>
        )}
        {expired && deadline && mySide && deadline.side !== mySide && (
          <button className="primary small" disabled={claiming === 'busy'} onClick={() => setClaiming('ask')} title="Their clock has run out: you may claim the match as a forfeit win">
            Claim the win
          </button>
        )}
        {mySide && match.status === 'active' && (
          <button className="ghost small" onClick={() => setConceding('ask')}>
            Concede
          </button>
        )}
      </div>
      {(session.sendError || claimError) && <div className="save-warning">{session.sendError ? `Order refused: ${session.sendError}` : claimError}</div>}
      {undo.dialogs}
      {claiming === 'ask' && (
        <Modal title="Claim the win?" kicker="Out of time" onClose={() => setClaiming(null)}>
          <p>{opponent?.displayName ?? sideName(deadline?.side)} has run out of time. Claiming scores the match as a forfeit win for {sideName(mySide)}. Nothing happens unless you claim: you can keep waiting as long as you like.</p>
          <div className="buttons">
            <button className="ghost" onClick={() => setClaiming(null)}>
              Keep waiting
            </button>
            <button className="primary" onClick={() => claim('forfeit')}>
              Claim the win
            </button>
          </div>
        </Modal>
      )}
      {conceding && (
        <Modal title="Concede the match?" kicker="Surrender" onClose={conceding === 'ask' ? () => setConceding(null) : undefined}>
          <p>
            {!officialConcession
              ? 'The match has not reached its halfway point, so conceding now abandons it without a result or rating change.'
              : match.competition === 'friendly'
                ? `The match is scored as a friendly win for ${sideName(Object.keys(match.seats).find((s) => s !== mySide))}. You still earn participation XP, but ratings and ranked records do not change.`
                : `The match is scored as a ranked win for ${sideName(Object.keys(match.seats).find((s) => s !== mySide))}. Your rating and record take the loss.`}
          </p>
          {concedeError && <p className="warn">{concedeError}</p>}
          <div className="buttons">
            <button className="ghost" disabled={conceding === 'busy'} onClick={() => setConceding(null)}>
              Keep fighting
            </button>
            <button className="primary" disabled={conceding === 'busy'} onClick={concede}>
              Concede
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
