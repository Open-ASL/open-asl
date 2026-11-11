import { useEffect, useState } from 'react';
import { api, errorOf, usingEmulators } from './firebase';
import { useAuth } from './auth/AuthProvider';

type Status = { state: 'checking' } | { state: 'ok'; versionHash: string } | { state: 'down'; error: string };

/** Lobby footer badge: pings the functions backend as the signed-in user. */
export function BackendStatus() {
  const auth = useAuth();
  const uid = auth.status === 'member' ? auth.user.uid : null;
  const [status, setStatus] = useState<Status>({ state: 'checking' });

  useEffect(() => {
    if (!uid) return;
    let live = true;
    api('ping', undefined)
      .then((d) => live && setStatus({ state: 'ok', versionHash: d.versionHash }))
      .catch((e) => live && setStatus({ state: 'down', error: errorOf(e).message }));
    return () => {
      live = false;
    };
  }, [uid]);

  // Production never names the hosting provider; the ruleset hash stays because it pins what a bug report ran on.
  if (status.state === 'checking') return <p className="muted small">{usingEmulators ? 'Connecting to local emulators…' : 'Connecting…'}</p>;
  if (status.state === 'down')
    return (
      <p className="warn small">
        {usingEmulators ? 'Local emulators unavailable' : 'Server unavailable'}: {status.error}
        {usingEmulators && ' — start it with pnpm dev'}
      </p>
    );
  return (
    <p className="muted small">
      {usingEmulators ? 'Local emulators' : 'Server online'} · ruleset {status.versionHash.slice(0, 12)}
    </p>
  );
}
