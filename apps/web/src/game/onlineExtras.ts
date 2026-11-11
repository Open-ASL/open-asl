import { useCallback, useEffect, useRef, useState } from 'react';
import { collection, deleteDoc, doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { COL, type DraftDoc, type PingDoc } from '@asl/platform';
import { db } from '../firebase';
import type { Draft, MapPoint, Ping } from './session';

/**
 * The parts of an online table that are not the recording: each seat's work in progress on a decision (setup
 * counters placed so far) and the hex it last pointed out. Shared by the views-model session and the legacy one.
 */
export function useOnlineExtras(matchId: string, mySide: string | null) {
  // Work in progress: ours goes out a moment after it last changed; theirs arrives as they go.
  const [theirDraft, setTheirDraft] = useState<Draft | null>(null);
  useEffect(() => {
    setTheirDraft(null);
    if (!mySide) return;
    return onSnapshot(collection(doc(db, COL.matches, matchId), COL.drafts), (snap) => {
      const theirs = snap.docs.map((d) => d.data() as DraftDoc).find((d) => d.side !== mySide);
      setTheirDraft(theirs ? { decisionId: theirs.decisionId, placements: theirs.placements } : null);
    });
  }, [matchId, mySide]);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const publishDraft = useCallback(
    (draft: Draft | null) => {
      if (!mySide) return;
      if (draftTimer.current) clearTimeout(draftTimer.current);
      const ref = doc(db, COL.matches, matchId, COL.drafts, mySide);
      const write = () => {
        draftTimer.current = null;
        const p = draft ? setDoc(ref, { side: mySide, decisionId: draft.decisionId, placements: draft.placements, updatedAt: serverTimestamp() }) : deleteDoc(ref);
        p.catch(() => {});
      };
      // Clearing goes at once; placements are batched so a flurry of drags is one write.
      if (draft) draftTimer.current = setTimeout(write, 300);
      else write();
    },
    [matchId, mySide],
  );

  // Pings: each side's doc holds its last one; a change after the first read is a new ping from them.
  const [pings, setPings] = useState<Ping[]>([]);
  const pingId = useRef(0);
  useEffect(() => {
    setPings([]);
    if (!mySide) return;
    let primed = false;
    const seen = new Map<string, number>();
    const stop = onSnapshot(collection(doc(db, COL.matches, matchId), COL.pings), (snap) => {
      const fresh: Ping[] = [];
      for (const d of snap.docs) {
        const p = d.data() as PingDoc;
        if (typeof p.n !== 'number' || typeof p.hex !== 'string') continue;
        const was = seen.get(p.side);
        seen.set(p.side, p.n);
        // The first read only learns where things stand; a ping made before this board opened is not replayed.
        if (!primed || p.side === mySide || was === p.n) continue;
        fresh.push({ id: ++pingId.current, side: p.side, hex: p.hex, ...(typeof p.x === 'number' && typeof p.y === 'number' ? { at: { x: p.x, y: p.y } } : {}) });
      }
      primed = true;
      if (fresh.length) setPings((cur) => [...cur.slice(-20), ...fresh]);
    });
    return stop;
  }, [matchId, mySide]);
  const sendPing = useCallback(
    (hex: string, at?: MapPoint) => {
      if (!mySide) return;
      const point = at ? { x: Math.round(at.x), y: Math.round(at.y) } : {};
      setDoc(doc(db, COL.matches, matchId, COL.pings, mySide), { side: mySide, hex, n: Date.now(), ...point, at: serverTimestamp() }).catch(() => {});
    },
    [matchId, mySide],
  );
  return { publishDraft, theirDraft, sendPing, pings };
}
