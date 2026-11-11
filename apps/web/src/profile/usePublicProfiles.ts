import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { COL, type PublicProfileDoc } from '@asl/platform';
import { db } from '../firebase';

/** The public profiles of a set of players, live, keyed by uid; entries appear as they load. */
export function usePublicProfiles(uids: string[]): Map<string, PublicProfileDoc> {
  const [profiles, setProfiles] = useState<Map<string, PublicProfileDoc>>(new Map());
  const key = [...new Set(uids)].sort().join('\n');
  useEffect(() => {
    const ids = key ? key.split('\n') : [];
    const records = new Map<string, PublicProfileDoc>();
    setProfiles(new Map());
    const stops = ids.map((uid) => onSnapshot(doc(db, COL.publicProfiles, uid), (snap) => {
      const profile = snap.data() as PublicProfileDoc | undefined;
      if (profile) records.set(uid, profile); else records.delete(uid);
      setProfiles(new Map(records));
    }, () => {}));
    return () => stops.forEach((stop) => stop());
  }, [key]);
  return profiles;
}
