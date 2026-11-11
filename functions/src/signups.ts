import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { isIP } from 'node:net';
import { COL, SIGNUP_INTERESTS, type SignupInterest } from '@asl/platform';
import { FieldValue, db, now } from './lib/app';
import { NEWSLETTER_SECRETS, mirrorSignup } from './lib/newsletter';
import { sha256 } from './lib/users';

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}\.[a-z]{2,}$/i;

/** The distinct, allowed interests in a request, in catalogue order; null when the request is malformed. */
export function parseInterests(raw: unknown): SignupInterest[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const picked = new Set(raw);
  if (picked.size !== raw.length) return null;
  const list = SIGNUP_INTERESTS.filter((i) => picked.has(i));
  return list.length === picked.size ? list : null;
}

/** The visitor's address, for a mailing list's per-subscriber spam check. The functions framework trusts X-Forwarded-For. */
function clientIp(ip: string | undefined): string | undefined {
  return ip && isIP(ip) ? ip : undefined;
}

/**
 * Landing page: send me news, sign me up as a beta tester, or both. Public; no account needed.
 * The signup is recorded in Firestore, then handed to the deployment's mailing list, if it has one
 * (lib/newsletter.ts). A mailing-list failure never fails the signup.
 */
export const submitSignup = onCall({ secrets: NEWSLETTER_SECRETS }, async (req) => {
  const email = String(req.data?.email ?? '').trim().toLowerCase();
  const interests = parseInterests(req.data?.interests);
  if (!EMAIL.test(email)) throw new HttpsError('invalid-argument', 'That does not look like an email address.');
  if (!interests) throw new HttpsError('invalid-argument', 'Pick news, beta testing, or both.');
  const ip = clientIp(req.rawRequest.ip);
  const ref = db.collection(COL.signups).doc(sha256(email));
  await db.runTransaction(async (tx) => {
    const existing = await tx.get(ref);
    if (existing.exists) {
      // A second visit replaces the choice and keeps the first visit's date.
      tx.update(ref, { email, interests, count: FieldValue.increment(1), updatedAt: now(), ...(ip ? { ip } : {}) });
    } else {
      tx.set(ref, { email, interests, count: 1, createdAt: now(), updatedAt: now(), ...(ip ? { ip } : {}) });
    }
  });
  await mirrorSignup(ref, email, interests, ip);
  return { ok: true as const };
});
