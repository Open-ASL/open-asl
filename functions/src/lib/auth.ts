import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';

export type Auth = NonNullable<CallableRequest<unknown>['auth']>;

/** The caller is signed in (with any provider). */
export function requireAuth(req: CallableRequest<unknown>): Auth {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  return req.auth;
}

/** The caller has claimed an invited profile: the `member` custom claim is set. */
export function requireMember(req: CallableRequest<unknown>): Auth {
  const auth = requireAuth(req);
  if (auth.token.member !== true) throw new HttpsError('permission-denied', 'This account has not been invited.');
  return auth;
}

export function requireString(v: unknown, name: string, max = 200): string {
  if (typeof v !== 'string' || !v || v.length > max) throw new HttpsError('invalid-argument', `${name} is required.`);
  return v;
}
