import { useSyncExternalStore } from 'react';

/** Players whose chat is hidden on this browser, shared by the chat panel and the roster; remembered per browser. */
const KEY = 'asl.mutedChat';
const read = (): string[] => { try { const v = JSON.parse(localStorage.getItem(KEY) ?? '[]'); return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []; } catch { return []; } };
let muted: string[] = read();
const listeners = new Set<() => void>();
const write = (next: string[]) => {
  muted = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private window: forgotten on reload */ }
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export function useMutes() {
  const list = useSyncExternalStore(subscribe, () => muted, () => muted);
  return {
    muted: list,
    isMuted: (uid: string) => list.includes(uid),
    mute: (uid: string) => write([...new Set([...list, uid])]),
    unmute: (uid: string) => write(list.filter((x) => x !== uid)),
    toggle: (uid: string) => (list.includes(uid) ? write(list.filter((x) => x !== uid)) : write([...new Set([...list, uid])])),
    clear: () => write([]),
  };
}
