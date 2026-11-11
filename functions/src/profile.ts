import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { COL, type AllowlistDoc } from '@asl/platform';
import { adminAuth, db, now } from './lib/app';
import { requireAuth } from './lib/auth';
import { newUserDoc, userRef } from './lib/users';

/** In the local emulators every verified email is admitted; the allowlist only gates production. */
const openDoor = process.env.FUNCTIONS_EMULATOR === 'true';

/**
 * Gate for the invite-only beta. A signed-in user whose verified email is on the allowlist
 * gets a profile and the `member` custom claim. Safe to call on every sign-in.
 */
export const claimProfile = onCall(async (req) => {
  const auth = requireAuth(req);
  const email = (auth.token.email ?? '').trim().toLowerCase();
  if (!email) throw new HttpsError('failed-precondition', 'This sign-in method has no email address.', { code: 'no-email' });
  if (auth.token.email_verified !== true) throw new HttpsError('failed-precondition', 'Verify your email address first.', { code: 'email-unverified' });

  const created = await db.runTransaction(async (tx) => {
    const inviteRef = db.collection(COL.allowlist).doc(email);
    const invite = (await tx.get(inviteRef)).data() as AllowlistDoc | undefined;
    // One message whether the address is unknown or claimed by someone else: no probing the list.
    if (!openDoor && (!invite || (invite.claimedBy && invite.claimedBy !== auth.uid))) throw new HttpsError('permission-denied', 'This account has not been invited.', { code: 'not-invited' });
    const ref = userRef(auth.uid);
    const existing = await tx.get(ref);
    if (!existing.exists) {
      const name = (auth.token.name as string | undefined)?.trim() || email.split('@')[0]!;
      tx.set(ref, newUserDoc(email, name.slice(0, 32), now()));
    }
    if (invite && !invite.claimedBy) tx.update(inviteRef, { claimedBy: auth.uid, claimedAt: now() });
    return !existing.exists;
  });

  if (auth.token.member !== true) {
    const existing = (await adminAuth.getUser(auth.uid)).customClaims ?? {};
    await adminAuth.setCustomUserClaims(auth.uid, { ...existing, member: true });
  }
  return { created };
});
