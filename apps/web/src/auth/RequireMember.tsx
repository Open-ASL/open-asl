import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { loginPath } from '../aar/links';
import { useAuth } from './AuthProvider';

/** Gate for the lobby and everything behind it. */
export function RequireMember({ children }: { children: ReactNode }) {
  const s = useAuth();
  const location = useLocation();
  switch (s.status) {
    case 'loading':
      return <Splash text="Checking papers…" />;
    case 'member':
      return <>{children}</>;
    case 'not-invited':
      return <Navigate to="/not-invited" replace />;
    case 'error':
      return <Navigate to="/not-invited" replace />;
    default:
      // Back to the page asked for once signed in (a match link, a lobby page); the bare lobby needs no return path.
      return <Navigate to={location.pathname === '/app' && !location.search ? '/login' : loginPath(location.pathname + location.search)} replace />;
  }
}

export function Splash({ text }: { text: string }) {
  return (
    <div className="splash">
      <p className="muted">{text}</p>
    </div>
  );
}
