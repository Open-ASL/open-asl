import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { onAuthStateChanged, signOut as fbSignOut, type User } from 'firebase/auth';
import { doc, onSnapshot, serverTimestamp, updateDoc } from 'firebase/firestore';
import { COL, type UserDoc } from '@asl/platform';
import { api, auth, db, errorOf } from '../firebase';

export type AuthState =
  | { status: 'loading' }
  | { status: 'signed-out' }
  /** Signed in with a password account whose email is not verified yet. */
  | { status: 'unverified'; user: User }
  /** Signed in, but the email is not on the invite list. */
  | { status: 'not-invited'; user: User }
  | { status: 'error'; user: User; message: string }
  | { status: 'member'; user: User; profile: UserDoc };

const Ctx = createContext<AuthState>({ status: 'loading' });

/**
 * Tracks the Firebase user and, for invited members, their live profile document.
 * On sign-in the `member` custom claim is checked; without it, claimProfile is asked to
 * admit them (it will, if the verified email is allowlisted) and the token is refreshed
 * before any Firestore listener starts, so the rules see the claim.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    let stopProfile: (() => void) | null = null;
    let run = 0;
    const stop = onAuthStateChanged(auth, async (user) => {
      const mine = ++run;
      stopProfile?.();
      stopProfile = null;
      if (!user) {
        setState({ status: 'signed-out' });
        return;
      }
      if (user.isAnonymous) {
        // Left over from the earlier anonymous ping; it can never become a member.
        await fbSignOut(auth);
        return;
      }
      setState({ status: 'loading' });
      try {
        let token = await user.getIdTokenResult();
        if (token.claims.member !== true) {
          if (!user.emailVerified) {
            setState({ status: 'unverified', user });
            return;
          }
          try {
            await api('claimProfile', undefined);
          } catch (e) {
            const { code } = errorOf(e);
            if (mine !== run) return;
            if (code === 'not-invited' || code === 'permission-denied') setState({ status: 'not-invited', user });
            else if (code === 'email-unverified') setState({ status: 'unverified', user });
            else setState({ status: 'error', user, message: errorOf(e).message });
            return;
          }
          token = await user.getIdTokenResult(true);
        }
        if (mine !== run) return;
        let seen = false;
        stopProfile = onSnapshot(
          doc(db, COL.users, user.uid),
          (snap) => {
            const profile = snap.data() as UserDoc | undefined;
            if (!profile) return;
            setState({ status: 'member', user, profile });
            if (!seen) {
              seen = true;
              void updateDoc(snap.ref, { lastSeenAt: serverTimestamp(), updatedAt: serverTimestamp() }).catch(() => {});
            }
          },
          (e) => setState({ status: 'error', user, message: e.message }),
        );
      } catch (e) {
        if (mine === run) setState({ status: 'error', user, message: errorOf(e).message });
      }
    });
    return () => {
      stop();
      stopProfile?.();
    };
  }, []);

  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);

/** The signed-in member, for components that only render inside RequireMember. */
export function useMember() {
  const s = useAuth();
  if (s.status !== 'member') throw new Error('useMember outside a member route');
  return s;
}

export const signOut = () => fbSignOut(auth);
