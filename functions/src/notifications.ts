import { onSchedule } from 'firebase-functions/v2/scheduler';
import { db } from './lib/app';
import { deliverDueEmails } from './lib/outbox';
import { RESEND_API_KEY } from './lib/emailSecret';

/**
 * Sends the scheduled-game emails that have come due (see `lib/outbox.ts`). `MATCH_EMAIL_FROM` and
 * `APP_ORIGIN` in the Functions environment override the production defaults; the Resend key is a
 * Functions secret. `deliverDueEmails` can also be run on demand from an admin script.
 */
export const sendScheduledGameEmails = onSchedule({ schedule: 'every 5 minutes', secrets: [RESEND_API_KEY], retryCount: 0 }, async () => {
  await deliverDueEmails({ db, resendApiKey: RESEND_API_KEY.value(), from: process.env['MATCH_EMAIL_FROM'], appOrigin: process.env['APP_ORIGIN'] });
});
