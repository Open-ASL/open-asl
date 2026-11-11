/**
 * Scheduled-game email delivery, shared by the 5-minute `sendScheduledGameEmails` function and the
 * on-demand admin scripts (no Firebase Functions imports here).
 *
 * Scheduling a game queues one `emailOutbox` document per player and message (confirmation now, a
 * reminder 30 minutes before, and one 24 hours before when the game is further out than that). Each
 * run claims the due pending documents transactionally and sends them through Resend; the document
 * id is the idempotency key, so a retry after a crash never sends twice. Five failures mark it
 * `failed` for good.
 */
import { Timestamp, FieldValue, type Firestore } from 'firebase-admin/firestore';
import { DEFAULT_APP_ORIGIN, DEFAULT_EMAIL_FROM, emailHtml as renderEmailHtml, emailOrigin, escapeHtml, sendEmail, type BrandedEmail } from './email';

/** `COL.emailOutbox` in @asl/platform, spelled out so `scripts/prod.ts` can run this file under tsx, where the workspace alias does not resolve. */
const OUTBOX = 'emailOutbox';

export interface OutboxDoc {
  to: string;
  nickname: string;
  kind: 'confirmation' | 'reminder-24h' | 'reminder-30m' | 'cancelled' | 'rescheduled' | 'expired';
  listingId: string;
  /** The game's ruleset (`RulesetId` in @asl/platform): the email links to that lobby's games desk. Older entries are Starter Kit. */
  rulesetId?: 'starter-kit' | 'full-asl';
  scenarioTitle: string;
  /** The post's scenario, for an `expired` notice's link to post it again. */
  scenarioId?: string;
  /** The session's start; null on an `expired` notice (the post was never scheduled). */
  scheduledAt: Timestamp | null;
  sendAt: Timestamp;
  status: 'pending' | 'sending' | 'sent' | 'failed';
  attempts: number;
  error?: string;
}

export interface DeliveryOptions {
  db: Firestore;
  resendApiKey: string;
  /** The From header; must be on a domain verified in Resend (or Resend's own test sender, which only reaches the account owner). */
  from?: string;
  /** Where the "open the game desk" link points. */
  appOrigin?: string;
  /** Something to log each outcome to (the CLI); the function stays quiet. */
  log?: (line: string) => void;
}

export const DEFAULT_FROM = DEFAULT_EMAIL_FROM;
export const DEFAULT_ORIGIN = DEFAULT_APP_ORIGIN;
const MAX_ATTEMPTS = 5;
const SENDING_LEASE_MS = 10 * 60_000;

/** Subject line and heading for each message kind. */
export function emailLead(kind: OutboxDoc['kind']): string {
  switch (kind) {
    case 'confirmation': return 'Your match is scheduled';
    case 'reminder-24h': return 'Your match starts in 24 hours';
    case 'reminder-30m': return 'Your table opens in 30 minutes';
    case 'expired': return 'Your game post expired';
    default: return 'Your match schedule changed';
  }
}

/** Branded HTML/plain-text content for one outbox document. */
export function matchEmail(doc: Pick<OutboxDoc, 'kind' | 'nickname' | 'scenarioTitle' | 'scheduledAt' | 'rulesetId' | 'scenarioId'>, appOrigin = DEFAULT_ORIGIN): BrandedEmail {
  if (doc.kind === 'expired' || !doc.scheduledAt) return expiredEmail(doc, appOrigin);
  const when = doc.scheduledAt.toDate().toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short', timeZone: 'UTC' });
  const lead = emailLead(doc.kind);
  const href = `${emailOrigin(appOrigin)}/app/${doc.rulesetId ?? 'starter-kit'}/games`;
  return {
    preheader: `${doc.scenarioTitle} — ${when} UTC`,
    eyebrow: doc.kind === 'confirmation' ? 'Match scheduled' : 'Match reminder',
    title: lead,
    body: `<p style="margin:0 0 16px;">Hello ${escapeHtml(doc.nickname)},</p><p style="margin:0 0 18px;">Your scheduled engagement is approaching.</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 18px;background:#11150f;border-left:3px solid #c9a24a;"><tr><td style="padding:16px 18px;"><strong style="display:block;color:#f5f1e6;font-size:18px;line-height:1.35;">${escapeHtml(doc.scenarioTitle)}</strong><span style="display:block;margin-top:7px;color:#b8b9b2;font-size:14px;">${escapeHtml(when)} UTC</span></td></tr></table><p style="margin:0;color:#a9ada5;font-size:14px;">The Games desk displays the start in your local time. The table opens 15 minutes before the scheduled start.</p>`,
    action: { label: 'Open the Games desk', href },
    text: `Hello ${doc.nickname},\n\n${doc.scenarioTitle} is scheduled for ${when} UTC.\n\nThe Games desk displays the start in your local time. The table opens 15 minutes before the scheduled start.`,
  };
}

/** An open post that ran out of times with nobody booking one: the host is asked to post it again. */
function expiredEmail(doc: Pick<OutboxDoc, 'nickname' | 'scenarioTitle' | 'rulesetId' | 'scenarioId'>, appOrigin: string): BrandedEmail {
  const desk = `${emailOrigin(appOrigin)}/app/${doc.rulesetId ?? 'starter-kit'}/games`;
  const href = doc.scenarioId ? `${desk}?scenario=${encodeURIComponent(doc.scenarioId)}` : desk;
  return {
    preheader: `Nobody joined ${doc.scenarioTitle} before your times ran out.`,
    eyebrow: 'Game post',
    title: 'Your game post expired',
    body: `<p style="margin:0 0 16px;">Hello ${escapeHtml(doc.nickname)},</p><p style="margin:0 0 18px;">Your game post expired with no one joining it, so it has come off the board.</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 18px;background:#11150f;border-left:3px solid #c9a24a;"><tr><td style="padding:16px 18px;"><strong style="display:block;color:#f5f1e6;font-size:18px;line-height:1.35;">${escapeHtml(doc.scenarioTitle)}</strong></td></tr></table><p style="margin:0;color:#a9ada5;font-size:14px;">To try again, recreate the post with new times you can play.</p>`,
    action: { label: 'Post it again', href },
    text: `Hello ${doc.nickname},\n\nYour game post for ${doc.scenarioTitle} expired with no one joining it, so it has come off the board.\n\nTo try again, recreate the post with new times you can play: ${href}`,
  };
}

/** Backward-compatible renderer used by lightweight template tests and previews. */
export function emailHtml(doc: Pick<OutboxDoc, 'kind' | 'nickname' | 'scenarioTitle' | 'scheduledAt' | 'rulesetId' | 'scenarioId'>, appOrigin = DEFAULT_ORIGIN): string {
  return renderEmailHtml(matchEmail(doc, appOrigin), appOrigin);
}

/** Send every pending outbox document whose time has come. Returns how many were claimed, sent and failed this run. */
export async function deliverDueEmails({ db, resendApiKey, from = DEFAULT_FROM, appOrigin = DEFAULT_ORIGIN, log = () => {} }: DeliveryOptions) {
  const now = () => FieldValue.serverTimestamp();
  // If an instance died after claiming but before recording the outcome, make that item eligible
  // again. Resend sees the same document id as its idempotency key, so recovery cannot duplicate a
  // message that made it across the network before the crash.
  const staleBefore = Date.now() - SENDING_LEASE_MS;
  const sending = await db.collection(OUTBOX).where('status', '==', 'sending').limit(100).get();
  await Promise.all(sending.docs.map(async (snap) => {
    const updatedAt = snap.get('updatedAt') as Timestamp | undefined;
    if (updatedAt?.toMillis && updatedAt.toMillis() <= staleBefore) await snap.ref.update({ status: 'pending', updatedAt: now() });
  }));
  const due = await db.collection(OUTBOX).where('status', '==', 'pending').where('sendAt', '<=', Timestamp.now()).orderBy('sendAt').limit(50).get();
  const tally = { claimed: 0, sent: 0, failed: 0 };
  await Promise.all(due.docs.map(async (snap) => {
    const claimed = await db.runTransaction(async (tx) => {
      const fresh = await tx.get(snap.ref);
      const data = fresh.data() as OutboxDoc | undefined;
      if (!data || data.status !== 'pending') return null;
      tx.update(snap.ref, { status: 'sending', attempts: data.attempts + 1, updatedAt: now() });
      return data;
    });
    if (!claimed) return;
    tally.claimed++;
    try {
      await sendEmail({
        apiKey: resendApiKey,
        from,
        to: claimed.to,
        subject: `${emailLead(claimed.kind)}: ${claimed.scenarioTitle}`,
        email: matchEmail(claimed, appOrigin),
        appOrigin,
        idempotencyKey: snap.id,
      });
      await snap.ref.update({ status: 'sent', sentAt: now(), updatedAt: now() });
      tally.sent++;
      log(`sent\t${claimed.kind}\t${claimed.to}\t${snap.id}`);
    } catch (error) {
      const attempts = claimed.attempts + 1;
      const message = (error as Error).message.slice(0, 500);
      await snap.ref.update({ status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending', error: message, updatedAt: now() });
      tally.failed++;
      log(`${attempts >= MAX_ATTEMPTS ? 'FAILED' : 'retry'}\t${claimed.kind}\t${claimed.to}\t${snap.id}\t${message}`);
    }
  }));
  return tally;
}
