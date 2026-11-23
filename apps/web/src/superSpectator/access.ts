import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';

/**
 * Whether this account holds the commentator claim (`superSpectator`, granted by an administrator). Null while the
 * token is read. The token is refreshed once, so a claim granted since this tab signed in is seen without signing out.
 */
export function useSsClaim(user: User | null | undefined): boolean | null {
  const [held, setHeld] = useState<boolean | null>(null);
  useEffect(() => {
    if (!user) {
      setHeld(false);
      return;
    }
    let live = true;
    void user.getIdTokenResult(true).then(
      (t) => live && setHeld(t.claims['superSpectator'] === true),
      () => live && setHeld(false),
    );
    return () => {
      live = false;
    };
  }, [user]);
  return held;
}

/** The commentator's board of a match, and its pop-out controls. */
export const ssBoardPath = (matchId: string) => `/app/match/${matchId}/ss`;
export const ssControlsPath = (matchId: string) => `/app/match/${matchId}/ss/controls`;
