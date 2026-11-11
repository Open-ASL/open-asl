import { getDatabase } from 'firebase-admin/database';
import { onValueDeleted } from 'firebase-functions/v2/database';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { COL, type MatchDoc, type UserDoc } from '@asl/platform';
import { db, now } from './lib/app';

/** Withdraw a host's unjoined quick tables when their final Lobby connection disappears. */
export const closeDisconnectedQuickTables = onValueDeleted('/presence/{uid}/{connectionId}', async (event) => {
  const uid = event.params.uid;
  const remaining = await event.data.ref.parent?.get();
  if (remaining?.exists()) return;
  const open = await db.collection(COL.matches).where('createdBy', '==', uid).where('status', '==', 'open').get();
  if (open.empty) return;
  const userRef = db.collection(COL.users).doc(uid);
  await db.runTransaction(async (tx) => {
    const [userSnap, ...matches] = await Promise.all([tx.get(userRef), ...open.docs.map((match) => tx.get(match.ref))]);
    let cleared = false;
    matches.forEach((snap) => {
      const match = snap.data() as MatchDoc | undefined;
      if (match?.status === 'open' && match.quick && match.createdBy === uid) {
        tx.update(snap.ref, { status: 'cancelled', official: false, completedAt: now(), updatedAt: now() });
        if ((userSnap.data() as UserDoc | undefined)?.activeMatchId === snap.id) cleared = true;
      }
    });
    if (cleared) tx.update(userRef, { activeMatchId: null, updatedAt: now() });
  });
});

/**
 * A live tab refreshes its node's `at` every minute (apps/web/src/lobby-v2/presenceRules.ts). A node
 * this old belongs to a connection whose disconnect handler never ran (a laptop asleep, a killed
 * process); the roster already ignores it, and this removes it so the tree does not grow forever.
 */
const DEAD_PRESENCE_MS = 15 * 60_000;

export const sweepStalePresence = onSchedule('every 10 minutes', async () => {
  const snapshot = await getDatabase().ref('presence').get();
  const tree = (snapshot.val() ?? {}) as Record<string, Record<string, { at?: number } | null> | null>;
  const cutoff = Date.now() - DEAD_PRESENCE_MS;
  const dead: Record<string, null> = {};
  for (const [uid, connections] of Object.entries(tree)) {
    for (const [id, node] of Object.entries(connections ?? {})) {
      if (typeof node?.at !== 'number' || node.at < cutoff) dead[`${uid}/${id}`] = null;
    }
  }
  if (Object.keys(dead).length) await getDatabase().ref('presence').update(dead);
});
