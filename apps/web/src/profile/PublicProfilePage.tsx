import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { collection, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, startAfter, where, type DocumentData, type QueryDocumentSnapshot } from 'firebase/firestore';
import { Link, useNavigate, useParams } from 'react-router';
import { COL, COMPUTER_UID, nextRank, rankFor, type MatchDoc, type NicknameDoc, type PublicMatchResultDoc, type PublicProfileDoc } from '@asl/platform';
import { scenarioById } from '@asl/content';
import { api, db, errorOf } from '../firebase';
import { toDate } from '../ui/time';
import { useAuth } from '../auth/AuthProvider';
import { Avatar } from './Avatar';
import { AvatarUpload } from './AvatarUpload';
import { Medals } from './Medals';
import { RankInsignia } from './RankInsignia';
import { Emblem } from '../ui/Emblem';
import { ScenarioLink } from '../lobby-v2/ScenarioLink';
import { aarPath, replayPath } from '../aar/links';


export function PublicProfilePage() {
  const { nickname = '' } = useParams<{ nickname: string }>();
  const navigate = useNavigate();
  const auth = useAuth();
  const [profile, setProfile] = useState<PublicProfileDoc | null | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    let live = true;
    let stop: (() => void) | undefined;
    setProfile(undefined);
    void (async () => {
      const alias = (await getDoc(doc(db, COL.nicknames, nickname.toLowerCase()))).data() as NicknameDoc | undefined;
      if (!live) return;
      if (!alias) return setProfile(null);
      if (alias.alias && alias.current !== nickname.toLowerCase()) return navigate(`/profile/${alias.current}`, { replace: true });
      stop = onSnapshot(doc(db, COL.publicProfiles, alias.uid), (snap) => setProfile((snap.data() as PublicProfileDoc | undefined) ?? null));
    })();
    return () => { live = false; stop?.(); };
  }, [nickname, navigate]);
  if (profile === undefined) return <PublicProfileFrame><p className="profile-loading">Reading service record…</p></PublicProfileFrame>;
  if (!profile) return <PublicProfileFrame><div className="profile-missing"><h1>No such player</h1><Link to="/">Return home</Link></div></PublicProfileFrame>;
  const own = auth.status === 'member' && auth.user.uid === profile.uid;
  return <PublicProfileFrame>
    <main className="public-profile">
      <header className="public-profile__hero">
        <Avatar profile={{ ...profile, displayName: profile.nickname, gravatarHash: '' }} size={116} xp={profile.xp} />
        <div><p className="eyebrow">Player service record</p><h1>{profile.nickname}</h1><p>{profile.description || 'No field notes yet.'}</p><div className="public-profile__details">{profile.location && <span>⌖ {profile.location}</span>}<span>Language {profile.language.toUpperCase()}</span></div></div>
        <div className="profile-actions">{own && <button className="btn" onClick={() => setEditing(true)}>Edit profile</button>}<ShareProfile nickname={profile.nickname} /></div>
      </header>
      <ProfileStats profile={profile} />
      <section className="profile-section"><header><div><p className="eyebrow">Decorations</p><h2>Ribbons & medals</h2></div></header><Medals profile={{ medals: profile.medals }} stats={own ? auth.profile : { elo: profile.elo, wins: profile.wins, losses: profile.losses, draws: profile.draws }} /></section>
      <section className="profile-section"><header><div><p className="eyebrow">Battle log</p><h2>Public battle history</h2></div></header><BattleHistory uid={profile.uid} /></section>
      {own && <section className="profile-section"><header><div><p className="eyebrow">Only you see this</p><h2>Hotseat games</h2></div></header><HotseatHistory uid={profile.uid} /></section>}
      {editing && <ProfileEditor profile={profile} onClose={() => setEditing(false)} />}
    </main>
  </PublicProfileFrame>;
}

function PublicProfileFrame({ children }: { children: React.ReactNode }) {
  return <div className="public-profile-shell"><header><Link to="/" className="command-brand" aria-label="Open ASL"><Emblem /><span><b>OPEN ASL</b><small>Service record</small></span></Link><nav><Link to="/app">Enter Lobby</Link></nav></header>{children}</div>;
}

function ProfileStats({ profile }: { profile: PublicProfileDoc }) {
  const rank = rankFor(profile.xp);
  const next = nextRank(profile.xp);
  return <section className="profile-stat-grid"><div className="stat-rank"><span>Rank</span><div className="rank-line"><RankInsignia rank={rank} size={46} /><b>{rank.title}</b></div><div className="xp-bar" role="progressbar" aria-valuenow={Math.round((next?.progress ?? 1) * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={next ? `Progress to ${next.rank.title}` : 'Top rank'}><span style={{ width: `${Math.round((next?.progress ?? 1) * 100)}%` }} /></div><small>{profile.xp} XP{next ? ` · ${next.remaining} to ${next.rank.title}` : ' · highest rank'}</small></div><div><span>Rating</span><b>{profile.elo}</b><small>Ranked Elo</small></div><div><span>Record</span><b>{profile.wins}–{profile.losses}–{profile.draws}</b><small>Wins · losses · draws</small></div><div><span>Played</span><b>{profile.wins + profile.losses + profile.draws}</b><small>Ranked matches</small></div></section>;
}

function ShareProfile({ nickname }: { nickname: string }) {
  const [copied, setCopied] = useState(false);
  const url = `${location.origin}/profile/${nickname.toLowerCase()}`;
  const share = async () => {
    if (navigator.share) await navigator.share({ title: `${nickname} · Open ASL`, url });
    else { await navigator.clipboard.writeText(url); setCopied(true); }
  };
  return <div className="share-profile"><button className="btn primary" onClick={share}>{copied ? 'Link copied' : 'Share profile'}</button></div>;
}

export function ProfileEditor({ profile, onClose }: { profile: PublicProfileDoc; onClose(): void }) {
  const [nickname, setNickname] = useState(profile.nickname);
  const [description, setDescription] = useState(profile.description);
  const [locationText, setLocationText] = useState(profile.location);
  const [language, setLanguage] = useState(profile.language);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(null);
    try { const { profile: saved } = await api('updatePublicProfile', { nickname, description, location: locationText, language }); onClose(); if (saved.nicknameNormalized !== profile.nicknameNormalized) window.location.assign(`/profile/${saved.nicknameNormalized}`); }
    catch (e) { setError(errorOf(e).message); setBusy(false); }
  };
  return <div className="profile-editor-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><form className="profile-editor" onSubmit={save}><p className="eyebrow">Public profile</p><h2>Edit service record</h2><div className="profile-photo-field"><Avatar profile={{ ...profile, displayName: profile.nickname, gravatarHash: '' }} size={72} xp={profile.xp} /><div><b>Profile picture</b><AvatarUpload uid={profile.uid} hasPhoto={!!profile.photoURL} /></div></div><label>Nickname<input value={nickname} maxLength={24} onChange={(e) => setNickname(e.target.value)} /><small>Unique · letters, numbers, underscores and hyphens</small></label><label>Description<textarea value={description} maxLength={500} rows={5} onChange={(e) => setDescription(e.target.value)} /></label><label>City or region<input value={locationText} maxLength={80} onChange={(e) => setLocationText(e.target.value)} /></label><label>Preferred language<select value={language} onChange={(e) => setLanguage(e.target.value)}><option value="en">English</option><option value="de">Deutsch</option><option value="fr">Français</option><option value="es">Español</option><option value="it">Italiano</option><option value="pl">Polski</option></select></label>{error && <p className="warn">{error}</p>}<div className="profile-editor-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy}>Save profile</button></div></form></div>;
}

const BATTLES_PER_PAGE = 25;

/** One page of a player's ranked results, newest first; only the page shown is ever loaded. */
function useResultPages(uid: string) {
  const starts = useRef<Array<QueryDocumentSnapshot<DocumentData> | null>>([null]);
  const [rows, setRows] = useState<PublicMatchResultDoc[] | null>(null);
  const [page, setPage] = useState(0);
  const [canNext, setCanNext] = useState(false);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async (index: number) => {
    setLoading(true);
    try {
      const base = [where('playerIds', 'array-contains', uid), orderBy('completedAt', 'desc')] as const;
      const cursor = starts.current[index] ?? null;
      const q = cursor
        ? query(collection(db, COL.publicResults), ...base, startAfter(cursor), limit(BATTLES_PER_PAGE + 1))
        : query(collection(db, COL.publicResults), ...base, limit(BATTLES_PER_PAGE + 1));
      const snap = await getDocs(q);
      const visible = snap.docs.slice(0, BATTLES_PER_PAGE);
      if (snap.docs.length > BATTLES_PER_PAGE && visible.length) starts.current[index + 1] = visible.at(-1)!;
      setRows(visible.map((d) => d.data() as PublicMatchResultDoc));
      setCanNext(snap.docs.length > BATTLES_PER_PAGE);
      setPage(index);
    } catch { setRows([]); } finally { setLoading(false); }
  }, [uid]);
  useEffect(() => { starts.current = [null]; void load(0); }, [load]);
  return { rows, page, loading, canPrevious: page > 0, canNext, previous: () => void load(page - 1), next: () => void load(page + 1) };
}

function BattleHistory({ uid }: { uid: string }) {
  const results = useResultPages(uid);
  if (!results.rows) return <p className="profile-loading">Reading the battle log…</p>;
  if (!results.rows.length && results.page === 0) return <p className="battle-empty">No public battles yet.</p>;
  return <div className="battle-log">
    <ol className="battle-list">
      {results.rows.map((r) => {
        const scenario = scenarioById(r.scenarioId);
        const mySide = Object.entries(r.players).find(([, p]) => p.uid === uid)?.[0] ?? '';
        const opponent = Object.values(r.players).find((p) => p.uid !== uid);
        const sideName = (side: string) => scenario?.sides.find((s) => s.side === side)?.name ?? side;
        // A game against the computer is scored for nobody: the player's own side tells the outcome.
        const outcome = r.result.winner === null ? 'draw' : r.result.winnerUid ? (r.result.winnerUid === uid ? 'won' : 'lost') : r.result.winner === mySide ? 'won' : 'lost';
        const when = toDate(r.completedAt);
        const friendly = (r.competition ?? 'ranked') === 'friendly';
        return <li key={r.matchId} className={`battle-row ${outcome}`}>
          <span className="battle-when">{when?.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</span>
          <span className="battle-what"><ScenarioLink scenarioId={r.scenarioId}>{r.scenarioTitle}</ScenarioLink><small>as the {sideName(mySide)}{opponent ? <> · vs {opponent.uid === COMPUTER_UID ? opponent.nickname : <Link to={`/profile/${opponent.nickname.toLowerCase()}`}>{opponent.nickname}</Link>}</> : null}{friendly ? ' · Friendly' : ''}</small></span>
          <span className="battle-outcome"><b>{outcome === 'won' ? 'Victory' : outcome === 'lost' ? 'Defeat' : 'Draw'}</b><small>{r.result.reason}{r.result.eloDelta ? ` · ${outcome === 'won' ? '+' : outcome === 'lost' ? '−' : '±'}${r.result.eloDelta} Elo` : ''}</small></span>
          <BattleLinks matchId={r.matchId} />
        </li>;
      })}
    </ol>
    {(results.canPrevious || results.canNext) && <div className="live-page-controls battle-pages">
      <button className="ghost" disabled={!results.canPrevious || results.loading} onClick={results.previous}>Previous {BATTLES_PER_PAGE}</button>
      <span>Page {results.page + 1}</span>
      <button className="ghost" disabled={!results.canNext || results.loading} onClick={results.next}>Next {BATTLES_PER_PAGE}</button>
    </div>}
  </div>;
}

/** Replay and after action report links of a finished match. */
function BattleLinks({ matchId }: { matchId: string }) {
  return <span className="battle-links">
    <Link className="battle-aar" to={aarPath(matchId)}><svg viewBox="0 0 24 24" aria-hidden><path d="M4 19V5h16v14zM8 15V9M12 15v-4M16 15V7" /></svg>AAR</Link>
    <Link className="battle-replay" to={replayPath(matchId)}>Replay</Link>
  </span>;
}

/**
 * The owner's finished hotseat games, newest first. They are never listed to anyone else: only
 * the owner can read them, and nothing public points at them. Their reports are public all the same.
 */
function HotseatHistory({ uid }: { uid: string }) {
  const [rows, setRows] = useState<{ id: string; match: MatchDoc }[] | null>(null);
  useEffect(() => {
    const q = query(collection(db, COL.matches), where('playerIds', 'array-contains', uid), where('mode', '==', 'hotseat'), where('status', '==', 'complete'), orderBy('completedAt', 'desc'), limit(25));
    return onSnapshot(q, (snap) => setRows(snap.docs.map((d) => ({ id: d.id, match: d.data() as MatchDoc }))), () => setRows([]));
  }, [uid]);
  if (!rows) return <p className="profile-loading">Reading your hotseat games…</p>;
  if (!rows.length) return <p className="battle-empty">No finished hotseat games yet.</p>;
  return <ol className="battle-list">
    {rows.map(({ id, match }) => {
      const scenario = scenarioById(match.scenarioId);
      const sideName = (side: string) => scenario?.sides.find((s) => s.side === side)?.name ?? side;
      const when = toDate(match.completedAt);
      const r = match.result;
      return <li key={id} className={`battle-row mine ${r?.winner ? 'won' : 'drew'}`}>
        <span className="battle-when">{when?.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</span>
        <span className="battle-what"><ScenarioLink scenarioId={match.scenarioId}>{match.scenarioTitle}</ScenarioLink><small>Both sides · Hotseat <span className="only-you">only you see this</span></small></span>
        <span className="battle-outcome"><b>{r?.winner ? `${sideName(r.winner)} victory` : 'Draw'}</b><small>{r?.reason ?? ''}</small></span>
        <BattleLinks matchId={id} />
      </li>;
    })}
  </ol>;
}
