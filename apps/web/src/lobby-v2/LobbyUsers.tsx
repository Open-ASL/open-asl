import { useEffect, useRef, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { onValue, ref } from 'firebase/database';
import { Link } from 'react-router';
import { COL, rankFor, type PublicProfileDoc } from '@asl/platform';
import { useMember } from '../auth/AuthProvider';
import { db, realtime } from '../firebase';
import { Avatar } from '../profile/Avatar';
import { useMutes } from '../chat/mutes';
import { RECHECK_MS, presentUids, type PresenceTree } from './presenceRules';
import { useLobbyRuleset } from './ruleset';

const PRESENCE_GRACE_MS = 8000;
/** Why the roster cannot be shown, for the empty state; `reason` is the database error code or what timed out. */
export const presenceUnavailable = (reason: string) => `Presence is unavailable right now (${reason}); the roster cannot be shown.`;

/** Who is in the Lobby right now, derived from connection presence; public identity stays authoritative in Firestore. */
export function useLobbyUsers(): { players: PublicProfileDoc[]; ready: boolean; unavailable: string | null } {
  const [uids, setUids] = useState<string[]>([]);
  const [players, setPlayers] = useState<PublicProfileDoc[]>([]);
  const [ready, setReady] = useState(false);
  /** No presence snapshot within the grace period, or the read failed: say so instead of spinning forever. */
  const [unavailable, setUnavailable] = useState<string | null>(null);

  // The latest tree and the server clock offset, so stale connections can be dropped on a timer without a new snapshot.
  const tree = useRef<PresenceTree>({});
  const offset = useRef(0);
  useEffect(() => {
    const stall = window.setTimeout(() => setUnavailable('no answer from the presence server'), PRESENCE_GRACE_MS);
    const apply = () => setUids(presentUids(tree.current, Date.now() + offset.current));
    const stopOffset = onValue(ref(realtime, '.info/serverTimeOffset'), (snapshot) => { offset.current = Number(snapshot.val() ?? 0); apply(); });
    const stop = onValue(ref(realtime, 'presence'), (snapshot) => {
      window.clearTimeout(stall);
      tree.current = (snapshot.val() ?? {}) as PresenceTree;
      apply();
      setUnavailable(null);
      setReady(true);
    }, (error) => { window.clearTimeout(stall); console.error('presence read failed', error); setUnavailable(error.message.replace(/^.*?: /, '') || 'read failed'); setReady(true); });
    const recheck = window.setInterval(apply, RECHECK_MS);
    return () => { window.clearTimeout(stall); window.clearInterval(recheck); stopOffset(); stop(); };
  }, []);

  const uidKey = uids.join('\n');
  useEffect(() => {
    const stableUids = uidKey ? uidKey.split('\n') : [];
    const records = new Map<string, PublicProfileDoc>();
    const publish = () => setPlayers([...records.values()].sort((a, b) => a.nickname.localeCompare(b.nickname)));
    setPlayers([]);
    const stops = stableUids.map((uid) => onSnapshot(doc(db, COL.publicProfiles, uid), (snapshot) => {
      const profile = snapshot.data() as PublicProfileDoc | undefined;
      if (profile) records.set(uid, profile); else records.delete(uid);
      publish();
    }));
    return () => stops.forEach((stop) => stop());
  }, [uidKey]);

  // Ready once presence has been read and every present uid has resolved to a profile (or nobody is here).
  return { players, ready: ready && (uids.length === 0 || players.length > 0), unavailable };
}

/** The full roster: rank, rating, and a direct challenge for everyone present. */
export function LobbyUsers() {
  const { user } = useMember();
  const ruleset = useLobbyRuleset();
  const { players, ready, unavailable } = useLobbyUsers();
  const mutes = useMutes();

  return <section className="command-card lobby-users">
    <header><h2>In the Lobby</h2><span>{players.length} online</span></header>
    <div className="lobby-user-list">
      {players.map((profile) => {
        const own = profile.uid === user.uid;
        const muted = mutes.isMuted(profile.uid);
        return <article key={profile.uid} className={muted ? 'muted' : ''}>
          <span className="presence-dot" aria-label="Online" />
          <Avatar profile={{ ...profile, displayName: profile.nickname, gravatarHash: '' }} size={42} xp={profile.xp} />
          <div><Link to={`/profile/${profile.nicknameNormalized}`}>{profile.nickname}</Link><small title={`${rankFor(profile.xp).title} · ${profile.elo} Elo`}>{rankFor(profile.xp).title} · {profile.elo}{muted ? ' · muted' : ''}</small></div>
          {own ? <span className="lobby-user-you">You</span> : <span className="lobby-user-actions"><button type="button" className="text-button" onClick={() => mutes.toggle(profile.uid)} title={muted ? 'Show their chat messages again' : 'Hide their chat messages'}>{muted ? 'Unmute' : 'Mute'}</button><Link className="btn" to={`/app/${ruleset}/games?challenge=${profile.uid}`}>Challenge</Link></span>}
        </article>;
      })}
      {!players.length && <p className="empty-state">{unavailable ? presenceUnavailable(unavailable) : ready ? 'The Lobby is quiet.' : 'Checking who is here…'}</p>}
    </div>
  </section>;
}
