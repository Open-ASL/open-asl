import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { COL, type PublicProfileDoc } from '@asl/platform';
import { api, db } from '../firebase';

export function usePublicProfile(uid: string | undefined, ensure = false) {
  const [profile, setProfile] = useState<PublicProfileDoc | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(false);
    if (!uid) return;
    let requested = false;
    return onSnapshot(doc(db, COL.publicProfiles, uid), (snap) => {
      const data = snap.data() as PublicProfileDoc | undefined;
      setProfile(data ?? null);
      setReady(true);
      if (!data && ensure && !requested) {
        requested = true;
        void api('ensurePublicProfile', undefined).catch(() => {});
      }
    }, () => setReady(true));
  }, [uid, ensure]);
  return { profile, ready };
}
