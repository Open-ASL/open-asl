import { useCallback, useEffect, useRef, useState } from 'react';
import { signOut } from '../auth/AuthProvider';
import { Modal } from '../ui/Modal';

const IDLE_LIMIT_MS = 30 * 60_000;
const WARNING_MS = 28 * 60_000;

/** Releases idle Lobby seats while leaving active match pages entirely alone. */
export function LobbyIdleGuard() {
  const [warning, setWarning] = useState(false);
  const warningRef = useRef(false);
  const warningTimer = useRef<number | undefined>(undefined);
  const signOutTimer = useRef<number | undefined>(undefined);

  const clearTimers = useCallback(() => {
    window.clearTimeout(warningTimer.current);
    window.clearTimeout(signOutTimer.current);
  }, []);

  const arm = useCallback(() => {
    clearTimers();
    warningRef.current = false;
    setWarning(false);
    warningTimer.current = window.setTimeout(() => {
      warningRef.current = true;
      setWarning(true);
    }, WARNING_MS);
    signOutTimer.current = window.setTimeout(() => void signOut(), IDLE_LIMIT_MS);
  }, [clearTimers]);

  useEffect(() => {
    const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('asl-lobby-activity');
    const activity = () => {
      if (warningRef.current) return;
      arm();
      channel?.postMessage('active');
    };
    const events: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'scroll', 'touchstart'];
    events.forEach((event) => window.addEventListener(event, activity, { passive: true }));
    if (channel) channel.onmessage = () => arm();
    arm();
    return () => {
      clearTimers();
      events.forEach((event) => window.removeEventListener(event, activity));
      channel?.close();
    };
  }, [arm, clearTimers]);

  if (!warning) return null;
  const keep = () => {
    arm();
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel('asl-lobby-activity');
      channel.postMessage('active');
      channel.close();
    }
  };
  return <Modal kicker="Idle timeout" title="Still in the Lobby?">
    <div className="idle-warning">
      <p>You have been inactive for 28 minutes. Your Lobby seat will close in two minutes so the online roster stays accurate.</p>
      <div className="buttons">
        <button className="primary" autoFocus onClick={keep}>Keep me in</button>
        <button className="ghost" onClick={() => void signOut()}>Sign out now</button>
      </div>
    </div>
  </Modal>;
}
