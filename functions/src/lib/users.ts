import { createHash } from 'node:crypto';
import { HttpsError } from 'firebase-functions/v2/https';
import type { DocumentReference, DocumentSnapshot, Transaction } from 'firebase-admin/firestore';
import { COL, type UserDoc } from '@asl/platform';
import { db } from './app';

export const userRef = (uid: string) => db.collection(COL.users).doc(uid) as DocumentReference<UserDoc>;

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function newUserDoc(email: string, displayName: string, at: unknown): UserDoc {
  return {
    email,
    gravatarHash: sha256(email),
    displayName,
    photoURL: null,
    xp: 0,
    elo: 1200,
    wins: 0,
    losses: 0,
    draws: 0,
    onlineGames: 0,
    hotseatGames: 0,
    abandoned: 0,
    streak: 0,
    medals: [],
    scenariosCompleted: [],
    betaScenarios: [],
    activeMatchId: null,
    createdAt: at,
    lastSeenAt: at,
    updatedAt: at,
  };
}

/** Read a member's profile inside a transaction; missing profiles are a bug, not a user error. */
export async function readUser(tx: Transaction, uid: string): Promise<{ ref: DocumentReference<UserDoc>; data: UserDoc }> {
  const ref = userRef(uid);
  const snap = (await tx.get(ref)) as DocumentSnapshot<UserDoc>;
  const data = snap.data();
  if (!data) throw new HttpsError('not-found', 'No such player.');
  return { ref, data };
}

/** A player may be in only one vs-human match at a time. */
export function requireFree(user: UserDoc, who: 'you' | 'they') {
  if (user.activeMatchId)
    throw new HttpsError('failed-precondition', who === 'you' ? 'Finish your current match first.' : 'That player is already in a match.', {
      code: who === 'you' ? 'busy' : 'target-busy',
    });
}
