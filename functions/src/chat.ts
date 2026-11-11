import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { Timestamp } from 'firebase-admin/firestore';
import { COL, rulesetOfLobbyChannel, type ChatMessageDoc, type MatchDoc, type PublicProfileDoc } from '@asl/platform';
import { db, now } from './lib/app';
import { requireMember, requireString, type Auth } from './lib/auth';
import { fullAslOpen } from './lib/scenarios';

const BAD_WORDS = ['fuck', 'shit', 'cunt', 'nigger', 'faggot'];
const folded = (value: string) => value.toLocaleLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '').replace(/[013457@$]/g, (c) => ({ '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's' })[c] ?? c);

async function channelAccess(channelId: string, auth: Auth) {
  // Each lobby has its own chat; the Full ASL one is behind the same development gate as its matches.
  const ruleset = rulesetOfLobbyChannel(channelId);
  if (ruleset) {
    if (ruleset === 'full-asl' && !fullAslOpen(auth)) throw new HttpsError('permission-denied', 'Full ASL is not open yet.', { code: 'coming-soon' });
    return { kind: 'lobby', ruleset, participants: [] as string[] };
  }
  const uid = auth.uid;
  const matchId = channelId;
  const match = (await db.collection(COL.matches).doc(matchId).get()).data() as MatchDoc | undefined;
  if (!match || !match.playerIds.includes(uid)) throw new HttpsError('permission-denied', 'Only the players can use match chat.');
  return { kind: 'match', participants: match.playerIds, matchId };
}

export const sendChatMessage = onCall(async (req) => {
  const auth = requireMember(req);
  const { uid } = auth;
  const channelId = requireString(req.data?.channelId, 'channelId', 160);
  const text = requireString(req.data?.text, 'message', 500).trim();
  if (BAD_WORDS.some((word) => folded(text).includes(word))) throw new HttpsError('invalid-argument', 'Please rephrase that message.', { code: 'message-blocked' });
  const access = await channelAccess(channelId, auth);
  const profileRef = db.collection(COL.publicProfiles).doc(uid);
  const rateRef = db.collection(COL.chatRateLimits).doc(uid);
  const messageRef = db.collection(COL.chatChannels).doc(channelId).collection(COL.messages).doc();
  await db.runTransaction(async (tx) => {
    const [profileSnap, rateSnap] = await Promise.all([tx.get(profileRef), tx.get(rateRef)]);
    const profile = profileSnap.data() as PublicProfileDoc | undefined;
    if (!profile) throw new HttpsError('failed-precondition', 'Finish setting up your profile first.');
    const lastAt = (rateSnap.data()?.['lastAt'] as Timestamp | undefined)?.toMillis() ?? 0;
    if (Date.now() - lastAt < 1_000) throw new HttpsError('resource-exhausted', 'Slow down a little.', { code: 'chat-rate' });
    const message: ChatMessageDoc = { channelId, uid, nickname: profile.nickname, text, createdAt: now(), expiresAt: Timestamp.fromMillis(Date.now() + 30 * 24 * 60 * 60_000), hidden: false };
    tx.set(db.collection(COL.chatChannels).doc(channelId), { ...access, updatedAt: now() }, { merge: true });
    tx.create(messageRef, message);
    tx.set(rateRef, { lastAt: now() }, { merge: true });
  });
  return { messageId: messageRef.id };
});

export const reportChatMessage = onCall(async (req) => {
  const auth = requireMember(req);
  const { uid } = auth;
  const channelId = requireString(req.data?.channelId, 'channelId', 160);
  const messageId = requireString(req.data?.messageId, 'messageId', 160);
  const reason = requireString(req.data?.reason, 'reason', 300);
  await channelAccess(channelId, auth);
  const messageRef = db.collection(COL.chatChannels).doc(channelId).collection(COL.messages).doc(messageId);
  const message = (await messageRef.get()).data() as ChatMessageDoc | undefined;
  if (!message) throw new HttpsError('not-found', 'That message is gone.');
  const report = db.collection(COL.chatReports).doc();
  await report.create({ reporterUid: uid, reason, channelId, messageId, message, status: 'open', createdAt: now(), updatedAt: now() });
  return { reportId: report.id };
});

export const expireChatMessages = onSchedule('every 24 hours', async () => {
  const expired = await db.collectionGroup(COL.messages).where('expiresAt', '<=', Timestamp.now()).limit(500).get();
  const batch = db.batch();
  expired.docs.forEach((message) => batch.delete(message.ref));
  await batch.commit();
});
