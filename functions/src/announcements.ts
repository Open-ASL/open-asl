import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { Timestamp } from 'firebase-admin/firestore';
import { COL, type AnnouncementDoc } from '@asl/platform';
import { db, now } from './lib/app';
import { requireMember, requireString } from './lib/auth';

const safeVideo = (value: string) => {
  try { const url = new URL(value); return ['youtube.com', 'www.youtube.com', 'youtu.be', 'vimeo.com', 'www.vimeo.com'].includes(url.hostname) ? url.toString() : null; } catch { return null; }
};

export const saveAnnouncement = onCall(async (req) => {
  const auth = requireMember(req);
  if (auth.token.admin !== true) throw new HttpsError('permission-denied', 'Administrator access required.');
  const id = typeof req.data?.id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(req.data.id) ? req.data.id : db.collection(COL.announcements).doc().id;
  const title = requireString(req.data?.title, 'title', 120).trim();
  const summary = requireString(req.data?.summary, 'summary', 300).trim();
  const body = requireString(req.data?.body, 'body', 20_000).trim();
  const statuses: AnnouncementDoc['status'][] = ['draft', 'scheduled', 'published', 'archived'];
  const status = statuses.includes(req.data?.status) ? req.data.status : 'draft';
  const publishDate = new Date(req.data?.publishAt);
  if (!Number.isFinite(publishDate.getTime())) throw new HttpsError('invalid-argument', 'Choose a publication time.');
  const imageURL = typeof req.data?.imageURL === 'string' && /^https:\/\//.test(req.data.imageURL) ? req.data.imageURL.slice(0, 2_000) : null;
  const videoURL = typeof req.data?.videoURL === 'string' && req.data.videoURL ? safeVideo(req.data.videoURL) : null;
  if (req.data?.videoURL && !videoURL) throw new HttpsError('invalid-argument', 'Videos must use YouTube or Vimeo.');
  const ref = db.collection(COL.announcements).doc(id);
  const existing = await ref.get();
  const announcement: AnnouncementDoc = {
    title, slug: title.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100), summary, body,
    imageURL, videoURL, status, pinned: req.data?.pinned === true, publishAt: Timestamp.fromDate(publishDate), authorUid: auth.uid,
    createdAt: existing.data()?.['createdAt'] ?? now(), updatedAt: now(),
  };
  await ref.set(announcement, { merge: true });
  return { id };
});

export const publishScheduledAnnouncements = onSchedule('every 5 minutes', async () => {
  const due = await db.collection(COL.announcements).where('status', '==', 'scheduled').where('publishAt', '<=', Timestamp.now()).limit(100).get();
  const batch = db.batch();
  due.docs.forEach((announcement) => batch.update(announcement.ref, { status: 'published', updatedAt: now() }));
  await batch.commit();
});
