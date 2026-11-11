import { Resend } from 'resend';

/** The deployment's sender and public address: `EMAIL_FROM` and `APP_ORIGIN` in the Functions environment (functions/.env). */
export const DEFAULT_EMAIL_FROM = process.env['EMAIL_FROM'] || 'Open ASL <notifications@localhost>';
export const DEFAULT_APP_ORIGIN = process.env['APP_ORIGIN'] || 'http://localhost:5173';

export interface EmailAction {
  label: string;
  href: string;
}

export interface BrandedEmail {
  /** Short inbox-preview copy, hidden once the message is open. */
  preheader: string;
  /** Small uppercase line above the title. */
  eyebrow: string;
  title: string;
  /** Trusted HTML assembled by the caller; dynamic values must be escaped first. */
  body: string;
  action: EmailAction;
  /** Plain-text equivalent of `body`, without the action URL. */
  text: string;
}

export interface SendEmailOptions {
  apiKey: string;
  from?: string;
  to: string;
  subject: string;
  email: BrandedEmail;
  appOrigin?: string;
  idempotencyKey?: string;
}

export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** A safe, slash-free origin for image and app links in email. */
export function emailOrigin(value = DEFAULT_APP_ORIGIN): string {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return DEFAULT_APP_ORIGIN;
    return url.origin;
  } catch {
    return DEFAULT_APP_ORIGIN;
  }
}

/**
 * Table-based, all-inline markup intentionally kept conservative for Gmail, Outlook and Apple
 * Mail. The hosted PNG gives clients a crisp emblem without attachments; useful copy and the Open
 * ASL wordmark remain visible when a client blocks remote images.
 */
export function emailHtml(email: BrandedEmail, appOrigin = DEFAULT_APP_ORIGIN): string {
  const origin = emailOrigin(appOrigin);
  const logo = `${origin}/icons/email-logo.png`;
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(email.title)}</title></head>
<body style="margin:0;padding:0;background:#0d100e;color:#e8e6dc;font-family:Arial,Helvetica,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(email.preheader)}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#0d100e;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background:#171b16;border:1px solid #3e4634;border-radius:8px;overflow:hidden;">
        <tr><td align="center" style="padding:28px 32px 20px;border-bottom:1px solid #3e4634;background:#11150f;">
          <a href="${escapeHtml(origin)}" style="text-decoration:none;color:#f0cf72;">
            <img src="${escapeHtml(logo)}" width="82" alt="Open ASL" style="display:block;width:82px;height:auto;margin:0 auto 12px;border:0;">
            <span style="font-family:Arial Black,Impact,Arial,sans-serif;font-size:22px;line-height:1;letter-spacing:1px;color:#e8e6dc;">OPEN <span style="color:#f0cf72;">ASL</span></span>
          </a>
        </td></tr>
        <tr><td style="padding:34px 36px 38px;">
          <p style="margin:0 0 9px;color:#c9a24a;font-size:12px;line-height:1.4;font-weight:bold;letter-spacing:1.6px;text-transform:uppercase;">${escapeHtml(email.eyebrow)}</p>
          <h1 style="margin:0 0 22px;color:#f5f1e6;font-size:29px;line-height:1.2;font-weight:700;">${escapeHtml(email.title)}</h1>
          <div style="color:#d4d2c8;font-size:16px;line-height:1.65;">${email.body}</div>
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:28px 0 6px;"><tr><td bgcolor="#c9a24a" style="border-radius:4px;">
            <a href="${escapeHtml(email.action.href)}" style="display:inline-block;padding:13px 22px;color:#17150d;font-size:14px;line-height:1;font-weight:bold;letter-spacing:.5px;text-decoration:none;">${escapeHtml(email.action.label)}</a>
          </td></tr></table>
          <p style="margin:20px 0 0;color:#8f948b;font-size:12px;line-height:1.5;">If the button does not work, copy and paste this address:<br><a href="${escapeHtml(email.action.href)}" style="color:#d8bb6c;word-break:break-all;">${escapeHtml(email.action.href)}</a></p>
        </td></tr>
        <tr><td style="padding:18px 32px;background:#11150f;border-top:1px solid #3e4634;color:#777d74;font-size:11px;line-height:1.5;text-align:center;">
          Open ASL is an independent project and is not affiliated with or endorsed by Multi-Man Publishing.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function emailText(email: BrandedEmail): string {
  return `OPEN ASL\n\n${email.title}\n\n${email.text}\n\n${email.action.label}: ${email.action.href}\n\nOpen ASL is an independent project and is not affiliated with or endorsed by Multi-Man Publishing.`;
}

/** Send one branded transactional email and surface Resend's API-level errors as exceptions. */
export async function sendEmail({ apiKey, from = DEFAULT_EMAIL_FROM, to, subject, email, appOrigin, idempotencyKey }: SendEmailOptions) {
  const resend = new Resend(apiKey);
  const { data, error } = await resend.emails.send({
    from,
    to,
    subject,
    html: emailHtml(email, appOrigin),
    text: emailText(email),
  }, idempotencyKey ? { idempotencyKey } : undefined);
  if (error) throw new Error(error.message);
  return data;
}
