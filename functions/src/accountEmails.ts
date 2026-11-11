import { createHash } from 'node:crypto';
import { Timestamp, type DocumentReference } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { adminAuth, db, now } from './lib/app';
import { DEFAULT_EMAIL_FROM, emailOrigin, escapeHtml, sendEmail, type BrandedEmail } from './lib/email';
import { RESEND_API_KEY } from './lib/emailSecret';

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}\.[a-z]{2,}$/i;
const RESET_COOLDOWN_MS = 2 * 60_000;
const RATE_LIMITS = 'emailRateLimits';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');

/** One active send per account/email kind. Keeps a public reset endpoint from becoming a mail cannon. */
async function reserveSend(kind: 'password-reset' | 'verification', identity: string): Promise<{ allowed: boolean; ref: DocumentReference }> {
  const ref = db.collection(RATE_LIMITS).doc(`${kind}_${digest(identity)}`);
  const allowed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const next = snap.get('nextAllowedAt') as Timestamp | undefined;
    if (next?.toMillis && next.toMillis() > Date.now()) return false;
    tx.set(ref, {
      kind,
      nextAllowedAt: Timestamp.fromMillis(Date.now() + RESET_COOLDOWN_MS),
      expiresAt: Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60_000),
      updatedAt: now(),
    }, { merge: true });
    return true;
  });
  return { allowed, ref };
}

const accountFrom = () => process.env['ACCOUNT_EMAIL_FROM'] ?? DEFAULT_EMAIL_FROM;
const appOrigin = () => emailOrigin(process.env['APP_ORIGIN']);

/**
 * Firebase's action links point at the project's default `*.firebaseapp.com` host. Hosting serves the same
 * `/__/auth/action` handler on the app's own domain, so the link is moved there: a mail from the app's domain whose
 * button leads to an unrelated domain looks like phishing to Yahoo and Gmail, which filed the resets as spam.
 */
export function onAppDomain(link: string, origin: string): string {
  const url = new URL(link);
  if (url.pathname !== '/__/auth/action') return link;
  const own = new URL(origin);
  url.protocol = own.protocol;
  url.host = own.host;
  return url.toString();
}

function passwordResetEmail(name: string, link: string): BrandedEmail {
  return {
    preheader: 'Use this secure link to choose a new Open ASL password.',
    eyebrow: 'Account security',
    title: 'Reset your password',
    body: `<p style="margin:0 0 16px;">Hello ${escapeHtml(name)},</p><p style="margin:0 0 16px;">We received a request to reset the password for your Open ASL account.</p><p style="margin:0;color:#a9ada5;font-size:14px;">This one-time link expires automatically. If you did not request a reset, you can ignore this message; your password has not changed.</p>`,
    action: { label: 'Choose a new password', href: link },
    text: `Hello ${name},\n\nWe received a request to reset the password for your Open ASL account. Use the one-time link below to choose a new password.\n\nIf you did not request a reset, you can ignore this message; your password has not changed.`,
  };
}

function verificationEmail(name: string, link: string): BrandedEmail {
  return {
    preheader: 'Confirm this email address to finish setting up your Open ASL account.',
    eyebrow: 'Account verification',
    title: 'Verify your email',
    body: `<p style="margin:0 0 16px;">Hello ${escapeHtml(name)},</p><p style="margin:0 0 16px;">Confirm this address to finish setting up your Open ASL account.</p><p style="margin:0;color:#a9ada5;font-size:14px;">If you did not create an account, you can safely ignore this message.</p>`,
    action: { label: 'Verify email address', href: link },
    text: `Hello ${name},\n\nConfirm this address to finish setting up your Open ASL account.\n\nIf you did not create an account, you can safely ignore this message.`,
  };
}

/**
 * Public and deliberately enumeration-safe: an unknown address receives the same successful
 * response as a known one. Firebase creates the one-time action code; Resend only transports it.
 */
export const requestPasswordReset = onCall({ secrets: [RESEND_API_KEY] }, async (req) => {
  const email = String(req.data?.email ?? '').trim().toLowerCase();
  if (!EMAIL.test(email)) throw new HttpsError('invalid-argument', 'Enter a valid email address.');

  let user;
  try {
    user = await adminAuth.getUserByEmail(email);
  } catch (error) {
    if ((error as { code?: string }).code === 'auth/user-not-found') {
      logger.info('Password reset: no account', { account: digest(email).slice(0, 12) });
      return { ok: true as const };
    }
    throw error;
  }

  const reservation = await reserveSend('password-reset', email);
  if (!reservation.allowed) {
    logger.info('Password reset: within the cooldown, not sent again', { account: digest(email).slice(0, 12) });
    return { ok: true as const };
  }
  const origin = appOrigin();
  try {
    const link = onAppDomain(await adminAuth.generatePasswordResetLink(email, { url: `${origin}/login` }), origin);
    const name = user.displayName?.trim() || email.split('@')[0]!;
    const sent = await sendEmail({
      apiKey: RESEND_API_KEY.value(),
      from: accountFrom(),
      to: email,
      subject: 'Reset your Open ASL password',
      email: passwordResetEmail(name, link),
      appOrigin: origin,
      idempotencyKey: `password-reset-${digest(email)}-${Math.floor(Date.now() / RESET_COOLDOWN_MS)}`,
    });
    logger.info('Password reset: sent', { account: digest(email).slice(0, 12), resendId: sent?.id });
  } catch (error) {
    // Let a real user retry immediately after a provider/configuration failure.
    await reservation.ref.update({ nextAllowedAt: Timestamp.now(), updatedAt: now() }).catch(() => {});
    logger.error('Password-reset email failed', { account: digest(email).slice(0, 12), message: error instanceof Error ? error.message : String(error) });
    throw new HttpsError('internal', 'The reset email could not be sent. Please try again.');
  }
  return { ok: true as const };
});

/** Resend the signed-in user's verification link through the same branded email system. */
export const requestEmailVerification = onCall({ secrets: [RESEND_API_KEY] }, async (req) => {
  const email = String(req.auth?.token.email ?? '').trim().toLowerCase();
  if (!req.auth || !EMAIL.test(email)) throw new HttpsError('unauthenticated', 'Sign in before requesting a verification email.');
  if (req.auth.token.email_verified === true) return { ok: true as const };
  const reservation = await reserveSend('verification', req.auth.uid);
  if (!reservation.allowed) return { ok: true as const };
  const origin = appOrigin();
  try {
    const user = await adminAuth.getUser(req.auth.uid);
    const link = onAppDomain(await adminAuth.generateEmailVerificationLink(email, { url: `${origin}/login` }), origin);
    const name = user.displayName?.trim() || email.split('@')[0]!;
    await sendEmail({
      apiKey: RESEND_API_KEY.value(),
      from: accountFrom(),
      to: email,
      subject: 'Verify your Open ASL email',
      email: verificationEmail(name, link),
      appOrigin: origin,
      idempotencyKey: `verification-${req.auth.uid}-${Math.floor(Date.now() / RESET_COOLDOWN_MS)}`,
    });
  } catch (error) {
    await reservation.ref.update({ nextAllowedAt: Timestamp.now(), updatedAt: now() }).catch(() => {});
    logger.error('Verification email failed', { uid: req.auth.uid, message: error instanceof Error ? error.message : String(error) });
    throw new HttpsError('internal', 'The verification email could not be sent. Please try again.');
  }
  return { ok: true as const };
});
