import { useState } from 'react';
import { api, errorOf } from '../firebase';

/** Why a player who has set themselves not available offers no challenge. */
export const NOT_AVAILABLE = 'Not available for challenges right now. You can still chat with them.';

/**
 * The player's "not available" switch. While it is on, no one may send them a challenge (the server refuses one,
 * `sendInvite`); they still show in the Lobby and can chat. It stays on until they turn it off.
 */
export function AvailabilityToggle({ notAvailable }: { notAvailable: boolean }) {
  // The new state, shown at once while the server writes it (the profile snapshot then confirms it).
  const [pending, setPending] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const off = pending ?? notAvailable;
  const toggle = async () => {
    const next = !off;
    setPending(next);
    setError(null);
    try {
      await api('setAvailability', { notAvailable: next });
    } catch (e) {
      setError(errorOf(e).message);
    } finally {
      setPending(null);
    }
  };
  return (
    <button
      type="button"
      className={`availability-toggle ${off ? 'off' : 'on'}`}
      aria-pressed={off}
      disabled={pending !== null}
      onClick={() => void toggle()}
      title={error ?? (off ? 'Not available: no one can send you a challenge. You still show in the Lobby and can chat. Click to take challenges again.' : 'Available: other players can challenge you. Click to stop challenges while you stay in the Lobby.')}
    >
      <span className="dot" />
      <span className="label">{off ? 'Not available' : 'Available'}</span>
    </button>
  );
}
