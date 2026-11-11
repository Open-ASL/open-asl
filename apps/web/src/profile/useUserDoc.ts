import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { COL, type UserDoc } from '@asl/platform';
import { db } from '../firebase';

/** Live view of another player's profile; null until it arrives (or if it does not exist). */
export function useUserDoc(uid: string | undefined): UserDoc | null {
  const [user, setUser] = useState<UserDoc | null>(null);
  useEffect(() => {
    if (!uid) return;
    return onSnapshot(doc(db, COL.users, uid), (snap) => setUser((snap.data() as UserDoc | undefined) ?? null));
  }, [uid]);
  return user;
}
