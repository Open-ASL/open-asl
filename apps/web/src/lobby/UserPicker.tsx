import { useEffect, useMemo, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { COL, rankFor, type PublicProfileDoc } from '@asl/platform';
import { useMember } from '../auth/AuthProvider';
import { db } from '../firebase';
import { useLobbyUsers } from '../lobby-v2/LobbyUsers';
import { Avatar } from '../profile/Avatar';
import { Modal } from '../ui/Modal';

interface Props {
  title: string;
  onPick(uid: string, user: PublicProfileDoc): void;
  onClose(): void;
  busy?: boolean;
}

/** Choose another player: whoever is in the Lobby right now first, then everyone else. */
export function UserPicker({ title, onPick, onClose, busy }: Props) {
  const { user } = useMember();
  const [users, setUsers] = useState<{ uid: string; data: PublicProfileDoc }[]>([]);
  const [filter, setFilter] = useState('');
  const lobby = useLobbyUsers();
  useEffect(
    () =>
      onSnapshot(query(collection(db, COL.publicProfiles), orderBy('nicknameNormalized'), limit(200)), (snap) =>
        setUsers(snap.docs.filter((d) => d.id !== user.uid).map((d) => ({ uid: d.id, data: d.data() as PublicProfileDoc }))),
      ),
    [user.uid],
  );
  const online = useMemo(() => new Set(lobby.players.map((p) => p.uid)), [lobby.players]);
  const shown = users.filter((u) => u.data.nickname.toLowerCase().includes(filter.toLowerCase()));
  const here = shown.filter((u) => online.has(u.uid));
  const away = shown.filter((u) => !online.has(u.uid));
  const row = ({ uid, data }: { uid: string; data: PublicProfileDoc }) => (
    <li key={uid}>
      <button className="user-row" disabled={busy} onClick={() => onPick(uid, data)}>
        <Avatar profile={{ ...data, displayName: data.nickname, gravatarHash: '' }} size={32} xp={data.xp} />
        <span className="user-name">
          <b>{data.nickname}</b>
          <small>{rankFor(data.xp).title} · {data.elo} Elo · {data.wins}–{data.losses}–{data.draws}</small>
        </span>
        {online.has(uid) && <span className="presence-dot" aria-label="In the Lobby" />}
      </button>
    </li>
  );
  return (
    <Modal title={title} onClose={onClose}>
      <input autoFocus placeholder="Find a player" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Find a player" />
      <ul className="user-list">
        {here.length > 0 && <li className="user-group">In the Lobby now</li>}
        {here.map(row)}
        {away.length > 0 && <li className="user-group">{here.length ? 'Everyone else' : 'All players'}</li>}
        {away.map(row)}
        {!shown.length && <li className="muted small">No one by that name.</li>}
      </ul>
    </Modal>
  );
}
