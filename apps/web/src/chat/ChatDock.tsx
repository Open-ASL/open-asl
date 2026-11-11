import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useMember } from '../auth/AuthProvider';
import { playSfx } from '../audio/engine';
import { ChatPanel } from './ChatPanel';

/** Open/closed state and chosen pane of one dock, shared by everything that opens it; remembered per browser under `key`. */
interface DockState { open: boolean; pane: string }
const stores = new Map<string, { state: DockState; listeners: Set<() => void> }>();
function store(key: string) {
  let s = stores.get(key);
  if (!s) {
    let state: DockState = { open: false, pane: 'chat' };
    try { const v = JSON.parse(localStorage.getItem(key) ?? 'null') as Partial<DockState> | null; state = { open: v?.open === true, pane: typeof v?.pane === 'string' ? v.pane : 'chat' }; } catch { /* defaults */ }
    s = { state, listeners: new Set() };
    stores.set(key, s);
  }
  return s;
}
export function useDockState(key: string) {
  const s = store(key);
  const state = useSyncExternalStore((l) => { s.listeners.add(l); return () => { s.listeners.delete(l); }; }, () => s.state, () => s.state);
  const set = (next: Partial<DockState>) => {
    s.state = { ...s.state, ...next };
    try { localStorage.setItem(key, JSON.stringify(s.state)); } catch { /* private window: forgotten on reload */ }
    s.listeners.forEach((l) => l());
  };
  return { ...state, setOpen: (open: boolean) => set({ open }), setPane: (pane: string) => set({ pane }), show: (pane = 'chat') => set({ open: true, pane }) };
}

interface Props {
  channelId: string;
  /** Shown on the collapsed bar and as the panel's name. */
  title: string;
  /** Browser-storage key for the open state; the last message seen is kept under it too. */
  storageKey: string;
  className?: string;
  /** Short status beside the title on the bar, e.g. who is here. */
  meta?: ReactNode;
  /** A second pane, offered as a tab beside the chat. */
  extraPane?: { id: string; label: ReactNode; node: ReactNode };
  /** Ignore the remembered open state and start collapsed (the atlas, where the map matters more). */
  forceCollapsed?: boolean;
  /** Hidden entirely, for pages that show the same channel full-size. */
  hidden?: boolean;
  /** `corner`: pinned to the screen corner. `rail`: a full-height column that expands sideways, for the game screen. */
  variant?: 'corner' | 'rail';
}

/**
 * A chat pinned to the corner of the screen. Collapsed it shows how many messages arrived since
 * you last looked; the chat stays mounted so nothing is missed, and a new message from someone
 * else while collapsed plays a soft cue. Used for the Lobby channel and for a match's table chat.
 */
export function ChatDock({ channelId, title, storageKey, className = '', meta, extraPane, forceCollapsed = false, hidden = false, variant = 'corner' }: Props) {
  const { user } = useMember();
  const dock = useDockState(storageKey);
  const [localOpen, setLocalOpen] = useState(false);
  const open = forceCollapsed ? localOpen : dock.open;
  const setOpen = (v: boolean) => (forceCollapsed ? setLocalOpen(v) : dock.setOpen(v));
  const pane = extraPane && dock.pane === extraPane.id ? extraPane.id : 'chat';

  const seenKey = `${storageKey}.seen.${channelId}`;
  const [messages, setMessages] = useState<Array<{ id: string; uid: string }> | null>(null);
  const seen = useRef<string | null>((() => { try { return localStorage.getItem(seenKey); } catch { return null; } })());
  const primed = useRef(false);
  const [unread, setUnread] = useState(0);
  const onMessages = useCallback((rows: Array<{ id: string; uid: string }>) => setMessages(rows), []);
  const writeSeen = (id: string | null) => { seen.current = id; try { if (id) localStorage.setItem(seenKey, id); } catch { /* private window */ } };
  useEffect(() => {
    if (!messages) return;
    const last = messages.at(-1)?.id ?? null;
    const known = seen.current !== null && messages.some((m) => m.id === seen.current);
    if (!primed.current) { primed.current = true; if (!known) { writeSeen(last); return; } }
    if (open || hidden) { writeSeen(last); setUnread(0); return; }
    const idx = messages.findIndex((m) => m.id === seen.current);
    const fresh = messages.slice(idx + 1).filter((m) => m.uid !== user.uid);
    setUnread((n) => { if (fresh.length > n) playSfx('ui.open'); return fresh.length; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, open, hidden, user.uid]);

  if (hidden) return null;
  return <div className={`chat-dock ${variant} ${open ? 'open' : ''} ${className}`}>
    <button className="chat-dock-bar" onClick={() => setOpen(!open)} aria-expanded={open} title={open ? `Collapse ${title}` : `Open ${title}`}>
      <span className="presence-dot" />
      <b>{title}</b>
      {meta !== undefined && <span className="chat-dock-meta">{meta}{!open && unread > 0 ? ` · ${unread} new` : ''}</span>}
      {!open && unread > 0 && <span className="chat-dock-unread">{unread}</span>}
      <span className="chat-dock-caret">{variant === 'rail' ? (open ? '▸' : '◂') : open ? '▾' : '▴'}</span>
    </button>
    <div className="chat-dock-body" hidden={!open}>
      {extraPane && <div className="chat-dock-tabs">
        <button className={pane === 'chat' ? 'on' : ''} onClick={() => dock.setPane('chat')}>Chat</button>
        <button className={pane === extraPane.id ? 'on' : ''} onClick={() => dock.setPane(extraPane.id)}>{extraPane.label}</button>
      </div>}
      <div className="chat-dock-pane" hidden={pane !== 'chat'}><ChatPanel channelId={channelId} compact title={title} onMessages={onMessages} /></div>
      {extraPane && pane === extraPane.id && <div className="chat-dock-pane">{extraPane.node}</div>}
    </div>
  </div>;
}
