import type { ReactNode } from 'react';
import { Navigate } from 'react-router';
import { useAuth } from './AuthProvider';

/** Gate for the lobby and everything behind it. */
export function RequireMember({ children }: { children: ReactNode }) {
  const s = useAuth();
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
      return <Navigate to="/login" replace />;
  }
}

export function Splash({ text }: { text: string }) {
  return (
    <div className="splash">
      <p className="muted">{text}</p>
    </div>
  );
}
