import { useEffect } from 'react';
import { get, onDisconnect, onValue, ref, remove, serverTimestamp, set, update } from 'firebase/database';
import { useLocation } from 'react-router';
import { useMember } from '../auth/AuthProvider';
import { realtime } from '../firebase';
import { HEARTBEAT_MS, IDLE_MS, PURGE_MS, type PresenceConnection } from './presenceRules';

const INPUT_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const;
const TICK_MS = 15_000;

/**
 * One node per browser connection, removed when the connection drops (the server closes unjoined
 * quick tables after the last one goes). The node's `at` is refreshed every minute for as long as
 * the tab lives, and `active` says whether the person has touched it within `IDLE_MS`, so a tab
 * left open does not keep its owner on the roster (see `presenceRules.ts`). A disconnect handler
 * does not always run (a laptop asleep, a dev proxy holding the socket), so on connect the owner
 * also removes their own nodes whose heartbeat stopped long ago; a server sweep catches the rest.
 */
export function Presence() {
  const { user } = useMember();
  const location = useLocation();
  const area = location.pathname.includes('/match/') ? 'match' : 'lobby';
  useEffect(() => {
    const connectionId = crypto.randomUUID();
    const connection = ref(realtime, `presence/${user.uid}/${connectionId}`);
    const disconnect = onDisconnect(connection);
    let lastInput = Date.now();
    let lastBeat = Date.now();
    let active = true;
    let gone = false;
    const write = (patch: Record<string, unknown>) => { if (!gone) void update(connection, patch).catch(() => {}); };
    void disconnect.remove().then(() => set(connection, { at: serverTimestamp(), area, active: true })).catch(() => {});
    // The clock offset is local SDK state (`get` would ask the server, which does not serve .info), hence the one-time listener.
    const serverOffset = new Promise<number>((resolve) => onValue(ref(realtime, '.info/serverTimeOffset'), (snapshot) => resolve(Number(snapshot.val() ?? 0)), () => resolve(0), { onlyOnce: true }));
    void Promise.all([get(ref(realtime, `presence/${user.uid}`)), serverOffset]).then(([snapshot, offset]) => {
      const mine = (snapshot.val() ?? {}) as Record<string, PresenceConnection | null>;
      // By the server clock: a sibling tab that is alive reports in every minute, so only long-dead nodes go.
      const cutoff = Date.now() + offset - PURGE_MS;
      for (const [id, node] of Object.entries(mine)) {
        if (id !== connectionId && (typeof node?.at !== 'number' || node.at < cutoff)) void remove(ref(realtime, `presence/${user.uid}/${id}`)).catch(() => {});
      }
    }).catch((e: unknown) => console.warn('presence: could not clear old connections', e));

    const onInput = () => {
      lastInput = Date.now();
      if (!active) {
        active = true;
        lastBeat = lastInput;
        write({ active: true, at: serverTimestamp() });
      }
    };
    const onVisibility = () => { if (document.visibilityState === 'visible') onInput(); };
    const tick = () => {
      const now = Date.now();
      if (active && now - lastInput >= IDLE_MS) {
        active = false;
        lastBeat = now;
        write({ active: false, at: serverTimestamp() });
      } else if (now - lastBeat >= HEARTBEAT_MS) {
        lastBeat = now;
        write({ at: serverTimestamp() });
      }
    };
    for (const type of INPUT_EVENTS) window.addEventListener(type, onInput, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);
    const timer = window.setInterval(tick, TICK_MS);
    return () => {
      gone = true;
      window.clearInterval(timer);
      for (const type of INPUT_EVENTS) window.removeEventListener(type, onInput);
      document.removeEventListener('visibilitychange', onVisibility);
      void disconnect.cancel().catch(() => {});
      void remove(connection).catch(() => {});
    };
  }, [user.uid, area]);
  return null;
}
