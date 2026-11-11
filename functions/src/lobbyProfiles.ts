import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { COL, COMPUTER_NAME, type PublicProfileDoc, type UserDoc } from '@asl/platform';
import { db, now } from './lib/app';
import { requireMember, requireString } from './lib/auth';
import { userRef } from './lib/users';

const RESERVED = new Set(['admin', 'administrator', 'moderator', 'openasl', 'support', 'system', 'computer', COMPUTER_NAME.toLowerCase()]);
const OFFENSIVE = ['fuck', 'shit', 'cunt', 'nigger', 'faggot', 'nazi'];

export function normalizeNickname(value: string): string {
  return value.trim().toLowerCase();
}

function folded(value: string): string {
  return normalizeNickname(value)
    .normalize('NFKD')
    .replace(/[^a-z0-9]/g, '')
    .replace(/[013457@$]/g, (c) => ({ '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's' })[c] ?? c);
}

export function validateNickname(value: unknown): { nickname: string; normalized: string } {
  const nickname = requireString(value, 'nickname', 24).trim();
  if (!/^[A-Za-z0-9_-]{3,24}$/.test(nickname)) throw new HttpsError('invalid-argument', 'Use 3–24 letters, numbers, underscores or hyphens.', { code: 'nickname-format' });
  const normalized = normalizeNickname(nickname);
  const safe = folded(nickname);
  if (RESERVED.has(normalized) || OFFENSIVE.some((word) => safe.includes(word))) throw new HttpsError('invalid-argument', 'Choose another nickname.', { code: 'nickname-blocked' });
  return { nickname, normalized };
}

function publicFrom(uid: string, user: UserDoc, nickname: string, normalized: string): PublicProfileDoc {
  return {
    uid,
    nickname,
    nicknameNormalized: normalized,
    photoURL: user.photoURL,
    description: '',
    location: '',
    language: 'en',
    xp: user.xp,
    elo: user.elo,
    wins: user.wins,
    losses: user.losses,
    draws: user.draws,
    medals: user.medals,
    createdAt: user.createdAt,
    updatedAt: now(),
  };
}

/** Ensure older beta accounts have a public profile without exposing their private user document. */
export const ensurePublicProfile = onCall(async (req) => {
  const { uid } = requireMember(req);
  const profileRef = db.collection(COL.publicProfiles).doc(uid);
  await db.runTransaction(async (tx) => {
    const existing = await tx.get(profileRef);
    if (existing.exists) return;
    const user = (await tx.get(userRef(uid))).data();
    if (!user) throw new HttpsError('not-found', 'No account profile.');
    // The account's own name, as is, when it is valid and free; a numbered variant when taken; the uid tail only as a last resort.
    const candidate = (user.displayName || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24);
    const blocked = candidate.length < 3 || RESERVED.has(normalizeNickname(candidate)) || OFFENSIVE.some((word) => folded(candidate).includes(word));
    const root = blocked ? 'player' : candidate;
    const options = blocked ? [] : [root, ...[2, 3, 4, 5].map((n) => `${root.slice(0, 22)}-${n}`)];
    options.push(`${root.slice(0, 18)}-${uid.slice(0, 5)}`);
    let nickname = options[options.length - 1]!;
    for (const option of options) {
      if ((await tx.get(db.collection(COL.nicknames).doc(normalizeNickname(option)))).exists) continue;
      nickname = option;
      break;
    }
    const normalized = normalizeNickname(nickname);
    tx.create(profileRef, publicFrom(uid, user, nickname, normalized));
    tx.create(db.collection(COL.nicknames).doc(normalized), { uid, current: normalized, alias: false, createdAt: now() });
    tx.update(userRef(uid), { displayName: nickname, updatedAt: now() });
  });
  return { profile: (await profileRef.get()).data() as PublicProfileDoc };
});

export const updatePublicProfile = onCall(async (req) => {
  const { uid } = requireMember(req);
  const { nickname, normalized } = validateNickname(req.data?.nickname);
  const description = typeof req.data?.description === 'string' ? req.data.description.trim().slice(0, 500) : '';
  const location = typeof req.data?.location === 'string' ? req.data.location.trim().slice(0, 80) : '';
  const language = typeof req.data?.language === 'string' && /^[a-z]{2}(?:-[A-Z]{2})?$/.test(req.data.language) ? req.data.language : 'en';
  const profileRef = db.collection(COL.publicProfiles).doc(uid);
  await db.runTransaction(async (tx) => {
    const current = (await tx.get(profileRef)).data() as PublicProfileDoc | undefined;
    if (!current) throw new HttpsError('failed-precondition', 'Create your public profile first.');
    const newRef = db.collection(COL.nicknames).doc(normalized);
    const reserved = await tx.get(newRef);
    if (reserved.exists && reserved.data()?.['uid'] !== uid) throw new HttpsError('already-exists', 'That nickname is already in use.', { code: 'nickname-taken' });
    if (normalized !== current.nicknameNormalized) {
      const changedAt = current.nicknameChangedAt as { toMillis(): number } | undefined;
      if (changedAt && Date.now() - changedAt.toMillis() < 30 * 24 * 60 * 60_000) throw new HttpsError('failed-precondition', 'Nicknames can be changed once every 30 days.', { code: 'nickname-cooldown' });
      tx.set(db.collection(COL.nicknames).doc(current.nicknameNormalized), { uid, current: normalized, alias: true, createdAt: now() });
      tx.set(newRef, { uid, current: normalized, alias: false, createdAt: now() });
    }
    tx.update(profileRef, { nickname, nicknameNormalized: normalized, description, location, language, ...(normalized !== current.nicknameNormalized ? { nicknameChangedAt: now() } : {}), updatedAt: now() });
    tx.update(userRef(uid), { displayName: nickname, updatedAt: now() });
  });
  return { profile: (await profileRef.get()).data() as PublicProfileDoc };
});

/** Keep public earned statistics and avatar in step with the authoritative private account. */
export const mirrorPublicProfileStats = onDocumentUpdated(`${COL.users}/{uid}`, async (event) => {
  const user = event.data?.after.data() as UserDoc | undefined;
  if (!user) return;
  const ref = db.collection(COL.publicProfiles).doc(event.params.uid);
  if (!(await ref.get()).exists) return;
  await ref.set({ photoURL: user.photoURL, xp: user.xp, elo: user.elo, wins: user.wins, losses: user.losses, draws: user.draws, medals: user.medals, updatedAt: now() }, { merge: true });
});
