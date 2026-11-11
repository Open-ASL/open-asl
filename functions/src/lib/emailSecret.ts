import { defineSecret } from 'firebase-functions/params';

/** Shared by every Open ASL transactional email function. */
export const RESEND_API_KEY = defineSecret('RESEND_API_KEY');
