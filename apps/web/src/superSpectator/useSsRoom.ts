import { useCallback, useEffect, useRef, useState } from 'react';
import { addDoc, collection, deleteDoc, doc, increment, onSnapshot, runTransaction, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import {
  COL,
  SS_COL,
  SS_MEMBER_STALE_MS,
  SS_ROOM_DOC,
  emptySsRoom,
  freeSsColor,
  ssColor,
  thinStroke,
  type SsMemberDoc,
  type SsPingDoc,
  type SsRoomDoc,
  type SsStrokeDoc,
} from '@asl/platform';
import { db } from '../firebase';
import type { InkStroke } from '../board/ink';
import type { MapPoint, Ping } from '../game/session';

/** The shared part of the room: what every commentator in it sees. */
export type SsRoom = Omit<SsRoomDoc, 'by' | 'at'>;
export type SsRoomPatch = Partial<SsRoom>;

export interface SsMember {
  uid: string;
  name: string;
  color: number;
}

const millis = (t: unknown): number => (t && typeof (t as { toMillis?: unknown }).toMillis === 'function' ? (t as { toMillis(): number }).toMillis() : Date.now());

/**
 * The commentators' room on a match (see `@asl/platform` superSpectator): its shared board, who is present (each with
 * a colour), their pings and their ink. This browser joins on mount and leaves on unmount.
 */
export function useSsRoom(matchId: string, uid: string, name: string) {
  const match = doc(db, COL.matches, matchId);
  const roomRef = doc(match, SS_COL.room, SS_ROOM_DOC);
  const [room, setRoom] = useState<SsRoom | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    return onSnapshot(
      roomRef,
      (snap) => {
        const d = snap.data() as SsRoomDoc | undefined;
        if (d) setRoom({ ...emptySsRoom(), ...d });
        else {
          setRoom(emptySsRoom());
          // The first commentator in opens the room (unless another just did).
          runTransaction(db, async (tx) => {
            if (!(await tx.get(roomRef)).exists()) tx.set(roomRef, { ...emptySsRoom(), by: uid, at: serverTimestamp() });
          }).catch(() => {});
        }
      },
      (e) => setError(e.message),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId, uid]);

  /** Change the shared board; each field given replaces that field whole (a later change by another commentator wins). */
  const patch = useCallback(
    (p: SsRoomPatch) => {
      setRoom((r) => (r ? { ...r, ...p } : r));
      updateDoc(roomRef, { ...p, by: uid, at: serverTimestamp() }).catch((e: Error) => setError(e.message));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [matchId, uid],
  );

  // Members: who is here, each with the lowest colour free when they came in; a heartbeat keeps the entry fresh.
  const [members, setMembers] = useState<SsMember[]>([]);
  const myColor = useRef<number | null>(null);
  useEffect(() => {
    const me = doc(match, SS_COL.members, uid);
    let joined = false;
    const stop = onSnapshot(collection(match, SS_COL.members), (snap) => {
      const now = Date.now();
      const present = snap.docs.map((d) => d.data() as SsMemberDoc).filter((m) => m.uid === uid || now - millis(m.at) < SS_MEMBER_STALE_MS);
      if (!joined) {
        joined = true;
        const mine = present.find((m) => m.uid === uid);
        myColor.current = mine ? mine.color : freeSsColor(present.map((m) => m.color));
        setDoc(me, { uid, name, color: myColor.current, at: serverTimestamp() }).catch(() => {});
      }
      setMembers(present.map((m) => ({ uid: m.uid, name: m.name, color: ssColor(m.color) })));
    });
    const beat = setInterval(() => {
      if (myColor.current !== null) setDoc(me, { uid, name, color: myColor.current, at: serverTimestamp() }).catch(() => {});
    }, 10 * 60 * 1000);
    return () => {
      stop();
      clearInterval(beat);
      deleteDoc(me).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId, uid, name]);
  const color = members.find((m) => m.uid === uid)?.color ?? ssColor(myColor.current ?? 0);

  // Pings: each commentator's doc holds their last one; a change after the first read is a new ping.
  const [pings, setPings] = useState<Ping[]>([]);
  const pingId = useRef(0);
  useEffect(() => {
    let primed = false;
    const seen = new Map<string, number>();
    return onSnapshot(collection(match, SS_COL.pings), (snap) => {
      const fresh: Ping[] = [];
      for (const d of snap.docs) {
        const p = d.data() as SsPingDoc;
        if (typeof p.n !== 'number' || typeof p.hex !== 'string') continue;
        const was = seen.get(p.uid);
        seen.set(p.uid, p.n);
        if (!primed || p.uid === uid || was === p.n) continue;
        fresh.push({ id: ++pingId.current, side: '', hex: p.hex, color: ssColor(p.color), ...(typeof p.x === 'number' && typeof p.y === 'number' ? { at: { x: p.x, y: p.y } } : {}) });
      }
      primed = true;
      if (fresh.length) setPings((cur) => [...cur.slice(-20), ...fresh]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId, uid]);
  const sendPing = useCallback(
    (hex: string, at?: MapPoint) => {
      const point = at ? { x: Math.round(at.x), y: Math.round(at.y) } : {};
      setDoc(doc(match, SS_COL.pings, uid), { uid, hex, n: Date.now(), color: myColor.current ?? 0, ...point, at: serverTimestamp() }).catch(() => {});
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [matchId, uid],
  );

  // Ink: every stroke of the current epoch; "erase all" moves the epoch on and sweeps the old strokes away.
  const [allInk, setAllInk] = useState<(InkStroke & { epoch: number })[]>([]);
  useEffect(() => {
    return onSnapshot(collection(match, SS_COL.strokes), (snap) => {
      setAllInk(
        snap.docs
          .map((d) => ({ d: d.data() as SsStrokeDoc, id: d.id }))
          .sort((a, b) => millis(a.d.at) - millis(b.d.at))
          .map(({ d, id }) => ({ id, color: d.color, width: d.width, points: d.points, epoch: d.epoch })),
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId]);
  const epoch = room?.epoch ?? 0;
  const ink = allInk.filter((s) => s.epoch === epoch);
  const addInk = useCallback(
    (s: { color: number; width: number; points: number[] }) => {
      const points = thinStroke(s.points);
      addDoc(collection(match, SS_COL.strokes), { uid, color: s.color, width: Math.round(s.width * 10) / 10, points, epoch, at: serverTimestamp() }).catch((e: Error) => setError(e.message));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [matchId, uid, epoch],
  );
  const eraseInk = useCallback(() => {
    setRoom((r) => (r ? { ...r, epoch: r.epoch + 1 } : r));
    updateDoc(roomRef, { epoch: increment(1), by: uid, at: serverTimestamp() }).catch((e: Error) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId, uid]);
  // Old ink is swept up by whoever sees it (a batch per 400 strokes).
  const stale = allInk.filter((s) => s.epoch < epoch).map((s) => s.id);
  const staleKey = stale.join(',');
  useEffect(() => {
    if (!stale.length) return;
    const b = writeBatch(db);
    for (const id of stale.slice(0, 400)) b.delete(doc(match, SS_COL.strokes, id));
    b.commit().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staleKey]);

  return { room, patch, members, color, pings, sendPing, ink, addInk, eraseInk, error };
}
