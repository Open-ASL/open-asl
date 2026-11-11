import { Link, Navigate } from 'react-router';
import { signOut, useAuth } from '../auth/AuthProvider';
import { Emblem } from '../ui/Emblem';

/** Signed in, but not on the list (or something went wrong admitting them). */
export function NotInvited() {
  const state = useAuth();
  if (state.status === 'member') return <Navigate to="/app" replace />;
  if (state.status === 'signed-out') return <Navigate to="/login" replace />;
  const email = 'user' in state ? state.user.email : null;
  return (
    <div className="gate">
      <div className="gate-card">
        <Link to="/" className="brand">
          <Emblem size={56} />
          <span>
            OPEN <b>ASL</b>
          </span>
        </Link>
        {state.status === 'error' ? (
          <>
            <h1>Something jammed</h1>
            <p className="warn">{state.message}</p>
            <p className="muted small">If the local backend is not running, start it with <code>pnpm dev</code>.</p>
          </>
        ) : (
          <>
            <h1>Not on the list</h1>
            <p>
              {email ? <b>{email}</b> : 'This account'} has not been invited yet. The game is in a closed beta; invitations
              go out in waves.
            </p>
            <p className="muted small">
              Signed in with the wrong account? Sign out and try the address your invitation went to. Want in?{' '}
              <Link to="/#notify">Sign up for the beta</Link>.
            </p>
          </>
        )}
        <div className="buttons">
          <button onClick={() => signOut()}>Sign out</button>
          <Link to="/" className="btn ghost">
            Front page
          </Link>
        </div>
      </div>
    </div>
  );
}
