import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { COL, rulesetOfLobbyChannel, type ChatMessageDoc } from '@asl/platform';
import { api, db, errorOf } from '../firebase';
import { useMember } from '../auth/AuthProvider';
import { ago } from '../ui/time';
import { useMutes } from './mutes';
import { Avatar } from '../profile/Avatar';
import { usePublicProfiles } from '../profile/usePublicProfiles';

export function ChatPanel({ channelId, compact = false, title = 'Lobby chat', onMessages }: { channelId: string; compact?: boolean; title?: string; /** The messages as shown, oldest first, whenever they change. */ onMessages?(messages: Array<{ id: string; uid: string }>): void }) {
  // A lobby's chat (one per ruleset) offers challenges in that lobby; a match's chat does not.
  const lobby = rulesetOfLobbyChannel(channelId);
  const { user } = useMember();
  const [messages, setMessages] = useState<Array<{ id: string; data: ChatMessageDoc }> | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mutes = useMutes();
  const muted = mutes.muted;
  useEffect(() => onSnapshot(query(collection(db, COL.chatChannels, channelId, COL.messages), orderBy('createdAt', 'desc'), limit(compact ? 50 : 100)), (snap) => setMessages(snap.docs.map((d) => ({ id: d.id, data: d.data() as ChatMessageDoc })).reverse()), (e) => setError(e.code === 'permission-denied' && channelId !== 'lobby_starter-kit' ? null : e.message)), [channelId, compact]);
  const shown = useMemo(() => (messages ?? []).filter((m) => !muted.includes(m.data.uid) && !m.data.hidden), [messages, muted]);
  useEffect(() => { if (messages) onMessages?.(shown.map((m) => ({ id: m.id, uid: m.data.uid }))); }, [messages, shown, onMessages]);
  const send = async (event: FormEvent) => {
    event.preventDefault(); if (!text.trim()) return; setBusy(true); setError(null);
    // One's own message is always brought into view.
    pinned.current = true;
    try { await api('sendChatMessage', { channelId, text: text.trim() }); setText(''); }
    catch (e) { setError(errorOf(e).message); } finally { setBusy(false); }
  };
  const mute = (uid: string) => mutes.mute(uid);
  const hiddenCount = (messages ?? []).filter((m) => muted.includes(m.data.uid) && !m.data.hidden).length;
  const authors = usePublicProfiles(shown.map((m) => m.data.uid));
  const retained = compact ? 50 : 100;
  // The log opens at its newest message and follows new ones, unless the reader has scrolled up to read back; it
  // also lands at the bottom when a hidden pane (the dock's chat tab) is shown, as its size changes then.
  const log = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const toBottom = () => {
    const el = log.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  };
  useLayoutEffect(toBottom, [shown]);
  useEffect(() => {
    const el = log.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(toBottom);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const onScroll = () => {
    const el = log.current;
    // Hidden (no layout): nothing to judge.
    if (!el || el.clientHeight === 0) return;
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  };
  return <section className={`chat-panel ${compact ? 'compact' : ''}`}><header><h2>{title}</h2><span>{shown.length ? `Live · latest ${retained}` : 'Quiet'}</span></header><div ref={log} className="chat-messages" aria-live="polite" onScroll={onScroll}>{shown.map(({ id, data }) => <article key={id} className={data.uid === user.uid ? 'mine' : ''}><Avatar profile={{ photoURL: authors.get(data.uid)?.photoURL ?? null, gravatarHash: '', displayName: data.nickname }} size={compact ? 26 : 32} xp={authors.get(data.uid)?.xp} /><div className="chat-body"><div><a className="chat-author" href={`/app/profile/${data.uid}`} target="_blank" rel="noopener" title="Open service record in a new tab">{data.nickname}</a><small>{ago(data.createdAt)}</small>{data.uid !== user.uid && <span className="chat-tools">{lobby && <Link to={`/app/${lobby}/games?challenge=${data.uid}`}>Challenge</Link>}<button onClick={() => mute(data.uid)}>Mute</button><button onClick={() => void api('reportChatMessage', { channelId, messageId: id, reason: 'Reported from chat' }).catch((e) => setError(errorOf(e).message))}>Report</button></span>}</div><p>{data.text}</p></div></article>)}{!shown.length && <p className="empty-state">No messages yet. Say hello.</p>}</div>{muted.length > 0 && <p className="chat-muted-note">{muted.length} {muted.length === 1 ? 'player' : 'players'} muted{hiddenCount ? ` · ${hiddenCount} ${hiddenCount === 1 ? 'message' : 'messages'} hidden` : ''}. Unmute from the roster, or <button type="button" className="text-button" onClick={mutes.clear}>unmute everyone</button>.</p>}<form onSubmit={send}><input maxLength={500} value={text} onChange={(e) => setText(e.target.value)} placeholder={lobby ? 'Message the Lobby…' : 'Message the table…'} aria-label="Chat message" /><button className="btn primary" disabled={busy || !text.trim()}>Send</button></form>{error && <p className="warn small">{error}</p>}</section>;
}
