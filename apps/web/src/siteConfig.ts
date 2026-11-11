/**
 * The deployment's own addresses, from the build environment (apps/web/.env.production; see .env.example).
 * Each is empty when unset, and whatever shows it leaves it out.
 */
const env = import.meta.env;

/** The public address of this deployment, e.g. https://example.org. */
export const SITE_URL = (env.VITE_SITE_URL ?? '').replace(/\/$/, '');
/** The host name players know the site by, for footers. */
export const SITE_HOST = SITE_URL ? new URL(SITE_URL).host : '';
/** Where players reach the people who run this deployment (a forum, chat server or mailto: link). */
export const SUPPORT_URL = env.VITE_SUPPORT_URL ?? '';
/** What to call that place in a sentence: "Tell us on <SUPPORT_NAME>". */
export const SUPPORT_NAME = env.VITE_SUPPORT_NAME ?? '';
