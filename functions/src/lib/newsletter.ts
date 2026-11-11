import type { DocumentReference } from 'firebase-admin/firestore';
import type { SignupInterest } from '@asl/platform';

/** Secrets the mailing list needs; none without one. */
export const NEWSLETTER_SECRETS: string[] = [];

/** Hand a signup to the deployment's mailing list. This build has none: signups stay in Firestore. */
export async function mirrorSignup(_ref: DocumentReference, _email: string, _interests: SignupInterest[], _ip: string | undefined): Promise<void> {}
