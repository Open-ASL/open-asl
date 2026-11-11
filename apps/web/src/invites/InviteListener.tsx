import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { COL, RANDOM_SIDE, paceDef, rankFor, type InviteDoc, type PublicProfileDoc } from '@asl/platform';
import { useMember } from '../auth/AuthProvider';
import { api, db, errorOf } from '../firebase';
import { playSfx } from '../audio/engine';
import { Modal } from '../ui/Modal';
import { usePublicProfile } from '../profile/usePublicProfile';
import { Avatar } from '../profile/Avatar';
import { ScenarioLink } from '../lobby-v2/ScenarioLink';

interface Row {
  id: string;
  invite: InviteDoc;
}

function usePendingInvites(field: 'toUid' | 'fromUid', uid: string): Row[] {
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(
    () =>
      onSnapshot(query(collection(db, COL.invites), where(field, '==', uid), where('status', '==', 'pending')), (snap) =>
        setRows(snap.docs.map((d) => ({ id: d.id, invite: d.data() as InviteDoc }))),
      ),
    [field, uid],
  );
  return rows;
}

/** Pops a challenge the moment it arrives, on any page behind the gate. */
export function InviteListener() {
  const { user } = useMember();
  const incoming = usePendingInvites('toUid', user.uid);
  const first = incoming[0];
  const announced = useRef<string | null>(null);
  useEffect(() => {
    if (first && announced.current !== first.id) {
      announced.current = first.id;
      playSfx('ui.open');
    }
  }, [first]);
  if (!first) return null;
  return <InviteModal key={first.id} id={first.id} invite={first.invite} />;
}

function InviteModal({ id, invite }: { id: string; invite: InviteDoc }) {
  const navigate = useNavigate();
  const { profile: sender } = usePublicProfile(invite.fromUid);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const respond = async (response: 'accept' | 'decline') => {
    setBusy(true);
    setError(null);
    try {
      const { matchId } = await api('respondToInvite', { inviteId: id, response });
      if (matchId) navigate(`/app/match/${matchId}`);
    } catch (e) {
      setError(errorOf(e).message);
      setBusy(false);
    }
  };
  return (
    <Modal kicker="Challenge received" title={`${invite.fromName} wants a fight`}>
      <div className="invite-body">
        <SenderCard uid={invite.fromUid} profile={sender} />
        <p>
          <b><ScenarioLink scenarioId={invite.scenarioId} balance={invite.balance}>{invite.scenarioTitle}</ScenarioLink></b>.{' '}
          {invite.fromSide === RANDOM_SIDE
            ? 'Sides are drawn by lot when you accept.'
            : `${invite.fromName} takes the ${{ am: 'Americans', ge: 'Germans', ru: 'Russians', br: 'British', al: 'Allies', it: 'Italians' }[invite.fromSide] ?? invite.fromSide}; you get the other side.`}
          {invite.balance.length > 0 && <span className="muted small"> Balance in favour of {invite.balance.join(', ')}.</span>}
        </p>
        <p className="muted small">
          <b>{invite.competition === 'friendly' ? 'Friendly' : 'Ranked'}</b> · {invite.visibility === 'private' ? 'private' : 'public'} · Clock: <b>{paceDef(invite.pace).name}</b> · {paceDef(invite.pace).blurb}. Accepting opens the board for you both.
        </p>
        {error && <p className="warn">{error}</p>}
        <div className="buttons">
          <button className="primary" disabled={busy} onClick={() => respond('accept')}>
            Accept
          </button>
          <button disabled={busy} onClick={() => respond('decline')}>
            Decline
          </button>
        </div>
      </div>
    </Modal>
  );
}

function SenderCard({ uid, profile }: { uid: string; profile: PublicProfileDoc | null }) {
  if (!profile) return null;
  return (
    <div className="sender" data-uid={uid}>
      <Avatar profile={{ ...profile, displayName: profile.nickname, gravatarHash: '' }} size={48} xp={profile.xp} />
      <span className="user-name">
        <b>{profile.nickname}</b>
        <small>
          {rankFor(profile.xp).title} · rating {profile.elo} · {profile.wins}–{profile.losses}–{profile.draws}
        </small>
      </span>
    </div>
  );
}

/**
 * The lobby strip for challenges you have sent. When one is accepted, the invite stops being
 * pending and your profile gains an active match; that is the cue to go to the table.
 */
export function OutgoingInvites() {
  const { user, profile } = useMember();
  const navigate = useNavigate();
  const outgoing = usePendingInvites('fromUid', user.uid);
  const hadPending = useRef(false);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    if (outgoing.length) hadPending.current = true;
    else if (hadPending.current && profile.activeMatchId) {
      hadPending.current = false;
      navigate(`/app/match/${profile.activeMatchId}`);
    }
  }, [outgoing.length, profile.activeMatchId, navigate]);
  if (!outgoing.length) return null;
  return (
    <div className="outgoing">
      {outgoing.map(({ id, invite }) => (
        <div key={id} className="outgoing-row">
          <span className="dot checking" />
          <span>
            Challenge sent to <b>{invite.toName}</b> · <ScenarioLink scenarioId={invite.scenarioId} balance={invite.balance}>{invite.scenarioTitle}</ScenarioLink> · waiting for an answer
          </span>
          <span className="spacer" />
          <button
            className="ghost"
            disabled={busy === id}
            onClick={async () => {
              setBusy(id);
              try {
                await api('respondToInvite', { inviteId: id, response: 'cancel' });
              } finally {
                setBusy(null);
              }
            }}
          >
            Cancel
          </button>
        </div>
      ))}
    </div>
  );
}
