import { useState, type FormEvent } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router';
import { signInWithEmailAndPassword, signInWithPopup } from 'firebase/auth';
import { signOut, useAuth } from '../auth/AuthProvider';
import { api, auth, errorOf, googleProvider } from '../firebase';
import { Emblem } from '../ui/Emblem';

const MESSAGES: Record<string, string> = {
  'invalid-credential': 'Wrong email or password.',
  'user-not-found': 'Wrong email or password.',
  'wrong-password': 'Wrong email or password.',
  'invalid-email': 'That is not an email address.',
  'too-many-requests': 'Too many attempts. Try again in a few minutes.',
  'popup-closed-by-user': 'The sign-in window was closed.',
  'popup-blocked': 'The browser blocked the sign-in window.',
};

/** Sign in. There is no sign-up: the game is invite-only, and claimProfile decides who gets through. */
export function Login() {
  const state = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [params] = useSearchParams();
  // Where to go once signed in: a same-origin path (a replay, a report), else the lobby.
  const next = params.get('next') ?? '';
  const after = next.startsWith('/') && !next.startsWith('//') ? next : '/app';

  if (state.status === 'member') return <Navigate to={after} replace />;
  if (state.status === 'not-invited' || state.status === 'error') return <Navigate to="/not-invited" replace />;

  const attempt = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await fn();
    } catch (e) {
      const { code, message } = errorOf(e);
      setError(MESSAGES[code] ?? message);
    } finally {
      setBusy(false);
    }
  };

  const withPassword = (e: FormEvent) => {
    e.preventDefault();
    void attempt(() => signInWithEmailAndPassword(auth, email.trim(), password));
  };

  return (
    <div className="gate">
      <div className="gate-card">
        <Link to="/" className="brand">
          <Emblem size={56} />
          <span>
            OPEN <b>ASL</b>
          </span>
        </Link>

        {state.status === 'unverified' ? (
          <>
            <h1>Verify your email</h1>
            <p>
              A verification link was sent to <b>{state.user.email}</b>. Follow it, then come back here.
            </p>
            <div className="buttons">
              <button className="primary" disabled={busy} onClick={() => attempt(async () => { await api('requestEmailVerification', undefined); setNote('Sent again. Check your inbox.'); })}>
                Resend the link
              </button>
              <button disabled={busy} onClick={() => attempt(() => state.user.reload().then(() => location.reload()))}>
                I have verified it
              </button>
              <button className="ghost" onClick={() => signOut()}>
                Sign out
              </button>
            </div>
          </>
        ) : (
          <>
            <h1>Report for duty</h1>
            <p className="muted">The game is invite-only for now. Sign in with the address your invitation went to.</p>
            <button className="google" disabled={busy || state.status === 'loading'} onClick={() => attempt(() => signInWithPopup(auth, googleProvider))}>
              <GoogleMark /> Continue with Google
            </button>
            <div className="or">
              <span>or</span>
            </div>
            <form onSubmit={withPassword} className="gate-form">
              <input type="email" required autoComplete="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email" />
              <input type="password" required autoComplete="current-password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} aria-label="Password" />
              <button className="primary" disabled={busy || state.status === 'loading'}>
                {busy ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
            <button
              className="link"
              disabled={busy || !email}
              onClick={() => attempt(async () => { await api('requestPasswordReset', { email: email.trim() }); setNote('If that address has an account, a reset link is on its way. It can take a few minutes: check your Spam or Junk folder too.'); })}
            >
              Forgot your password?
            </button>
          </>
        )}
        {error && <p className="warn">{error}</p>}
        {note && <p className="muted small">{note}</p>}
        <p className="muted small">
          No invitation yet? <Link to="/#notify">Sign up for the beta</Link>.
        </p>
      </div>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.4 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.7 6c4.5-4.2 6.9-10.3 6.9-17.7z" />
      <path fill="#FBBC05" d="M10.5 28.7A14.5 14.5 0 0 1 9.7 24c0-1.6.3-3.2.8-4.7l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.3 0 11.7-2.1 15.6-5.7l-7.7-6c-2.1 1.4-4.8 2.3-7.9 2.3-6.3 0-11.6-3.9-13.5-9.4l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
    </svg>
  );
}
